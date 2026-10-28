import { SocketModeClient, LogLevel, type Logger } from '@slack/socket-mode';
import { secret, type BotConfig, type Config } from '../config.js';
import { DeliveryError } from '../errors.js';
import type { Command } from '../policy/quarantine.js';
import { Queue } from '../storage/queue.js';
import { slackEvent } from './slack-events.js';

interface SocketEnvelope { type: string; body: unknown; envelope_id: string; ack: () => Promise<void> }
export class SlackConnection {
  private readonly client: SocketModeClient;
  private connected = false;
  constructor(private readonly bot: BotConfig, private readonly readConfig: () => Config, private readonly queue: Queue) {
    // SDK diagnostic arguments can contain URLs, tokens or payloads. Record classifications only.
    const logger: Logger = { debug: () => {}, info: () => {}, warn: () => queue.audit(null, null, 'provider_warning', 'slack_sdk_warning'),
      error: () => queue.audit(null, null, 'provider_error', 'slack_sdk_error'), setLevel: () => {}, getLevel: () => LogLevel.ERROR, setName: () => {} };
    this.client = new SocketModeClient({ appToken: secret(bot.appTokenEnv ?? ''), logger, logLevel: LogLevel.ERROR,
      clientOptions: { retryConfig: { retries: 2 }, timeout: 15000 } });
    this.client.on('connected', () => { this.connected = true; });
    this.client.on('disconnected', () => { this.connected = false; });
    this.client.on('error', () => { this.connected = false; queue.audit(null, null, 'provider_error', 'slack_socket_error'); });
    this.client.on('slack_event', (envelope: SocketEnvelope) => {
      void this.accept(envelope).catch(() => queue.audit(null, null, 'ingress_failed', 'slack_not_acknowledged'));
    });
  }
  private async accept(envelope: SocketEnvelope): Promise<void> {
    slackEvent(this.readConfig(), this.queue, this.bot.id, envelope.type, envelope.body, envelope.envelope_id);
    await envelope.ack(); // Persist/quarantine first. Never wait for a consumer round trip.
  }
  async start(): Promise<void> { await this.client.start(); }
  async close(): Promise<void> { this.connected = false; await this.client.disconnect(); }
  ready(): boolean { return this.connected; }
}

export function slackPlainText(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
export async function slackSend(bot: BotConfig, destination: string, command: Command, id: string): Promise<string | null> {
  const method = command.operation === 'send' ? 'chat.postMessage' : command.operation === 'edit' ? 'chat.update' : 'chat.delete';
  const payload = { channel: destination, ...(command.messageId ? { ts: command.messageId } : {}),
    ...(command.operation === 'delete' ? {} : { text: slackPlainText(command.text ?? ''), mrkdwn: false, parse: 'none', link_names: false,
      unfurl_links: false, unfurl_media: false, ...(command.operation === 'send' ? { client_msg_id: id } : {}) }) };
  let response: Response;
  try { response = await fetch(`https://slack.com/api/${method}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${secret(bot.tokenEnv)}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) }); }
  catch { throw new DeliveryError('slack_transport', undefined, true); }
  if (response.status === 429) {
    await response.body?.cancel(); const seconds = Number(response.headers.get('retry-after'));
    throw new DeliveryError('slack_rate_limit', Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 86400000) : 60000);
  }
  if (response.status >= 500) { await response.body?.cancel(); throw new DeliveryError('slack_remote_uncertain', undefined, true); }
  if (!response.ok) { await response.body?.cancel(); throw new DeliveryError(`slack_http_${response.status}`); }
  const body = await response.json() as { ok?: boolean; error?: string; ts?: unknown };
  if (command.operation === 'delete' && body.error === 'message_not_found') return null;
  if (!body.ok) throw new DeliveryError('slack_api_rejected');
  if (command.operation === 'delete') return null;
  if (typeof body.ts !== 'string' || !/^\d+\.\d+$/.test(body.ts)) throw new DeliveryError('slack_invalid_response', undefined, true);
  return body.ts;
}

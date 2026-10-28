import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { secret, type BotConfig, type Config } from '../config.js';
import { BoundaryError, DeliveryError } from '../errors.js';
import { receive } from '../ingress.js';
import type { Command } from '../policy/quarantine.js';
import { Queue } from '../storage/queue.js';

const Event = z.object({ type: z.string(), webhookEventId: z.string().min(1).max(128), timestamp: z.number().int(),
  source: z.object({ type: z.string(), userId: z.string().optional(), groupId: z.string().optional(), roomId: z.string().optional() }),
  message: z.object({ type: z.string(), text: z.string().optional() }).optional(), postback: z.object({ data: z.string() }).optional(),
});
export function lineWebhook(config: Config, queue: Queue, bot: BotConfig, raw: Buffer, signature: string | undefined): void {
  const expected = createHmac('sha256', secret(bot.secretEnv ?? '')).update(raw).digest('base64');
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new BoundaryError('invalid_signature', 401);
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { throw new BoundaryError('invalid_json'); }
  const envelope = z.object({ events: z.array(z.unknown()).max(1000) }).safeParse(parsed);
  if (!envelope.success) throw new BoundaryError('invalid_webhook');
  for (const candidate of envelope.data.events) {
    const result = Event.safeParse(candidate);
    if (!result.success) { queue.audit(null, null, 'quarantined', 'unsupported_line_event'); continue; }
    const e = result.data;
    const destination = e.source.groupId ?? e.source.roomId ?? e.source.userId;
    if (!destination || !e.source.userId) { queue.audit(null, null, 'quarantined', 'missing_line_identity'); continue; }
    if (e.type !== 'message' && e.type !== 'postback') { queue.audit(null, null, 'quarantined', 'unsupported_line_event'); continue; }
    receive(config, queue, { id: e.webhookEventId, bot: bot.id, destination, actor: e.source.userId,
      kind: e.type === 'postback' ? 'action' : 'message', text: e.postback?.data ?? e.message?.text ?? '', timestamp: e.timestamp,
      hasAttachments: e.type === 'message' && e.message?.type !== 'text' });
  }
}
export async function lineSend(bot: BotConfig, destination: string, command: Command, id: string): Promise<string | null> {
  if (command.operation !== 'send') throw new DeliveryError('unsupported_operation');
  let response: Response;
  try {
    response = await fetch('https://api.line.me/v2/bot/message/push', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${secret(bot.tokenEnv)}`, 'Content-Type': 'application/json', 'X-Line-Retry-Key': id },
      body: JSON.stringify({ to: destination, messages: [{ type: 'text', text: command.text }] }) });
  } catch { throw new DeliveryError('line_transport', 5000); }
  await response.body?.cancel();
  if (response.ok || (response.status === 409 && response.headers.has('x-line-accepted-request-id'))) return null;
  if (response.status === 429 || response.status >= 500) throw new DeliveryError('line_retry', retryDelay(response.headers.get('retry-after')));
  throw new DeliveryError(`line_http_${response.status}`);
}
function retryDelay(value: string | null): number {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 86400000) : 30000;
}

import { Client, Events, GatewayIntentBits, MessageFlags, type Message, type Interaction } from 'discord.js';
import { secret, type BotConfig, type Config } from '../config.js';
import { DeliveryError } from '../errors.js';
import { receive } from '../ingress.js';
import type { Command } from '../policy/quarantine.js';
import { Queue } from '../storage/queue.js';

export class DiscordConnection {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], allowedMentions: { parse: [], repliedUser: false } });
  constructor(private readonly bot: BotConfig, private readonly readConfig: () => Config, private readonly queue: Queue) {
    this.client.on(Events.MessageCreate, (message: Message) => {
      if (message.author.bot || message.webhookId || !message.guildId) return;
      try { receive(this.readConfig(), this.queue, { id: message.id, bot: bot.id, destination: message.channelId, guild: message.guildId, actor: message.author.id,
        kind: 'message', text: message.content, timestamp: message.createdTimestamp, hasAttachments: message.attachments.size > 0 }); }
      catch { this.queue.audit(null, null, 'ingress_failed', 'discord_ingress_failure'); }
    });
    this.client.on(Events.InteractionCreate, (interaction: Interaction) => { void this.onInteraction(interaction).catch(() => this.queue.audit(null, null, 'ingress_failed', 'discord_interaction_failure')); });
    this.client.on(Events.Error, () => this.queue.audit(null, null, 'provider_error', 'discord_gateway_error'));
    this.client.on(Events.ShardDisconnect, () => this.queue.audit(null, null, 'provider_error', 'discord_disconnected'));
  }
  async start(): Promise<void> { await this.client.login(secret(this.bot.tokenEnv)); }
  async close(): Promise<void> { await this.client.destroy(); }
  ready(): boolean { return this.client.isReady(); }
  private async onInteraction(i: Interaction): Promise<void> {
    if (!i.isButton() && !i.isStringSelectMenu() && !i.isChatInputCommand()) return;
    if (!i.guildId || !i.channelId) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const text = i.isChatInputCommand() ? i.commandName : i.isStringSelectMenu() ? `${i.customId} ${i.values.join(' ')}` : i.customId;
    const accepted = receive(this.readConfig(), this.queue, { id: i.id, bot: this.bot.id, destination: i.channelId, guild: i.guildId, actor: i.user.id,
      kind: 'action', text, timestamp: i.createdTimestamp });
    await i.editReply(accepted ? '受信しました。処理結果は利用サービスで確認してください。' : '接続許可または検査条件を満たさないため、サービスへ渡していません。');
  }
}

export async function discordSend(bot: BotConfig, destination: string, command: Command, nonce: string): Promise<string | null> {
  const suffix = command.messageId ? `/${command.messageId}` : '';
  const method = command.operation === 'send' ? 'POST' : command.operation === 'edit' ? 'PATCH' : 'DELETE';
  let response: Response;
  try {
    response = await fetch(`https://discord.com/api/v10/channels/${destination}/messages${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bot ${secret(bot.tokenEnv)}`, 'Content-Type': 'application/json' },
      body: method === 'DELETE' ? undefined : JSON.stringify({ content: command.text, allowed_mentions: { parse: [], replied_user: false }, flags: 4,
        ...(method === 'POST' ? { nonce: nonce.replaceAll('-', '').slice(0, 25), enforce_nonce: true } : {}) }),
    });
  } catch { throw new DeliveryError('discord_transport', undefined, true); }
  if (command.operation === 'delete' && response.status === 404) { await response.body?.cancel(); return null; }
  if (response.status === 429) {
    const body = await response.json().catch(() => null) as { retry_after?: unknown } | null;
    const delay = typeof body?.retry_after === 'number' ? Math.max(1000, body.retry_after * 1000) : 60000;
    throw new DeliveryError('discord_rate_limit', Math.min(delay, 86400000));
  }
  if (response.status >= 500) { await response.body?.cancel(); throw new DeliveryError('discord_remote_uncertain', undefined, true); }
  if (!response.ok) { await response.body?.cancel(); throw new DeliveryError(`discord_http_${response.status}`); }
  if (method === 'DELETE') { await response.body?.cancel(); return null; }
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== 'string' || !/^\d+$/.test(body.id)) throw new DeliveryError('discord_invalid_response', undefined, true);
  return body.id;
}

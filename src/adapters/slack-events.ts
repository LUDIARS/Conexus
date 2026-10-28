import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { receive } from '../ingress.js';
import { Queue } from '../storage/queue.js';

const SlackId = z.string().regex(/^[A-Z][A-Z0-9]+$/);
const MessageEnvelope = z.object({ team_id: SlackId, event_id: z.string().min(1).max(128), event: z.object({
  type: z.literal('message'), channel: SlackId, user: SlackId.optional(), text: z.string().max(8000).optional(),
  ts: z.string().regex(/^\d+\.\d+$/), bot_id: z.string().optional(), subtype: z.string().optional(), files: z.array(z.unknown()).optional(),
}) });
const ActionEnvelope = z.object({ type: z.literal('block_actions'), team: z.object({ id: SlackId }), user: z.object({ id: SlackId }),
  channel: z.object({ id: SlackId }), actions: z.array(z.object({ action_id: z.string().min(1).max(255), value: z.string().max(2000).optional(), action_ts: z.string().regex(/^\d+\.\d+$/) })).min(1).max(10) });
const SlashEnvelope = z.object({ team_id: SlackId, channel_id: SlackId, user_id: SlackId, command: z.string().min(1).max(100), text: z.string().max(2000), trigger_id: z.string().min(1).max(255) });

/** Only authenticated Socket Mode callers invoke this; never expose it as a public JSON webhook. */
export function slackEvent(config: Config, queue: Queue, bot: string, type: string, body: unknown, envelopeId: string): void {
  if (type === 'events_api') {
    const parsed = MessageEnvelope.safeParse(body);
    if (!parsed.success) { queue.audit(null, null, 'quarantined', 'unsupported_slack_event'); return; }
    const { event: e, team_id, event_id } = parsed.data;
    if (e.bot_id || e.subtype === 'bot_message' || e.subtype === 'message_changed' || e.subtype === 'message_deleted') return;
    if (!e.user || (e.subtype && e.subtype !== 'file_share')) { queue.audit(null, null, 'quarantined', 'unsupported_slack_message'); return; }
    receive(config, queue, { id: event_id, bot, team: team_id, destination: e.channel, actor: e.user,
      kind: 'message', text: e.text ?? '', timestamp: Math.floor(Number(e.ts) * 1000), hasAttachments: Boolean(e.files?.length) });
    return;
  }
  if (type === 'interactive') {
    const parsed = ActionEnvelope.safeParse(body);
    if (!parsed.success) { queue.audit(null, null, 'quarantined', 'unsupported_slack_action'); return; }
    const e = parsed.data;
    for (const a of e.actions) receive(config, queue, { id: `${e.user.id}:${a.action_ts}:${a.action_id}`, bot, team: e.team.id, destination: e.channel.id, actor: e.user.id,
      kind: 'action', text: `${a.action_id} ${a.value ?? ''}`, timestamp: Math.floor(Number(a.action_ts) * 1000) });
    return;
  }
  if (type === 'slash_commands') {
    const parsed = SlashEnvelope.safeParse(body);
    if (!parsed.success) { queue.audit(null, null, 'quarantined', 'unsupported_slack_command'); return; }
    const e = parsed.data;
    receive(config, queue, { id: createHash('sha256').update(e.trigger_id).digest('hex'), bot, team: e.team_id, destination: e.channel_id, actor: e.user_id,
      kind: 'action', text: `${e.command} ${e.text}`, timestamp: Date.now() });
    return;
  }
  queue.audit(null, null, 'quarantined', 'unsupported_slack_envelope');
}

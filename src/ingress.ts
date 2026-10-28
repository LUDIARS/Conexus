import type { Config } from './config.js';
import { BoundaryError } from './errors.js';
import { authorize } from './policy/auth.js';
import { sanitizeText } from './policy/quarantine.js';
import { Queue } from './storage/queue.js';

export interface ExternalEvent { id: string; bot: string; destination: string; guild?: string; team?: string; actor: string; kind: 'message' | 'action'; text: string; timestamp: number; hasAttachments?: boolean }
export interface InboxEvent { version: 1; trust: 'external-untrusted'; provider: 'discord' | 'line' | 'slack'; eventId: string; actor: string; destination: string; kind: 'message' | 'action'; text: string; timestamp: number }
export function receive(config: Config, queue: Queue, event: ExternalEvent): number {
  const bot = config.bots.find(b => b.id === event.bot && b.enabled);
  if (!bot) throw new BoundaryError('bot_disabled', 403);
  if (bot.platform === 'webhook' || bot.platform === 'email') throw new BoundaryError('provider_receive_unsupported', 403);
  if (!Number.isSafeInteger(event.timestamp) || event.timestamp < Date.now() - config.retentionDays * 86400000 || event.timestamp > Date.now() + 300000) {
    queue.audit(null, null, 'quarantined', 'event_outside_retention'); return 0;
  }
  const routes = config.routes.filter(r => r.bot === event.bot && r.destination === event.destination && r.guild === event.guild && r.team === event.team && r.enabled);
  let accepted = 0;
  for (const route of routes) {
    try {
      const service = config.services.find(s => s.id === route.service);
      if (!service) throw new BoundaryError('service_disabled', 403);
      authorize(config, service, route.id, 'receive');
      if (!route.actors.includes(event.actor)) throw new BoundaryError('actor_not_allowed', 403);
      if (event.hasAttachments) throw new BoundaryError('attachment_quarantined');
      const text = sanitizeText(event.text, config);
      const payload: InboxEvent = { version: 1, trust: 'external-untrusted', provider: bot.platform, eventId: event.id, actor: event.actor, destination: event.destination, kind: event.kind, text, timestamp: event.timestamp };
      queue.enqueue(route.service, route.id, 'in', event.id, payload, config.maxPending);
      accepted++;
    } catch (error) {
      if (!(error instanceof BoundaryError) || error.status >= 500) throw error;
      queue.audit(route.service, route.id, 'quarantined', error.code);
    }
  }
  if (!routes.length) queue.audit(null, null, 'quarantined', 'route_not_registered');
  return accepted;
}

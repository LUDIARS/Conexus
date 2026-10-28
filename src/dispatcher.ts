import type { Config } from './config.js';
import { BoundaryError, DeliveryError } from './errors.js';
import { authorize } from './policy/auth.js';
import { sanitizeCommand, type Command } from './policy/quarantine.js';
import { Queue } from './storage/queue.js';
import type { Senders } from './ports.js';
import { routeBinding } from './policy/route-binding.js';

export interface OutboundPayload { command: Command; credentialHash: string; binding: string }
export async function dispatchOne(readConfig: () => Config, queue: Queue, senders: Senders): Promise<boolean> {
  const job = queue.next(); if (!job) return false;
  try {
    const config = readConfig();
    const payload = queue.payload<OutboundPayload>(job);
    const service = config.services.find(s => s.id === job.service && s.enabled);
    if (!service || !service.tokens.some(t => t.hash === payload.credentialHash && Date.parse(t.expiresAt) > Date.now())) throw new BoundaryError('credential_revoked', 403);
    const command = sanitizeCommand(payload.command, config);
    const route = authorize(config, service, job.route, command.operation);
    if (payload.binding !== routeBinding(config, route)) throw new BoundaryError('route_binding_changed', 403);
    const bot = config.bots.find(b => b.id === route.bot && b.enabled);
    if (!bot) throw new BoundaryError('bot_disabled', 403);
    if (command.messageId && !queue.ownsMessage(service.id, route.id, command.messageId)) throw new BoundaryError('message_not_owned', 403);
    queue.start(job);
    const providerId = await senders[bot.platform](bot, route.destination, command, job.id);
    queue.finish(job, 'sent', 'provider_accepted', providerId);
  } catch (error) {
    if (error instanceof BoundaryError) queue.finish(job, 'failed', error.code);
    else if (error instanceof DeliveryError) {
      const retry = error.retryAfterMs !== undefined && job.attempts < 7 && Date.now() - job.created < 23 * 3600000;
      queue.finish(job, error.uncertain ? 'uncertain' : retry ? 'pending' : 'failed', error.code, null, error.retryAfterMs ?? 0);
    } else {
      // Includes persistence failure after a provider response: never re-send blindly.
      queue.finish(job, 'uncertain', 'internal_delivery_failure');
    }
  }
  return true;
}

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Config, OperationName, RouteConfig, ServiceConfig } from '../config.js';
import { BoundaryError } from '../errors.js';

export function authenticate(config: Config, header: string | undefined, now = Date.now()): ServiceConfig {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43,256}$/.test(header)) throw new BoundaryError('unauthorized', 401);
  const hash = createHash('sha256').update(header.slice(7)).digest();
  const found = config.services.find(s => s.enabled && s.tokens.some(t => Date.parse(t.expiresAt) > now && timingSafeEqual(hash, Buffer.from(t.hash, 'hex'))));
  if (!found) throw new BoundaryError('unauthorized', 401);
  return found;
}
export function authorize(config: Config, service: ServiceConfig, routeId: string, operation: OperationName): RouteConfig {
  const route = config.routes.find(r => r.id === routeId && r.enabled && r.service === service.id);
  if (!service.enabled || !route || !service.routes.includes(routeId) || !service.operations.includes(operation) || !route.operations.includes(operation)
    || !config.bots.some(b => b.id === route.bot && b.enabled)) throw new BoundaryError('forbidden', 403);
  return route;
}

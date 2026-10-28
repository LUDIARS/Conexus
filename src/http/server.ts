import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { BoundaryError } from '../errors.js';
import { authenticate, authorize } from '../policy/auth.js';
import { sanitizeCommand } from '../policy/quarantine.js';
import { Queue } from '../storage/queue.js';
import { lineWebhook } from '../adapters/line.js';
import { parseJson, readBody } from './body.js';
import { routeBinding } from '../policy/route-binding.js';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}
export function buildServer(readConfig: () => Config, queue: Queue, ready: () => boolean, accepting: () => boolean = ready): Server {
  // Bounded process-wide admission: no attacker-controlled key map or unbounded body buffering.
  let windowStart = Date.now(); let requests = 0; let concurrent = 0;
  const server = createServer((req, res) => {
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 1200 || concurrent >= 32) { json(res, 429, { error: 'rate_limited' }); req.resume(); return; }
    concurrent++;
    void handle(req, res).catch(error => {
      const known = error instanceof BoundaryError;
      if (!known) queue.audit(null, null, 'request_failed', 'internal_error');
      if (!res.headersSent) json(res, known ? error.status : 503, { error: known ? error.code : 'unavailable' });
      else res.destroy();
      req.resume();
    }).finally(() => { concurrent--; });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 30;
  server.keepAliveTimeout = 5000;
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const config = readConfig();
    if (!config.allowedHosts.includes(req.headers.host ?? '')) throw new BoundaryError('host_denied', 403);
    if (req.headers.origin) throw new BoundaryError('browser_origin_denied', 403);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/health') { json(res, 200, { service: 'conexus', live: true }); return; }
    const hook = /^\/hooks\/line\/([a-z][a-z0-9-]{0,63})$/.exec(path);
    if (hook && req.method === 'POST') {
      if (!accepting()) throw new BoundaryError('not_ready', 503);
      const bot = config.bots.find(b => b.id === hook[1] && b.platform === 'line' && b.enabled);
      if (!bot) throw new BoundaryError('not_found', 404);
      const signature = req.headers['x-line-signature'];
      lineWebhook(config, queue, bot, await readBody(req), typeof signature === 'string' ? signature : undefined);
      json(res, 200, { accepted: true }); return;
    }
    const service = authenticate(config, req.headers.authorization);
    if (req.method === 'GET' && path === '/v1/ready') { json(res, ready() ? 200 : 503, { ready: ready() }); return; }
    if (!accepting()) throw new BoundaryError('not_ready', 503);
    if (req.method === 'POST' && path === '/v1/messages') {
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new BoundaryError('idempotency_key_required');
      let command;
      try { command = sanitizeCommand(parseJson(await readBody(req, 32768)), config); }
      catch (error) { if (error instanceof BoundaryError) queue.audit(service.id, null, 'quarantined', error.code); throw error; }
      const route = authorize(config, service, command.route, command.operation);
      if (command.messageId && !queue.ownsMessage(service.id, route.id, command.messageId)) throw new BoundaryError('message_not_owned', 403);
      const credentialHash = createHash('sha256').update((req.headers.authorization ?? '').slice(7)).digest('hex');
      const binding = routeBinding(config, route);
      const result = queue.enqueue(service.id, command.route, 'out', key, { command, credentialHash, binding }, config.maxPending);
      json(res, result.duplicate ? 200 : 202, result); return;
    }
    if (req.method === 'GET' && path === '/v1/inbox') {
      if (!service.operations.includes('receive')) throw new BoundaryError('forbidden', 403);
      const items = queue.inbox(service.id).filter(job => {
        try { authorize(config, service, job.route, 'receive'); return true; } catch { return false; }
      }).map(job => ({ id: job.id, route: job.route, event: queue.payload(job) }));
      json(res, 200, { items }); return;
    }
    const ack = /^\/v1\/inbox\/([a-f0-9-]{36})\/ack$/.exec(path);
    if (req.method === 'POST' && ack?.[1]) {
      const job = queue.find(ack[1], service.id);
      if (!job) throw new BoundaryError('not_found', 404);
      authorize(config, service, job.route, 'receive'); queue.ack(job.id, service.id);
      json(res, 200, { acknowledged: true }); return;
    }
    const status = /^\/v1\/messages\/([a-f0-9-]{36})$/.exec(path);
    if (req.method === 'GET' && status?.[1]) {
      const job = queue.find(status[1], service.id);
      if (!job || job.direction !== 'out' || !service.routes.includes(job.route)) throw new BoundaryError('not_found', 404);
      json(res, 200, { id: job.id, state: job.state, reason: job.reason, providerId: job.provider_id, attempts: job.attempts }); return;
    }
    throw new BoundaryError('not_found', 404);
  }
  return server;
}

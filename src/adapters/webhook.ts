import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { secret } from '../config.js';
import { BoundaryError, DeliveryError } from '../errors.js';
import type { SendMessage } from '../ports.js';
import { assertPublicAddress, webhookTarget } from '../policy/webhook-target.js';

/** @implements NX-WEBHOOK-01 — resolve once, validate every answer and pin the socket. */
async function publicAddress(host: string): Promise<string> {
  const resolver = new Resolver({ timeout: 3000, tries: 1 });
  try {
    const addresses = await resolver.resolve4(host);
    if (!addresses.length) throw new BoundaryError('webhook_dns_empty');
    for (const address of addresses) assertPublicAddress(address);
    const first = addresses[0];
    if (!first) throw new BoundaryError('webhook_dns_empty');
    return first;
  } catch (error) {
    if (error instanceof BoundaryError) throw error;
    throw new DeliveryError('webhook_dns_failed');
  } finally { resolver.cancel(); }
}

/** @implements NX-WEBHOOK-02 — bounded single attempt; response bodies never enter logs. */
export const webhookSend: SendMessage = async (bot, destination, command, id) => {
  if (bot.platform !== 'webhook' || !bot.endpoint || command.operation !== 'send') throw new BoundaryError('webhook_operation_unsupported');
  const url = webhookTarget(bot.endpoint);
  const token = secret(bot.tokenEnv);
  if (!/^[A-Za-z0-9._~-]{16,4096}$/.test(token)) throw new BoundaryError('webhook_token_invalid');
  const address = await publicAddress(url.hostname);
  const body = Buffer.from(JSON.stringify({ version: 1, id, destination, text: command.text }), 'utf8');
  return new Promise<string | null>((resolve, reject) => {
    // A new socket with the original TLS hostname prevents DNS rebinding and redirect escapes.
    const req = request(url, {
      method: 'POST', agent: false, family: 4,
      lookup: (_host, _options, callback) => callback(null, address, 4),
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length,
        authorization: `Bearer ${token}`, 'idempotency-key': id },
      maxHeaderSize: 8192,
    }, response => {
      const status = response.statusCode ?? 0;
      // Acceptance is the status, not arbitrary data from the receiving service.
      response.destroy();
      if (status >= 200 && status < 300) resolve(id);
      else reject(new DeliveryError(status >= 500 ? 'webhook_result_unknown' : 'webhook_rejected', undefined, status >= 500));
    });
    const timer = setTimeout(() => req.destroy(new Error('deadline')), 10000);
    req.once('close', () => clearTimeout(timer));
    req.once('error', () => reject(new DeliveryError('webhook_transport_unknown', undefined, true)));
    req.end(body);
  });
};

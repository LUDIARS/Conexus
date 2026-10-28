import { BlockList, isIP } from 'node:net';
import { BoundaryError } from '../errors.js';

const denied = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) denied.addSubnet(network, prefix, 'ipv4');

/** @implements NX-WEBHOOK-01 — public IPv4 only until IPv6 policy is supported. */
export function assertPublicAddress(address: string): void {
  if (isIP(address) !== 4 || denied.check(address, 'ipv4')) throw new BoundaryError('webhook_address_denied', 403);
}

/** @implements NX-WEBHOOK-01 — no credentials, IP literals, alternate ports or query secrets. */
export function webhookTarget(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new BoundaryError('webhook_url_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || (url.port && url.port !== '443') || isIP(url.hostname) || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)
    || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) throw new BoundaryError('webhook_url_denied', 403);
  return url;
}

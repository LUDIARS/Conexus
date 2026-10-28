import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicAddress, webhookTarget } from '../src/policy/webhook-target.js';
import { routeBinding } from '../src/policy/route-binding.js';
import type { Config, RouteConfig } from '../src/config.js';

test('webhook endpoint rejects URL credential, query, redirects-by-configuration and non-HTTPS targets', () => {
  assert.equal(webhookTarget('https://receiver.example/events').pathname, '/events');
  for (const value of ['http://receiver.example/events', 'https://user:secret@receiver.example/',
    'https://receiver.example/?token=secret', 'https://127.0.0.1/', 'https://[::1]/',
    'https://receiver.example:8443/', 'https://receiver.local/']) assert.throws(() => webhookTarget(value));
});

test('webhook DNS policy rejects private, metadata, multicast, mapped and reserved addresses', () => {
  for (const value of ['0.0.0.0', '10.0.0.1', '100.100.100.200', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.0.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::ffff:127.0.0.1', '::1', 'invalid']) assert.throws(() => assertPublicAddress(value));
  assert.doesNotThrow(() => assertPublicAddress('8.8.8.8'));
});

test('pending webhook binding changes when endpoint or credential reference changes', () => {
  const bot = { id: 'partner', platform: 'webhook' as const, enabled: true, endpoint: 'https://first.example/events', tokenEnv: 'FIRST_TOKEN' };
  const config = { bots: [bot] } as Config;
  const route: RouteConfig = { id: 'notify', bot: 'partner', service: 'client', enabled: true, destination: 'recipient', actors: ['unused'], operations: ['send'] };
  const original = routeBinding(config, route);
  bot.endpoint = 'https://second.example/events';
  assert.notEqual(routeBinding(config, route), original);
  bot.endpoint = 'https://first.example/events'; bot.tokenEnv = 'SECOND_TOKEN';
  assert.notEqual(routeBinding(config, route), original);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../src/config.js';
import { sanitizeCommand } from '../src/policy/quarantine.js';
import { routeBinding } from '../src/policy/route-binding.js';

test('email subjects pass quarantine and cannot inject headers or raw HTML payloads', () => {
  const config = { urlHosts: [], bots: [{ id: 'mail', platform: 'email' }], routes: [{ id: 'notify', bot: 'mail' }] } as unknown as Config;
  const command = { route: 'notify', operation: 'send', subject: 'お知らせ', text: '本文' };
  assert.equal(sanitizeCommand(command, config).subject, 'お知らせ');
  for (const subject of ['', 'hello\r\nBcc: victim@example.com', `Bearer ${'a'.repeat(32)}`, 'https://unapproved.example/']) {
    assert.throws(() => sanitizeCommand({ ...command, subject }, config));
  }
  assert.throws(() => sanitizeCommand({ ...command, html: '<script>bad</script>' }, config));
  assert.throws(() => sanitizeCommand({ ...command, to: 'unapproved@example.com' }, config));
});

test('SMTP server and sender changes invalidate waiting messages', () => {
  const bot = { id: 'mail', platform: 'email' as const, enabled: true, tokenEnv: 'SMTP_PASSWORD', smtp: { host: 'smtp.example.com', user: 'account', from: 'first@example.com' } };
  const route = { id: 'notify', service: 'client', bot: 'mail', enabled: true, destination: 'recipient@example.com', actors: ['unused'], operations: ['send' as const] };
  const config = { bots: [bot] } as Config;
  const original = routeBinding(config, route);
  bot.smtp.from = 'second@example.com';
  assert.notEqual(routeBinding(config, route), original);
});

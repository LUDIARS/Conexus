import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ConfigSchema } from '../src/config.js';
import { authenticate, authorize } from '../src/policy/auth.js';
import { sanitizeCommand, sanitizeText } from '../src/policy/quarantine.js';
import { PayloadCipher } from '../src/storage/cipher.js';
import { openDatabase } from '../src/storage/database.js';
import { Queue } from '../src/storage/queue.js';
import { lineWebhook } from '../src/adapters/line.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchOne } from '../src/dispatcher.js';
import { DeliveryError } from '../src/errors.js';

const token = 'a'.repeat(43); // Synthetic fixture, never a live credential.
const fixture = () => ConfigSchema.parse({ version: 1, host: '127.0.0.1', port: 11230, allowedHosts: ['localhost:11230'], database: 'data/test.sqlite', encryptionKeyEnv: 'TEST_KEY', retentionDays: 7, maxPending: 100, urlHosts: [],
  services: [{ id: 'one', enabled: true, tokens: [{ hash: createHash('sha256').update(token).digest('hex'), expiresAt: '2099-01-01T00:00:00Z' }], routes: ['chat'], operations: ['send', 'receive'] }],
  bots: [{ id: 'line', enabled: true, platform: 'line', tokenEnv: 'TEST_TOKEN', secretEnv: 'TEST_SECRET' }],
  routes: [{ id: 'chat', service: 'one', bot: 'line', enabled: true, destination: 'user', actors: ['user'], operations: ['send', 'receive'] }],
});
test('credential and capability are both required, including loopback consumers', () => {
  const c = fixture();
  assert.throws(() => authenticate(c, undefined));
  assert.throws(() => authenticate(c, `Bearer ${'b'.repeat(43)}`));
  const service = authenticate(c, `Bearer ${token}`);
  assert.equal(authorize(c, service, 'chat', 'send').service, 'one');
  assert.throws(() => authorize(c, service, 'other', 'send'));
  assert.throws(() => authorize(c, service, 'chat', 'delete'));
  assert.throws(() => authenticate(c, `Bearer ${token}`, Date.parse('2100-01-01T00:00:00Z')));
});
test('both boundaries reject secrets/unsafe links and schema bypass', () => {
  const c = fixture();
  assert.equal(sanitizeText('日本語\u0000 @everyone', c), '日本語 @\u200beveryone');
  assert.throws(() => sanitizeText('https://evil.example/path', c));
  assert.throws(() => sanitizeText(`Bearer ${'x'.repeat(32)}`, c));
  assert.throws(() => sanitizeCommand({ route: 'chat', operation: 'send', text: 'ok', rawPayload: {} }, c));
});
test('cipher binds payload to its record and rejects tampering', () => {
  const cipher = new PayloadCipher('ab'.repeat(32)); const blob = cipher.seal({ text: '日本語' }, 'one');
  assert.deepEqual(cipher.open(blob, 'one'), { text: '日本語' });
  assert.throws(() => cipher.open(blob, 'two'));
  assert.ok(!blob.includes('日本語'));
});
test('durable queue enforces dedup conflicts, ownership, ack and uncertain recovery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'conexus-')); let db: DatabaseSync | undefined;
  try {
    db = openDatabase(join(directory, 'test.sqlite'));
    const queue = new Queue(db, new PayloadCipher('cd'.repeat(32)));
    const a = queue.enqueue('one', 'chat', 'in', 'event', { text: 'hello' }, 10);
    assert.equal(queue.enqueue('one', 'chat', 'in', 'event', { text: 'hello' }, 10).id, a.id);
    assert.throws(() => queue.enqueue('one', 'chat', 'in', 'event', { text: 'changed' }, 10));
    assert.throws(() => queue.ack(a.id, 'two'));
    queue.ack(a.id, 'one'); queue.ack(a.id, 'one'); assert.equal(queue.inbox('one').length, 0);
    queue.enqueue('one', 'chat', 'out', 'key', { text: 'hello' }, 10);
    const job = queue.next(); assert.ok(job); queue.start(job); queue.recover();
    assert.equal(queue.find(job.id, 'one')?.state, 'uncertain'); assert.equal(queue.next(), undefined);
  } finally { db?.close(); rmSync(directory, { recursive: true }); }
});
test('LINE verifies original bytes before parsing and deduplicates delivery', () => {
  const directory = mkdtempSync(join(tmpdir(), 'conexus-')); const db = openDatabase(join(directory, 'test.sqlite'));
  const previous = process.env.TEST_SECRET; process.env.TEST_SECRET = 'synthetic-line-secret';
  try {
    const c = fixture(); const bot = c.bots[0]; assert.ok(bot);
    const queue = new Queue(db, new PayloadCipher('ef'.repeat(32)));
    const raw = Buffer.from(JSON.stringify({ events: [{ type: 'message', webhookEventId: 'event', timestamp: Date.now(), source: { type: 'user', userId: 'user' }, message: { type: 'text', text: 'こんにちは' } }] }));
    const signature = createHmac('sha256', 'synthetic-line-secret').update(raw).digest('base64');
    assert.throws(() => lineWebhook(c, queue, bot, Buffer.concat([raw, Buffer.from(' ')]), signature));
    lineWebhook(c, queue, bot, raw, signature); lineWebhook(c, queue, bot, raw, signature);
    assert.equal(queue.inbox('one').length, 1);
  } finally { if (previous === undefined) delete process.env.TEST_SECRET; else process.env.TEST_SECRET = previous; db.close(); rmSync(directory, { recursive: true }); }
});

test('queued delivery rechecks revocation and preserves uncertain results without replay', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'conexus-dispatch-')); const db = openDatabase(join(directory, 'test.sqlite'));
  try {
    const config = fixture(); const queue = new Queue(db, new PayloadCipher('ab'.repeat(32)));
    const credentialHash = createHash('sha256').update(token).digest('hex');
    const payload = { command: { route: 'chat', operation: 'send', text: 'hello' }, credentialHash, binding: JSON.stringify(['line', 'user', null, null]) };
    const revoked = queue.enqueue('one', 'chat', 'out', 'revoked', payload, 100);
    const service = config.services[0]; assert.ok(service); service.tokens = [];
    let calls = 0;
    const send = async (): Promise<null> => { calls++; throw new DeliveryError('transport_unknown', undefined, true); };
    const senders = { discord: send, line: send, slack: send, webhook: send, email: send };
    await dispatchOne(() => config, queue, senders);
    assert.equal(calls, 0); assert.equal(queue.find(revoked.id, 'one')?.reason, 'credential_revoked');
    service.tokens = [{ hash: credentialHash, expiresAt: '2099-01-01T00:00:00Z' }];
    const uncertain = queue.enqueue('one', 'chat', 'out', 'uncertain', payload, 100);
    await dispatchOne(() => config, queue, senders);
    assert.equal(calls, 1); assert.equal(queue.find(uncertain.id, 'one')?.state, 'uncertain');
    assert.equal(await dispatchOne(() => config, queue, senders), false); assert.equal(calls, 1);
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});

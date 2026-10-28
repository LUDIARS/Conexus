import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../src/config.js';
import { openDatabase } from '../src/storage/database.js';
import { PayloadCipher } from '../src/storage/cipher.js';
import { Queue } from '../src/storage/queue.js';
import { slackEvent } from '../src/adapters/slack-events.js';
import { slackPlainText } from '../src/adapters/slack.js';

test('Slack markup is displayed as text without special mentions', () => {
  assert.equal(slackPlainText('<!channel> <@U123> &'), '&lt;!channel&gt; &lt;@U123&gt; &amp;');
});
test('Slack ingress isolates team, ignores bot echoes, quarantines files and deduplicates messages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'conexus-slack-')); const db = openDatabase(join(dir, 'queue.sqlite'));
  try {
    const config = ConfigSchema.parse({ version: 1, host: '127.0.0.1', port: 11230, allowedHosts: ['localhost'], database: 'unused', encryptionKeyEnv: 'TEST_KEY', retentionDays: 7, maxPending: 100, urlHosts: [],
      services: [{ id: 'consumer', enabled: true, tokens: [{ hash: createHash('sha256').update('synthetic').digest('hex'), expiresAt: '2099-01-01T00:00:00Z' }], routes: ['chat'], operations: ['receive'] }],
      bots: [{ id: 'slack', platform: 'slack', enabled: true, tokenEnv: 'TEST_BOT', appTokenEnv: 'TEST_APP' }],
      routes: [{ id: 'chat', service: 'consumer', bot: 'slack', enabled: true, destination: 'C123', team: 'T123', actors: ['U123'], operations: ['receive'] }] });
    const queue = new Queue(db, new PayloadCipher('ab'.repeat(32)));
    const body = { team_id: 'T123', event_id: 'Ev1', event: { type: 'message', channel: 'C123', user: 'U123', text: 'hello', ts: `${Math.floor(Date.now() / 1000)}.000001` } };
    slackEvent(config, queue, 'slack', 'events_api', { ...body, team_id: 'T999' }, 'env0');
    assert.equal(queue.inbox('consumer').length, 0);
    slackEvent(config, queue, 'slack', 'events_api', body, 'env1');
    slackEvent(config, queue, 'slack', 'events_api', body, 'env2');
    slackEvent(config, queue, 'slack', 'events_api', { ...body, event_id: 'Ev2', event: { ...body.event, bot_id: 'B123' } }, 'env3');
    slackEvent(config, queue, 'slack', 'events_api', { ...body, event_id: 'Ev3', event: { ...body.event, subtype: 'file_share', files: [{}] } }, 'env4');
    assert.equal(queue.inbox('consumer').length, 1);
    assert.ok(db.prepare("SELECT 1 FROM audit WHERE reason='attachment_quarantined'").get());
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});

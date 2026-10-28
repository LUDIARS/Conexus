import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { configPath, loadConfig, secret } from './config.js';
import { openDatabase } from './storage/database.js';
import { PayloadCipher } from './storage/cipher.js';
import { Queue } from './storage/queue.js';
import { buildServer } from './http/server.js';
import { DiscordConnection, discordSend } from './adapters/discord.js';
import { dispatchOne } from './dispatcher.js';
import { acquireLease } from './storage/lease.js';
import { SlackConnection, slackSend } from './adapters/slack.js';
import { lineSend } from './adapters/line.js';
import { webhookSend } from './adapters/webhook.js';
import { emailSend } from './adapters/email.js';

async function main(): Promise<void> {
  const path = configPath(); const initial = loadConfig(path);
  const readConfig = (): ReturnType<typeof loadConfig> => {
    const config = loadConfig(path);
    // Live authorization changes are safe; changing transport/storage requires controlled restart.
    for (const key of ['host', 'port', 'database', 'encryptionKeyEnv', 'bots'] as const) {
      if (JSON.stringify(config[key]) !== JSON.stringify(initial[key])) throw new Error('restart_required');
    }
    return config;
  };
  for (const bot of initial.bots.filter(b => b.enabled)) {
    secret(bot.tokenEnv); if (bot.secretEnv) secret(bot.secretEnv); if (bot.appTokenEnv) secret(bot.appTokenEnv);
  }
  const cipher = new PayloadCipher(secret(initial.encryptionKeyEnv));
  const release = acquireLease(resolve(initial.database));
  let db: ReturnType<typeof openDatabase>;
  try { db = openDatabase(resolve(initial.database)); } catch (error) { release(); throw error; }
  const queue = new Queue(db, cipher);
  let running = true; let initialized = false;
  const connections = initial.bots.filter(b => b.enabled && (b.platform === 'discord' || b.platform === 'slack')).map(b => b.platform === 'slack' ? new SlackConnection(b, readConfig, queue) : new DiscordConnection(b, readConfig, queue));
  const server = buildServer(readConfig, queue, () => initialized && connections.every(c => c.ready()), () => initialized);
  let worker: Promise<void> | undefined;
  const stop = (): void => { running = false; initialized = false; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(initial.port, initial.host, done); });
    queue.recover();
    initialized = true;
    for (const connection of connections) {
      try { await connection.start(); } catch { queue.audit(null, null, 'provider_error', 'connection_start_failed'); }
    }
    worker = (async () => {
      let nextPrune = 0;
      while (running) {
        if (Date.now() >= nextPrune) { queue.prune(readConfig().retentionDays); nextPrune = Date.now() + 60000; }
        if (!await dispatchOne(readConfig, queue, { discord: discordSend, line: lineSend, slack: slackSend, webhook: webhookSend, email: emailSend })) await pause(250);
      }
    })();
    await worker;
  } finally {
    stop();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    const closed = await Promise.allSettled(connections.map(c => c.close()));
    for (const result of closed) if (result.status === 'rejected') queue.audit(null, null, 'provider_error', 'connection_close_failed');
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    try { db.close(); } finally { release(); }
  }
}
void main().catch(() => { process.stderr.write('[fatal] Conexus stopped: configuration, transport or storage failure; inspect local configuration and protected audit records.\n'); process.exitCode = 1; });

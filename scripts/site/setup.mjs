import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
// Excubitor invokes this with Node; use the matching npm CLI without a command shell.
const candidates = [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
const npm = candidates.find(existsSync);
if (!npm) throw new Error('matching_npm_cli_missing');
for (const args of [['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']]) {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd: root, stdio: 'inherit', shell: false, timeout: 600000 });
  if (result.error || result.status !== 0) throw new Error('setup_step_failed');
}
const { loadConfig, configPath, secret } = await import('../../dist/src/config.js');
const config = loadConfig(configPath());
secret(config.encryptionKeyEnv);
for (const bot of config.bots.filter(b => b.enabled)) { secret(bot.tokenEnv); if (bot.secretEnv) secret(bot.secretEnv); if (bot.appTokenEnv) secret(bot.appTokenEnv); }
const { PayloadCipher } = await import('../../dist/src/storage/cipher.js');
const { openDatabase } = await import('../../dist/src/storage/database.js');
const { acquireLease } = await import('../../dist/src/storage/lease.js');
new PayloadCipher(secret(config.encryptionKeyEnv));
const release = acquireLease(resolve(config.database));
try { const db = openDatabase(resolve(config.database)); db.close(); } finally { release(); }
createRequire(import.meta.url).resolve('discord.js');

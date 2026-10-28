import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync, linkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { database, config, stopped, arg, hash, taildrop, prepareParent, acquireDataLease } from './data-common.mjs';
import { PayloadCipher } from '../../dist/src/storage/cipher.js';
stopped();
const input = arg('--input'); const expected = arg('--sha256');
taildrop(input);
if (!/^[a-f0-9]{64}$/i.test(expected) || statSync(input).size > 256 * 1024 * 1024) throw new Error('invalid_bundle');
if ([database, `${database}-wal`, `${database}-shm`].some(existsSync)) throw new Error('existing_database_not_overwritten');
const bytes = readFileSync(input);
if (hash(bytes) !== expected.toLowerCase()) throw new Error('bundle_hash_mismatch');
const bundle = JSON.parse(bytes.toString('utf8'));
if (bundle.service !== 'conexus' || bundle.version !== 1 || typeof bundle.database !== 'string') throw new Error('unsupported_bundle');
const data = Buffer.from(bundle.database, 'base64');
if (hash(data) !== bundle.databaseSha256) throw new Error('database_hash_mismatch');
prepareParent();
const temporary = `${database}.${randomUUID()}.import`;
const cipher = new PayloadCipher(process.env[config.encryptionKeyEnv] ?? '');
const release = acquireDataLease();
try {
  writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  const db = new DatabaseSync(temporary, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').get();
    if (result?.integrity_check !== 'ok') throw new Error('database_integrity_failed');
    for (const table of ['jobs', 'audit', 'messages']) if (!db.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table', table)) throw new Error('database_schema_missing');
    if (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").get()) throw new Error('unexpected_database_objects');
    for (const row of db.prepare("SELECT id,payload FROM jobs WHERE payload<>''").iterate()) cipher.open(row.payload, row.id);
  } finally { db.close(); }
  // Same-volume hard link fails atomically if the destination was created concurrently.
  linkSync(temporary, database);
} finally { try { if (existsSync(temporary)) unlinkSync(temporary); } finally { release(); } }

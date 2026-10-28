import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { database, stopped, arg, hash, acquireDataLease } from './data-common.mjs';
stopped();
const output = arg('--output');
if (!isAbsolute(output) || existsSync(output)) throw new Error('output_must_be_new_absolute_file');
const temporary = `${output}.${randomUUID()}.sqlite`;
const release = acquireDataLease();
let db;
try {
  db = new DatabaseSync(database, { readOnly: true });
  await backup(db, temporary);
  const data = readFileSync(temporary);
  writeFileSync(output, JSON.stringify({ service: 'conexus', version: 1, databaseSha256: hash(data), database: data.toString('base64') }), { flag: 'wx', mode: 0o600 });
} finally { try { db?.close(); if (existsSync(temporary)) unlinkSync(temporary); } finally { release(); } }

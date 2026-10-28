import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, service TEXT NOT NULL, route TEXT NOT NULL, direction TEXT NOT NULL,
      dedup TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL,
      created INTEGER NOT NULL, updated INTEGER NOT NULL, reason TEXT, provider_id TEXT,
      UNIQUE(service, route, direction, dedup));
    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(direction,state,available);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time INTEGER NOT NULL,
      service TEXT, route TEXT, action TEXT NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (service TEXT NOT NULL, route TEXT NOT NULL,
      provider_id TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(service,route,provider_id));`);
  return db;
}

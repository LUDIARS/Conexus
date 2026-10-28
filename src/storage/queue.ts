import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BoundaryError } from '../errors.js';
import { PayloadCipher } from './cipher.js';

export interface Job { id: string; service: string; route: string; direction: string; dedup: string; fingerprint: string; payload: string; state: string; attempts: number; available: number; created: number; updated: number; reason: string | null; provider_id: string | null }
export class Queue {
  constructor(readonly db: DatabaseSync, private readonly cipher: PayloadCipher, private readonly now: () => number = Date.now) {}
  audit(service: string | null, route: string | null, action: string, reason: string): void {
    this.db.prepare('INSERT INTO audit(time,service,route,action,reason) VALUES(?,?,?,?,?)').run(this.now(), service, route, action, reason);
  }
  enqueue(service: string, route: string, direction: 'in' | 'out', dedup: string, payload: unknown, limit: number): { id: string; duplicate: boolean } {
    // Socket slash commands lack a stable event timestamp; retain the first receipt time but dedup by content.
    const canonical = direction === 'in' && payload && typeof payload === 'object' ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'timestamp')) : payload;
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT id,fingerprint FROM jobs WHERE service=? AND route=? AND direction=? AND dedup=?').get(service, route, direction, dedup);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new BoundaryError('idempotency_conflict', 409);
        this.db.exec('COMMIT'); return { id: String(old.id), duplicate: true };
      }
      const count = this.db.prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('pending','sending','uncertain')").get();
      if (Number(count?.n) >= limit) throw new BoundaryError('queue_full', 503);
      const id = randomUUID(); const time = this.now();
      this.db.prepare('INSERT INTO jobs(id,service,route,direction,dedup,fingerprint,payload,state,available,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, service, route, direction, dedup, fingerprint, this.cipher.seal(payload, id), 'pending', time, time, time);
      this.audit(service, route, 'accepted', direction);
      this.db.exec('COMMIT'); return { id, duplicate: false };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  payload<T>(job: Job): T { return this.cipher.open<T>(job.payload, job.id); }
  find(id: string, service: string): Job | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id=? AND service=?').get(id, service) as unknown as Job | undefined;
  }
  inbox(service: string): Job[] {
    return this.db.prepare("SELECT * FROM jobs WHERE service=? AND direction='in' AND state='pending' ORDER BY created,id LIMIT 100").all(service) as unknown as Job[];
  }
  ack(id: string, service: string): void {
    const job = this.find(id, service);
    if (!job || job.direction !== 'in') throw new BoundaryError('not_found', 404);
    if (job.state === 'acked') return;
    if (job.state !== 'pending') throw new BoundaryError('not_pending', 409);
    this.finish(job, 'acked', 'consumer_ack');
  }
  recover(): void { this.db.prepare("UPDATE jobs SET state='uncertain',reason='process_interrupted',updated=? WHERE state='sending'").run(this.now()); }
  next(): Job | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE direction='out' AND state='pending' AND available<=? ORDER BY created,id LIMIT 1").get(this.now()) as unknown as Job | undefined;
  }
  start(job: Job): void { this.db.prepare("UPDATE jobs SET state='sending',attempts=attempts+1,updated=? WHERE id=? AND state='pending'").run(this.now(), job.id); }
  finish(job: Job, state: string, reason: string, providerId: string | null = null, delay = 0): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE jobs SET state=?,reason=?,provider_id=?,available=?,updated=? WHERE id=?').run(state, reason, providerId, this.now() + delay, this.now(), job.id);
      if (state === 'sent' && providerId) this.db.prepare('INSERT OR IGNORE INTO messages(service,route,provider_id,created) VALUES(?,?,?,?)').run(job.service, job.route, providerId, this.now());
      this.audit(job.service, job.route, state, reason);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  ownsMessage(service: string, route: string, id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM messages WHERE service=? AND route=? AND provider_id=?').get(service, route, id));
  }
  prune(days: number): void {
    const cutoff = this.now() - days * 86400000;
    // Preserve unresolved work, remove its payload on expiry without pretending delivery succeeded.
    this.db.prepare("UPDATE jobs SET state='expired',reason='retention_expired',payload='',updated=? WHERE created<? AND state IN ('pending','uncertain')").run(this.now(), cutoff);
    this.db.prepare("DELETE FROM jobs WHERE updated<? AND state IN ('sent','failed','acked','expired')").run(cutoff);
    this.db.prepare('DELETE FROM audit WHERE time<?').run(cutoff);
    this.db.prepare('DELETE FROM messages WHERE created<?').run(cutoff);
  }
  summary(): unknown { return this.db.prepare('SELECT direction,state,count(*) AS count FROM jobs GROUP BY direction,state').all(); }
}

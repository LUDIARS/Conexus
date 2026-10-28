import { openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** Fail closed after a crash: only an operator confirming process exit may remove a stale marker. */
export function acquireLease(database: string): () => void {
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const marker = `${database}.running`;
  const fd = openSync(marker, 'wx', 0o600);
  return () => { closeSync(fd); unlinkSync(marker); };
}

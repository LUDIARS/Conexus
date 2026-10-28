import { existsSync, readFileSync, realpathSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const config = JSON.parse(readFileSync(resolve(root, process.env.CONEXUS_CONFIG ?? 'conexus.config.json'), 'utf8'));
export const database = resolve(root, config.database);
export function stopped() { if (existsSync(`${database}.running`)) throw new Error('service_must_be_stopped'); }
export function arg(name) { const i = process.argv.indexOf(name); const value = i < 0 ? undefined : process.argv[i + 1]; if (!value) throw new Error(`missing_${name}`); return value; }
export const hash = data => createHash('sha256').update(data).digest('hex');
export function taildrop(input) {
  const home = process.env.EXCUBITOR_TAILDROP_DIR;
  if (!home || !isAbsolute(input)) throw new Error('taildrop_absolute_input_required');
  const rel = relative(realpathSync(home), realpathSync(input));
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('input_outside_taildrop');
}
export function prepareParent() { mkdirSync(dirname(database), { recursive: true, mode: 0o700 }); }
export function acquireDataLease() {
  prepareParent();
  const marker = `${database}.running`; const fd = openSync(marker, 'wx', 0o600);
  return () => { closeSync(fd); unlinkSync(marker); };
}

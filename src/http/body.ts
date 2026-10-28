import type { IncomingMessage } from 'node:http';
import { BoundaryError } from '../errors.js';
export async function readBody(req: IncomingMessage, maxBytes = 1048576): Promise<Buffer> {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new BoundaryError('encoding_not_supported', 415);
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new BoundaryError('json_required', 415);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new BoundaryError('body_too_large', 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
export function parseJson(raw: Buffer): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new BoundaryError('invalid_json'); }
}

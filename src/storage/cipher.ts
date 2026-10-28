import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export class PayloadCipher {
  private readonly key: Buffer;
  constructor(encodedKey: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(encodedKey)) throw new Error('data_key_must_be_32_bytes_hex');
    this.key = Buffer.from(encodedKey, 'hex');
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString('base64');
  }
  open<T>(encoded: string, context: string): T {
    const data = Buffer.from(encoded, 'base64');
    const d = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    d.setAAD(Buffer.from(context)); d.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(data.subarray(28)), d.final()]).toString('utf8')) as T;
  }
}

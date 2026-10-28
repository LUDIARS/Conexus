import { z } from 'zod';
import type { Config } from '../config.js';
import { BoundaryError } from '../errors.js';

export const CommandSchema = z.object({
  route: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  operation: z.enum(['send', 'edit', 'delete']),
  text: z.string().max(8000).optional(),
  subject: z.string().min(1).max(200).optional(),
  messageId: z.string().regex(/^[0-9]{1,30}(?:\.[0-9]{1,10})?$/).optional(),
}).strict();
export type Command = z.infer<typeof CommandSchema>;

export function sanitizeText(input: string, config: Pick<Config, 'urlHosts'>): string {
  const value = input.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  if (!value.trim() || value.length > 2000) throw new BoundaryError('text_size');
  if (/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9_.-]{16,}|\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,})/i.test(value)) throw new BoundaryError('suspected_secret');
  if (/(?:javascript|data|file|vbscript):/i.test(value)) throw new BoundaryError('unsafe_url');
  for (const match of value.matchAll(/https?:\/\/[^\s<>"\)]+/gi)) {
    let url: URL;
    try { url = new URL(match[0]); } catch { throw new BoundaryError('invalid_url'); }
    if (url.protocol !== 'https:' || url.username || url.password || !config.urlHosts.includes(url.hostname.toLowerCase())) throw new BoundaryError('url_not_allowed');
  }
  // Text is still untrusted data; this is neither an HTML renderer nor an AI authorization gate.
  return value.replace(/@(everyone|here)/gi, '@\u200b$1');
}
export function sanitizeCommand(raw: unknown, config: Config): Command {
  const parsed = CommandSchema.safeParse(raw);
  if (!parsed.success) throw new BoundaryError('invalid_command');
  const c = parsed.data;
  const route = config.routes.find(r => r.id === c.route);
  const bot = config.bots.find(b => b.id === route?.bot);
  if (bot?.platform === 'email') {
    if (!c.subject || /[\x00-\x1f\x7f]/.test(c.subject)) throw new BoundaryError('email_subject_invalid');
    c.subject = sanitizeText(c.subject, config);
  } else if (c.subject !== undefined) throw new BoundaryError('unexpected_subject');
  if (c.operation === 'send' && c.messageId) throw new BoundaryError('unexpected_message_id');
  if (c.operation !== 'send' && !c.messageId) throw new BoundaryError('message_id_required');
  if (c.operation === 'delete' && c.text !== undefined) throw new BoundaryError('unexpected_text');
  if (c.operation !== 'delete') c.text = sanitizeText(c.text ?? '', config);
  return c;
}

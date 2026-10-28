import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { webhookTarget } from './policy/webhook-target.js';

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const Env = z.string().regex(/^[A-Z][A-Z0-9_]+$/);
export const Operation = z.enum(['send', 'edit', 'delete', 'receive']);
const Token = z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.iso.datetime() }).strict();
const Service = z.object({ id: Id, enabled: z.boolean(), tokens: z.array(Token).min(1), routes: z.array(Id), operations: z.array(Operation) }).strict();
const Smtp = z.object({ host: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i), user: z.string().min(1).max(256).regex(/^[^\r\n\x00]+$/), from: z.email().max(254) }).strict();
const Bot = z.object({ id: Id, platform: z.enum(['discord', 'line', 'slack', 'webhook', 'email']), enabled: z.boolean(), tokenEnv: Env, secretEnv: Env.optional(), appTokenEnv: Env.optional(), endpoint: z.string().max(2048).optional(), smtp: Smtp.optional() }).strict();
const Route = z.object({ id: Id, service: Id, bot: Id, enabled: z.boolean(), destination: z.string().min(1).max(254), guild: z.string().regex(/^\d+$/).optional(), team: z.string().regex(/^T[A-Z0-9]+$/).optional(), actors: z.array(z.string().min(1).max(128)).min(1), operations: z.array(Operation).min(1) }).strict();
export const ConfigSchema = z.object({
  version: z.literal(1), host: z.enum(['127.0.0.1', '::1']), port: z.number().int().min(1024).max(65535),
  allowedHosts: z.array(z.string().min(1)).min(1), database: z.string().min(1), encryptionKeyEnv: Env,
  retentionDays: z.number().int().min(1).max(90), maxPending: z.number().int().min(1).max(100000),
  urlHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)), services: z.array(Service), bots: z.array(Bot), routes: z.array(Route),
}).strict();
export type Config = z.infer<typeof ConfigSchema>;
export type ServiceConfig = z.infer<typeof Service>;
export type BotConfig = z.infer<typeof Bot>;
export type RouteConfig = z.infer<typeof Route>;
export type OperationName = z.infer<typeof Operation>;

export function loadConfig(path: string): Config {
  if (statSync(path).size > 262144) throw new Error('config_too_large');
  const config = ConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  for (const list of [config.services, config.bots, config.routes]) {
    if (new Set(list.map(x => x.id)).size !== list.length) throw new Error('duplicate_config_id');
  }
  const hashes = config.services.flatMap(s => s.tokens.map(t => t.hash));
  if (new Set(hashes).size !== hashes.length) throw new Error('duplicate_service_credential');
  for (const bot of config.bots) {
    if (bot.platform === 'line' && !bot.secretEnv) throw new Error('line_secret_reference_required');
    if (bot.platform === 'slack' && !bot.appTokenEnv) throw new Error('slack_app_token_reference_required');
    if (bot.platform === 'webhook') { if (!bot.endpoint) throw new Error('webhook_endpoint_required'); webhookTarget(bot.endpoint); }
    else if (bot.endpoint) throw new Error('unexpected_endpoint');
    if (bot.platform === 'email' && !bot.smtp) throw new Error('smtp_config_required');
    if (bot.platform !== 'email' && bot.smtp) throw new Error('unexpected_smtp_config');
  }
  for (const route of config.routes) {
    const service = config.services.find(s => s.id === route.service);
    const bot = config.bots.find(b => b.id === route.bot);
    if (!service || !bot || !service.routes.includes(route.id)) throw new Error('unbound_route');
    if (bot.platform === 'email') { if (!z.email().safeParse(route.destination).success) throw new Error('email_destination_invalid'); }
    else if (!/^[A-Za-z0-9_-]{1,128}$/.test(route.destination)) throw new Error('destination_invalid');
    if (bot.platform === 'discord' && (!route.guild || !/^\d+$/.test(route.destination))) throw new Error('discord_route_requires_guild_channel');
    if (bot.platform === 'slack' && (!route.team || !/^[CDG][A-Z0-9]+$/.test(route.destination))) throw new Error('slack_route_requires_team_channel');
    if ((bot.platform !== 'discord' && route.guild) || (bot.platform !== 'slack' && route.team)) throw new Error('unexpected_platform_scope');
    if (bot.platform === 'line' && route.operations.some(o => o === 'edit' || o === 'delete')) throw new Error('line_operation_unsupported');
    if (bot.platform === 'webhook' && route.operations.some(o => o !== 'send')) throw new Error('webhook_operation_unsupported');
    if (bot.platform === 'email' && route.operations.some(o => o !== 'send')) throw new Error('email_operation_unsupported');
  }
  for (const service of config.services) {
    if (service.routes.some(id => !config.routes.some(r => r.id === id && r.service === service.id))) throw new Error('invalid_service_route');
  }
  return config;
}
export const configPath = (): string => resolve(process.env.CONEXUS_CONFIG ?? 'conexus.config.json');
export function secret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 16) throw new Error('required_secret_missing');
  return value;
}

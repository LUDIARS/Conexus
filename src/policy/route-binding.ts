import type { Config, RouteConfig } from '../config.js';

/** @implements NX-AUTH-03 — endpoint changes must invalidate pending delivery, including after restart. */
export function routeBinding(config: Config, route: RouteConfig): string {
  const bot = config.bots.find(b => b.id === route.bot);
  const parts: (string | null)[] = [route.bot, route.destination, route.guild ?? null, route.team ?? null];
  if (bot?.platform === 'webhook') parts.push(bot.platform, bot.endpoint ?? null, bot.tokenEnv);
  if (bot?.platform === 'email') parts.push(bot.platform, JSON.stringify(bot.smtp), bot.tokenEnv);
  return JSON.stringify(parts);
}

import type { BotConfig } from './config.js';
import type { Command } from './policy/quarantine.js';
export type SendMessage = (bot: BotConfig, destination: string, command: Command, id: string) => Promise<string | null>;
export type Senders = Readonly<Record<BotConfig['platform'], SendMessage>>;

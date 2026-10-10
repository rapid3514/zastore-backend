import type { LoggerService } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/configuration.js';

const sensitiveKey = /authorization|cookie|token|password|secret|private.?key|database.?url|connection.?string/i;

export function redactLogValue(value: unknown, secrets: readonly string[] = [], seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    let text = value.replace(/\b(?:postgres(?:ql)?|rediss?):\/\/\S+/gi, '[REDACTED_CONNECTION]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
      .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot[REDACTED]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
    for (const secret of secrets) if (secret.length >= 4) text = text.replaceAll(secret, '[REDACTED]');
    return text;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (value instanceof Error) return { name: value.name, message: redactLogValue(value.message, secrets, seen) };
  if (Array.isArray(value)) return value.map((entry) => redactLogValue(entry, secrets, seen));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sensitiveKey.test(key) ? '[REDACTED]' : redactLogValue(entry, secrets, seen)]));
}

export class RedactingLogger implements LoggerService {
  private readonly secrets: string[];

  constructor(config: RuntimeConfig) {
    this.secrets = [config.auth.accessSecret, config.auth.refreshSecret, config.telegram.botToken, config.telegram.webhookSecret, config.media.privateKey, config.database.url, config.redis.url].filter((value): value is string => Boolean(value));
  }

  log(message: unknown, ...optionalParams: unknown[]): void { this.write('info', message, optionalParams); }
  error(message: unknown, ...optionalParams: unknown[]): void { this.write('error', message, optionalParams); }
  warn(message: unknown, ...optionalParams: unknown[]): void { this.write('warn', message, optionalParams); }
  debug(message: unknown, ...optionalParams: unknown[]): void { this.write('debug', message, optionalParams); }
  verbose(message: unknown, ...optionalParams: unknown[]): void { this.write('trace', message, optionalParams); }
  fatal(message: unknown, ...optionalParams: unknown[]): void { this.write('fatal', message, optionalParams); }

  private write(level: string, message: unknown, context: unknown[]): void {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), level, message: redactLogValue(message, this.secrets), context: redactLogValue(context, this.secrets) });
    (level === 'error' || level === 'fatal' ? process.stderr : process.stdout).write(`${line}\n`);
  }
}

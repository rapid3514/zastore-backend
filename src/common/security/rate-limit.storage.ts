import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { createClient } from 'redis';
import { getConfiguration } from '../../config/configuration.js';

const incrementScript = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blocked} end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

@Injectable()
export class RateLimitStorage implements ThrottlerStorage, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitStorage.name);
  private readonly memory = new ThrottlerStorageService();
  private readonly client: ReturnType<typeof createClient> | undefined;
  private connection: Promise<void> | undefined;

  constructor(configService: ConfigService) {
    const config = getConfiguration(configService);
    if (config.redis.url) {
      this.client = createClient({ url: config.redis.url, disableOfflineQueue: true, socket: { connectTimeout: 5000, reconnectStrategy: (retries) => Math.min(1000 + retries * 100, 5000) } });
      this.client.on('error', () => this.logger.error('Shared rate-limit storage unavailable'));
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) return;
    if (this.client.isReady) return;
    this.connection ??= this.connectSharedStorage();
    await this.connection;
  }

  private async connectSharedStorage(): Promise<void> {
    if (!this.client) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.client.connect(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Rate-limit startup timed out')), 6000); })]);
    } catch {
      if (this.client.isOpen) this.client.destroy();
      throw new Error('Shared request protection could not start');
    } finally { if (timer) clearTimeout(timer); }
  }
  async onModuleDestroy(): Promise<void> { if (this.client?.isOpen) await this.client.close(); this.memory.onApplicationShutdown(); }

  async ping(): Promise<void> {
    if (!this.client) return;
    if (!this.client.isReady) throw new Error('Shared request protection is not connected');
    if (await this.client.ping() !== 'PONG') throw new Error('Unexpected Redis health response');
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    if (!this.client) return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    try {
      const result: unknown = await this.client.eval(incrementScript, { keys: [`rate:{${key}}:hits`, `rate:{${key}}:blocked`], arguments: [String(ttl), String(limit), String(blockDuration)] });
      if (!Array.isArray(result) || result.length !== 4 || !result.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) throw new Error('Invalid storage response');
      const [totalHits, expiry, blocked, blockedExpiry] = result as number[];
      return { totalHits, timeToExpire: Math.max(0, Math.ceil(expiry / 1000)), isBlocked: blocked === 1, timeToBlockExpire: Math.max(0, Math.ceil(blockedExpiry / 1000)) };
    } catch {
      this.logger.error('Rate-limit request failed');
      throw new ServiceUnavailableException('Request protection temporarily unavailable');
    }
  }
}

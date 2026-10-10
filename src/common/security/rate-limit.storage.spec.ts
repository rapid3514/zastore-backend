import { describe, expect, it, vi } from 'vitest';
import { createConfigService } from '../../../test/helpers/config.js';
import { RateLimitStorage } from './rate-limit.storage.js';

const redisState = vi.hoisted(() => ({ ready: false, connectCalls: 0 }));

vi.mock('redis', () => ({
  createClient: () => ({
    on: () => undefined,
    get isOpen() { return redisState.ready; },
    get isReady() { return redisState.ready; },
    connect: async () => {
      redisState.connectCalls += 1;
      if (redisState.ready) throw new Error('Socket already opened');
      redisState.ready = true;
    },
    close: async () => { redisState.ready = false; },
    destroy: () => { redisState.ready = false; },
  }),
}));

describe('shared rate-limit storage lifecycle', () => {
  it('connects once when Nest initializes the exported provider repeatedly', async () => {
    redisState.ready = false;
    redisState.connectCalls = 0;
    const storage = new RateLimitStorage(createConfigService({ REDIS_URL: 'redis://127.0.0.1:6379' }));
    await Promise.all([storage.onModuleInit(), storage.onModuleInit()]);
    await storage.onModuleInit();
    expect(redisState.connectCalls).toBe(1);
    await storage.onModuleDestroy();
  });
});

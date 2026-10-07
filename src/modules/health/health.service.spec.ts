import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service.js';

describe('HealthService', () => {
  const prisma = { $queryRaw: vi.fn() };
  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HealthService(prisma as never);
  });

  it('returns database up when the probe succeeds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
      timestamp: expect.any(String),
    });
  });

  it('returns 503 when the database probe fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await service.check().catch((error: ServiceUnavailableException) => {
      expect(error.getStatus()).toBe(503);
    });
  });
});

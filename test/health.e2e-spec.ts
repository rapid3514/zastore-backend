import { RequestMethod, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { HealthController } from '../src/modules/health/health.controller.js';
import { HealthService } from '../src/modules/health/health.service.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [{ path: 'health', method: RequestMethod.GET }],
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('returns 200 and only non-sensitive health fields', async () => {
    prisma.$queryRaw.mockResolvedValue([{ result: 1 }]);
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('JWT_SECRET');
    expect(serialized).not.toContain('BOT_TOKEN');
  });

  it('returns 503 when the database probe fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection failed'));

    await request(app.getHttpServer()).get('/health').expect(503);
  });
});

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('Telegram webhook registration', () => {
  let app: INestApplication;
  const telegramService = { handleUpdate: vi.fn() };

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '3000',
      API_PREFIX: 'api/v1',
      TZ: 'Asia/Tashkent',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
      JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
      MINI_APP_URL: 'https://mini-app.example/app',
      CORS_ORIGINS: 'https://mini-app.example',
    });

    const [{ AppModule }, { PrismaService }, { TelegramService }] =
      await Promise.all([
        import('../../app.module.js'),
        import('../../database/prisma.service.js'),
        import('./telegram.service.js'),
      ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(TelegramService)
      .useValue(telegramService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers POST /api/v1/telegram/webhook in AppModule', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret')
      .send({ update_id: 1 })
      .expect(200, { ok: true });

    expect(telegramService.handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
  });

  it('rejects an invalid Telegram webhook secret', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret')
      .send({ update_id: 2 })
      .expect(401);
  });
});

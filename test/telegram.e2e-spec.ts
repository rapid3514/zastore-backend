import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { UserRole } from '../src/generated/prisma/client.js';
import { TelegramController } from '../src/modules/telegram/telegram.controller.js';
import { postTelegram } from '../src/modules/telegram/telegram-api.js';
import { TelegramService } from '../src/modules/telegram/telegram.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';

vi.mock('../src/modules/telegram/telegram-api.js', () => ({
  postTelegram: vi.fn(),
}));

describe('Telegram registration webhook (e2e)', () => {
  let app: INestApplication;
  const postTelegramMock = vi.mocked(postTelegram);
  const usersRepository = {
    findByTelegramId: vi.fn(),
    findById: vi.fn(),
    findByPhone: vi.fn(),
    upsertFromTelegramContact: vi.fn(),
    promoteGuestToCustomer: vi.fn(),
  };

  beforeAll(async () => {
    const config: Record<string, string> = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
      MINI_APP_URL: 'https://mini-app.example/app',
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        TelegramService,
        UsersService,
        { provide: UsersRepository, useValue: usersRepository },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    postTelegramMock.mockResolvedValue({
      statusCode: 200,
      payload: { ok: true, result: { message_id: 1 } },
    });
    usersRepository.findByPhone.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  function webhook(update: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret')
      .send(update);
  }

  it('returns 200 and sends a contact keyboard for an unknown Telegram user', async () => {
    usersRepository.findByTelegramId.mockResolvedValue(null);

    await webhook({
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 123, first_name: 'Ali' },
        chat: { id: 123, type: 'private' },
        text: '/start',
      },
    }).expect(200, { ok: true });

    const telegramBody = postTelegramMock.mock.calls[0][2];
    expect(telegramBody.reply_markup).toEqual({
      keyboard: [
        [{ text: '📱 Telefon raqamni yuborish', request_contact: true }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  });

  it('stores an owned contact as a verified CUSTOMER registration', async () => {
    usersRepository.findByTelegramId.mockResolvedValue(null);
    usersRepository.upsertFromTelegramContact.mockImplementation((input) => ({
      id: 'user-id',
      ...input,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    }));

    await webhook({
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 123, first_name: 'Ali', username: 'ali' },
        chat: { id: 123, type: 'private' },
        contact: {
          user_id: 123,
          phone_number: '+998 90 123-45-67',
          first_name: 'Ali',
        },
      },
    }).expect(200, { ok: true });

    expect(usersRepository.upsertFromTelegramContact).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 123n,
        phone: '+998901234567',
        phoneVerifiedAt: expect.any(Date),
      }),
    );
    const stored = usersRepository.upsertFromTelegramContact.mock.results[0]
      .value as { role: UserRole; phoneVerifiedAt: Date };
    expect(stored.role).toBe(UserRole.CUSTOMER);
    expect(stored.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(postTelegramMock).toHaveBeenCalledTimes(2);
  });
});

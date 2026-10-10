import { createConfigService } from '../../../test/helpers/config.js';
import { UserRole } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postTelegram } from './telegram-api.js';
import { TelegramService } from './telegram.service.js';
import type { TelegramUpdate } from './telegram.types.js';

vi.mock('./telegram-api.js', () => ({ postTelegram: vi.fn() }));

function update(overrides: Record<string, unknown> = {}): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 100, first_name: 'Ali', username: 'ali' },
      chat: { id: 100, type: 'private' },
      text: '/start',
      ...overrides,
    },
  };
}

function user(
  role: UserRole,
  phone: string | null,
  phoneVerifiedAt: Date | null,
  isBlocked = false,
) {
  return { role, phone, phoneVerifiedAt, isBlocked };
}

describe('TelegramService', () => {
  const users = {
    findByTelegramId: vi.fn(),
    registerFromTelegramContact: vi.fn(),
  };
  const postTelegramMock = vi.mocked(postTelegram);
  let service: TelegramService;

  beforeEach(() => {
    vi.clearAllMocks();
    users.findByTelegramId.mockResolvedValue(null);
    postTelegramMock.mockResolvedValue({
      statusCode: 200,
      payload: { ok: true, result: { message_id: 1 } },
    });
    service = new TelegramService(
      users as never,
      createConfigService({
        TELEGRAM_BOT_TOKEN: 'test-token',
        MINI_APP_URL: 'https://mini-app.example/app',
      }),
    );
  });

  function sentBody(call = 0) {
    return postTelegramMock.mock.calls[call][2] as { text?: string; reply_markup: { inline_keyboard: Array<Array<Record<string, unknown>>> } };
  }

  function expectRegistrationKeyboard(): void {
    expect(sentBody().reply_markup).toEqual({
      keyboard: [
        [{ text: '📱 Telefon raqamni yuborish', request_contact: true }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  }

  it('/start requests a contact when the user does not exist', async () => {
    users.findByTelegramId.mockResolvedValue(null);

    await service.handleUpdate(update());

    expectRegistrationKeyboard();
  });

  it('/phone sends the phone-request keyboard', async () => {
    await service.handleUpdate(update({ text: '/phone' }));

    expect(sentBody()).toMatchObject({
      text: 'Telefon raqamingizni yuboring:',
    });
    expectRegistrationKeyboard();
  });

  it('/phone saves a first phone number and removes the keyboard', async () => {
    users.registerFromTelegramContact.mockResolvedValue({ id: 'user-id' });

    await service.handleUpdate(update({ text: '/phone' }));
    await service.handleUpdate(
      update({
        text: undefined,
        contact: {
          user_id: 100,
          phone_number: '998901234567',
          first_name: 'Ali',
        },
      }),
    );

    expect(users.registerFromTelegramContact).toHaveBeenCalledWith(
      expect.objectContaining({ telegramId: 100n, phone: '998901234567' }),
    );
    expect(sentBody(1)).toMatchObject({
      text: '✅ Telefon raqamingiz saqlandi.',
      reply_markup: { remove_keyboard: true },
    });
  });

  it('/phone updates an existing phone number without changing the role', async () => {
    users.findByTelegramId.mockResolvedValue(
      user(UserRole.ADMIN, '+998901111111', new Date()),
    );
    users.registerFromTelegramContact.mockResolvedValue({
      id: 'user-id',
      role: UserRole.ADMIN,
    });

    await service.handleUpdate(update({ text: '/phone' }));
    await service.handleUpdate(
      update({
        text: undefined,
        contact: {
          user_id: 100,
          phone_number: '+998909999999',
          first_name: 'Ali',
        },
      }),
    );

    expect(sentBody(1)).toMatchObject({
      text: '✅ Telefon raqamingiz yangilandi.',
      reply_markup: { remove_keyboard: true },
    });
  });

  it('/phone rejects a contact owned by another Telegram user', async () => {
    await service.handleUpdate(update({ text: '/phone' }));
    await service.handleUpdate(
      update({
        text: undefined,
        contact: {
          user_id: 101,
          phone_number: '+998901234567',
          first_name: 'Other',
        },
      }),
    );

    expect(users.registerFromTelegramContact).not.toHaveBeenCalled();
    expect(sentBody(1).text).toBe(
      '❌ Faqat o‘zingizning telefon raqamingizni yuboring.',
    );
  });

  it('registers the /start and /phone commands with Telegram', async () => {
    await service.setMyCommands();

    expect(postTelegramMock).toHaveBeenCalledWith(
      'test-token',
      'setMyCommands',
      {
        commands: [
          { command: 'start', description: 'Botni ishga tushirish' },
          {
            command: 'phone',
            description: 'Telefon raqamni qo‘shish yoki yangilash',
          },
        ],
      },
    );
  });

  it.each([
    ['GUEST without phone', UserRole.GUEST, null, null],
    ['CUSTOMER without phone', UserRole.CUSTOMER, null, null],
    ['ADMIN without phone', UserRole.ADMIN, null, null],
    ['SUPER_ADMIN without phone', UserRole.SUPER_ADMIN, null, null],
  ])('/start requests a contact for %s', async (_label, role, phone, verified) => {
    users.findByTelegramId.mockResolvedValue(user(role, phone, verified));

    await service.handleUpdate(update());

    expectRegistrationKeyboard();
  });

  it('/start sends the shop button when a phone is already saved', async () => {
    users.findByTelegramId.mockResolvedValue(
      user(UserRole.CUSTOMER, '+998901234567', null),
    );

    await service.handleUpdate(update());

    expect(sentBody().reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛒 Mini App ni ochish',
      web_app: { url: 'https://mini-app.example/app' },
    });
  });

  it.each([
    ['CUSTOMER', UserRole.CUSTOMER],
    ['ADMIN', UserRole.ADMIN],
    ['SUPER_ADMIN', UserRole.SUPER_ADMIN],
  ])('/start sends the shop button to a verified %s', async (_label, role) => {
    users.findByTelegramId.mockResolvedValue(
      user(role, '+998901234567', new Date()),
    );

    await service.handleUpdate(update());

    expect(sentBody().reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛒 Mini App ni ochish',
      web_app: { url: 'https://mini-app.example/app' },
    });
  });

  it('/start stops at the blocked message for a blocked user', async () => {
    users.findByTelegramId.mockResolvedValue(
      user(UserRole.CUSTOMER, null, null, true),
    );

    await service.handleUpdate(update());

    expect(postTelegramMock).toHaveBeenCalledOnce();
    expect(sentBody()).toMatchObject({ text: '⛔ Hisobingiz bloklangan' });
    expect(sentBody()).not.toHaveProperty('reply_markup');
  });

  it('registers an owned contact from a private chat', async () => {
    users.registerFromTelegramContact.mockResolvedValue({ id: 'user-id' });

    await service.handleUpdate(
      update({
        text: undefined,
        contact: {
          user_id: 100,
          phone_number: '+998 90 123-45-67',
          first_name: 'Ali',
        },
      }),
    );

    expect(users.registerFromTelegramContact).toHaveBeenCalledWith(
      expect.objectContaining({
        telegramId: 100n,
        phone: '+998 90 123-45-67',
      }),
    );
    expect(postTelegramMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0)).toMatchObject({
      text: '✅ Ro‘yxatdan muvaffaqiyatli o‘tdingiz',
      reply_markup: { remove_keyboard: true },
    });
    expect(sentBody(1).reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛒 Mini App ni ochish',
      web_app: { url: 'https://mini-app.example/app' },
    });
  });

  it.each([
    ['another user contact', { user_id: 101 }],
    ['a contact without user_id', {}],
  ])('rejects %s', async (_label, contact) => {
    await service.handleUpdate(
      update({
        text: undefined,
        contact: {
          ...contact,
          phone_number: '+998901234567',
          first_name: 'Ali',
        },
      }),
    );

    expect(users.registerFromTelegramContact).not.toHaveBeenCalled();
    expect(sentBody().text).toBe(
      '❌ Iltimos, o‘zingizning telefon raqamingizni yuboring.',
    );
  });

  it('does not start contact registration in a group chat', async () => {
    await service.handleUpdate(
      update({
        chat: { id: -100, type: 'group' },
        text: undefined,
        contact: {
          user_id: 100,
          phone_number: '+998901234567',
          first_name: 'Ali',
        },
      }),
    );

    expect(users.registerFromTelegramContact).not.toHaveBeenCalled();
    expect(sentBody().text).toBe(
      'Ro‘yxatdan o‘tish uchun bot bilan shaxsiy chatni oching.',
    );
  });

  it('routes /start before a contact payload', async () => {
    users.findByTelegramId.mockResolvedValue(null);

    await service.handleUpdate(
      update({
        contact: {
          user_id: 100,
          phone_number: '+998901234567',
          first_name: 'Ali',
        },
      }),
    );

    expect(users.findByTelegramId).toHaveBeenCalledWith(100n);
    expect(users.registerFromTelegramContact).not.toHaveBeenCalled();
    expectRegistrationKeyboard();
  });
});

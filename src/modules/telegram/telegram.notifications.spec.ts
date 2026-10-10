import {
  ServiceUnavailableException,
} from '@nestjs/common';
import { createConfigService } from '../../../test/helpers/config.js';
import { TelegramDeliveryError } from '../notifications/telegram-delivery.error.js';
import { OrderStatus } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postTelegram } from './telegram-api.js';
import { TelegramService } from './telegram.service.js';

vi.mock('./telegram-api.js', () => ({ postTelegram: vi.fn() }));

describe('TelegramService notifications', () => {
  const postTelegramMock = vi.mocked(postTelegram);
  let service: TelegramService;

  beforeEach(() => {
    vi.clearAllMocks();
    postTelegramMock.mockResolvedValue({
      statusCode: 200,
      payload: { ok: true, result: { message_id: 41 } },
    });
    service = new TelegramService(
      {} as never,
      createConfigService({ TELEGRAM_BOT_TOKEN: 'token-from-env' }),
    );
  });

  it('sends a message with the token read from configuration', async () => {
    await expect(service.sendMessage('123456789', 'Hello')).resolves.toBe(41);

    expect(postTelegramMock).toHaveBeenCalledWith(
      'token-from-env',
      'sendMessage',
      { chat_id: '123456789', text: 'Hello' },
    );
  });

  it('maps the real PROCESSING status to the customer notification', async () => {
    await service.sendOrderStatusNotification(
      '123456789',
      'order-id',
      OrderStatus.PROCESSING,
    );

    expect(postTelegramMock).toHaveBeenCalledWith(
      'token-from-env',
      'sendMessage',
      expect.objectContaining({
        chat_id: '123456789',
        text: expect.stringContaining('tayyorlanmoqda'),
      }),
    );
  });

  it('sends and edits channel photos through the central transport', async () => {
    postTelegramMock.mockResolvedValueOnce({
      statusCode: 200,
      payload: {
        ok: true,
        result: { message_id: 42, chat: { id: -100, type: 'channel' } },
      },
    });
    await expect(
      service.sendPhoto('@shop', 'https://images.example/photo.jpg', 'Caption'),
    ).resolves.toBe(42);
    expect(postTelegramMock).toHaveBeenLastCalledWith(
      'token-from-env',
      'sendPhoto',
      expect.objectContaining({
        chat_id: '@shop',
        photo: 'https://images.example/photo.jpg',
        caption: 'Caption',
        parse_mode: 'HTML',
      }),
    );

    await service.editMessageCaption('@shop', 42, 'Updated');
    expect(postTelegramMock).toHaveBeenLastCalledWith(
      'token-from-env',
      'editMessageCaption',
      expect.objectContaining({ message_id: 42, caption: 'Updated' }),
    );

    await service.editMessageMedia(
      '@shop',
      42,
      'https://images.example/new.jpg',
      'Updated',
    );
    expect(postTelegramMock).toHaveBeenLastCalledWith(
      'token-from-env',
      'editMessageMedia',
      expect.objectContaining({
        message_id: 42,
        media: expect.objectContaining({
          type: 'photo',
          media: 'https://images.example/new.jpg',
        }),
      }),
    );
  });

  it('sends one video and validates its returned message ID', async () => {
    postTelegramMock.mockResolvedValueOnce({
      statusCode: 200,
      payload: {
        ok: true,
        result: { message_id: 43, chat: { id: -100, type: 'channel' } },
      },
    });
    await expect(
      service.sendVideo('@shop', 'https://images.example/video.mp4', 'Caption'),
    ).resolves.toBe(43);
    expect(postTelegramMock).toHaveBeenCalledWith(
      'token-from-env',
      'sendVideo',
      expect.objectContaining({
        chat_id: '@shop',
        video: 'https://images.example/video.mp4',
        parse_mode: 'HTML',
      }),
    );
  });

  it('sends a media group and returns every message ID', async () => {
    postTelegramMock.mockResolvedValueOnce({
      statusCode: 200,
      payload: {
        ok: true,
        result: [
          { message_id: 44, chat: { id: -100, type: 'channel' } },
          { message_id: 45, chat: { id: -100, type: 'channel' } },
        ],
      },
    });
    const media = [
      {
        type: 'photo' as const,
        media: 'https://images.example/one.jpg',
        caption: 'Caption',
        parse_mode: 'HTML' as const,
      },
      { type: 'video' as const, media: 'https://images.example/two.mp4' },
    ];
    await expect(service.sendMediaGroup('@shop', media)).resolves.toEqual([
      44, 45,
    ]);
    expect(postTelegramMock).toHaveBeenCalledWith(
      'token-from-env',
      'sendMediaGroup',
      { chat_id: '@shop', media },
    );
  });

  it('fails clearly when the bot token is missing', async () => {
    service = new TelegramService({} as never, createConfigService({ TELEGRAM_BOT_TOKEN: undefined }));

    await expect(service.sendMessage('123', 'Hello')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(postTelegramMock).not.toHaveBeenCalled();
  });

  it('maps Telegram API and transport failures without exposing the token', async () => {
    postTelegramMock.mockResolvedValueOnce({
      statusCode: 401,
      payload: { ok: false, description: 'Unauthorized' },
    });
    await expect(service.sendMessage('123', 'Hello')).rejects.toBeInstanceOf(
      TelegramDeliveryError,
    );

    postTelegramMock.mockRejectedValueOnce(new Error('transport failed'));
    await expect(service.sendMessage('123', 'Hello')).rejects.toBeInstanceOf(
      TelegramDeliveryError,
    );
  });
});

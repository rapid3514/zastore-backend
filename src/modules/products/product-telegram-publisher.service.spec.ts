import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductMediaType,
  TelegramProductSyncStatus,
} from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductTelegramPublisherService } from './product-telegram-publisher.service.js';

const product = {
  id: 'product-id',
  name: 'Qora ko‘ylak',
  description: 'Tavsif',
  price: new Prisma.Decimal('180000.00'),
  imageUrl: 'https://ik.imagekit.io/account/products/photo.jpg',
  imageFileId: 'file-1',
  category: { name: 'Kiyim' },
  isAvailable: true,
  isActive: true,
  telegramChannelMessageId: null,
  telegramButtonMessageId: null,
  telegramPublishedAt: null,
  telegramSyncedAt: null,
  telegramSyncStatus: TelegramProductSyncStatus.PENDING,
};

describe('ProductTelegramPublisherService', () => {
  const telegram = {
    sendMessage: vi.fn(),
    sendPhoto: vi.fn(),
    sendVideo: vi.fn(),
    sendMediaGroup: vi.fn(),
    editMessageCaption: vi.fn(),
    editMessageReplyMarkup: vi.fn(),
    editMessageMedia: vi.fn(),
    deleteMessage: vi.fn(),
  };
  const repository = {
    updateTelegramSync: vi.fn(),
    updateTelegramPublication: vi.fn(),
  };
  let service: ProductTelegramPublisherService;

  beforeEach(() => {
    vi.clearAllMocks();
    telegram.sendPhoto.mockResolvedValue(77);
    telegram.sendVideo.mockResolvedValue(78);
    telegram.sendMediaGroup.mockResolvedValue([77, 78]);
    telegram.sendMessage.mockResolvedValue(79);
    telegram.editMessageCaption.mockResolvedValue(undefined);
    telegram.editMessageReplyMarkup.mockResolvedValue(undefined);
    telegram.deleteMessage.mockResolvedValue(undefined);
    repository.updateTelegramSync.mockImplementation(
      (_id: string, data: Record<string, unknown>) =>
        Promise.resolve({ ...product, ...data }),
    );
    repository.updateTelegramPublication.mockImplementation(
      (_id: string, data: Record<string, unknown>, messageIds: number[]) =>
        Promise.resolve({
          ...product,
          ...data,
          telegramMessages: messageIds.map((messageId, position) => ({
            messageId,
            position,
          })),
        }),
    );
    service = new ProductTelegramPublisherService(
      telegram as never,
      repository as never,
      new ConfigService({
        TELEGRAM_CHANNEL_ID: '@shop_channel',
        TELEGRAM_SHOP_URL: 'https://shop.example/product',
        TELEGRAM_BOT_USERNAME: 'lumiera_bot',
        TELEGRAM_MINI_APP_SHORT_NAME: 'shop',
      }),
    );
  });

  it('publishes one image, then its separate button message', async () => {
    const result = await service.syncAfterCreate(product);
    expect(telegram.sendPhoto).toHaveBeenCalledWith(
      '@shop_channel',
      product.imageUrl,
      expect.stringContaining('Qora ko‘ylak'),
    );
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '@shop_channel',
      '🛒 Buyurtma berish',
      {
        inline_keyboard: [
          [
            {
              text: '🛒 Zakaz berish',
              url: `https://t.me/lumiera_bot/shop?startapp=product_${product.id}`,
            },
          ],
        ],
      },
    );
    expect(telegram.sendPhoto.mock.invocationCallOrder[0]).toBeLessThan(
      telegram.sendMessage.mock.invocationCallOrder[0],
    );
    expect(repository.updateTelegramPublication).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({
        telegramChannelMessageId: 77,
        telegramButtonMessageId: 79,
        telegramPublishedAt: expect.any(Date),
        telegramSyncedAt: expect.any(Date),
        telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
      }),
      [77],
    );
    expect(result.telegramSyncStatus).toBe(TelegramProductSyncStatus.SYNCED);
  });

  it('publishes one video, then its separate button message', async () => {
    await service.syncAfterCreate({
      ...product,
      imageUrl: null,
      imageFileId: null,
      media: [
        {
          type: ProductMediaType.VIDEO,
          url: 'https://ik.imagekit.io/account/products/video.mp4',
          position: 0,
        },
      ],
    });
    expect(telegram.sendVideo).toHaveBeenCalledOnce();
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
    expect(telegram.sendVideo.mock.invocationCallOrder[0]).toBeLessThan(
      telegram.sendMessage.mock.invocationCallOrder[0],
    );
  });

  it('publishes a media group, then its separate button message', async () => {
    let finishMediaGroup!: (messageIds: number[]) => void;
    telegram.sendMediaGroup.mockReturnValue(
      new Promise<number[]>((resolve) => {
        finishMediaGroup = resolve;
      }),
    );

    const syncing = service.syncAfterCreate({
      ...product,
      media: [
        { type: ProductMediaType.IMAGE, url: 'https://ik/a.jpg', position: 0 },
        { type: ProductMediaType.VIDEO, url: 'https://ik/v.mp4', position: 0 },
      ],
    });
    await vi.waitFor(() =>
      expect(telegram.sendMediaGroup).toHaveBeenCalledOnce(),
    );
    expect(telegram.sendMessage).not.toHaveBeenCalled();

    finishMediaGroup([77, 78]);
    await syncing;

    expect(telegram.sendMediaGroup).toHaveBeenCalledWith('@shop_channel', [
      expect.objectContaining({ type: 'photo', caption: expect.any(String) }),
      { type: 'video', media: 'https://ik/v.mp4' },
    ]);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '@shop_channel',
      '🛒 Buyurtma berish',
      expect.objectContaining({ inline_keyboard: expect.any(Array) }),
    );
    expect(telegram.sendMediaGroup.mock.invocationCallOrder[0]).toBeLessThan(
      telegram.sendMessage.mock.invocationCallOrder[0],
    );
    expect(telegram.editMessageReplyMarkup).not.toHaveBeenCalled();
    expect(repository.updateTelegramPublication).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({ telegramButtonMessageId: 79 }),
      [77, 78],
    );
  });

  it('updates caption and existing button without creating a duplicate', async () => {
    await service.syncAfterUpdate(
      {
        ...product,
        telegramChannelMessageId: 77,
        telegramButtonMessageId: 79,
      },
      false,
    );
    expect(telegram.editMessageCaption).toHaveBeenCalledWith(
      '@shop_channel',
      77,
      expect.any(String),
      { inline_keyboard: [] },
    );
    expect(telegram.editMessageReplyMarkup).toHaveBeenCalledWith(
      '@shop_channel',
      79,
      {
        inline_keyboard: [
          [
            {
              text: '🛒 Zakaz berish',
              url: `https://t.me/lumiera_bot/shop?startapp=product_${product.id}`,
            },
          ],
        ],
      },
    );
    expect(telegram.sendPhoto).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(repository.updateTelegramSync).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({ telegramButtonMessageId: 79 }),
    );
  });

  it('replaces an uneditable button only after deleting the old message', async () => {
    telegram.editMessageReplyMarkup.mockRejectedValue(
      new BadGatewayException(),
    );
    telegram.sendMessage.mockResolvedValue(80);

    await service.syncAfterUpdate(
      {
        ...product,
        telegramChannelMessageId: 77,
        telegramButtonMessageId: 79,
      },
      false,
    );

    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 79);
    expect(telegram.sendMessage).toHaveBeenCalledOnce();
    expect(telegram.deleteMessage.mock.invocationCallOrder[0]).toBeLessThan(
      telegram.sendMessage.mock.invocationCallOrder[0],
    );
    expect(repository.updateTelegramSync).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({ telegramButtonMessageId: 80 }),
    );
  });

  it('keeps unchanged media and button messages during an idempotent sync', async () => {
    telegram.editMessageCaption.mockRejectedValue(
      new BadGatewayException('Bad Request: message is not modified'),
    );
    telegram.editMessageReplyMarkup.mockRejectedValue(
      new BadGatewayException('Bad Request: message is not modified'),
    );

    await service.syncAfterUpdate(
      {
        ...product,
        telegramChannelMessageId: 77,
        telegramButtonMessageId: 79,
      },
      false,
    );

    expect(telegram.deleteMessage).not.toHaveBeenCalled();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(repository.updateTelegramSync).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({ telegramButtonMessageId: 79 }),
    );
  });

  it('cleans new media if its separate button message cannot be sent', async () => {
    telegram.sendMessage.mockRejectedValue(new BadGatewayException());

    const result = await service.syncAfterCreate({
      ...product,
      media: [
        { type: ProductMediaType.IMAGE, url: 'https://ik/a.jpg', position: 0 },
        { type: ProductMediaType.VIDEO, url: 'https://ik/v.mp4', position: 0 },
      ],
    });

    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 77);
    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 78);
    expect(result.telegramSyncStatus).toBe(TelegramProductSyncStatus.FAILED);
  });

  it('republishes media and button, then deletes both old messages', async () => {
    await service.syncAfterUpdate(
      {
        ...product,
        telegramChannelMessageId: 40,
        telegramButtonMessageId: 41,
      },
      true,
    );
    expect(telegram.sendPhoto).toHaveBeenCalledOnce();
    expect(repository.updateTelegramPublication).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({ telegramButtonMessageId: 79 }),
      [77],
    );
    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 40);
    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 41);
  });

  it('deletes media and button messages together', async () => {
    await service.deleteProductPostsBestEffort({
      ...product,
      telegramMessages: [
        { messageId: 40, position: 0 },
        { messageId: 41, position: 1 },
      ],
      telegramButtonMessageId: 42,
    });

    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 40);
    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 41);
    expect(telegram.deleteMessage).toHaveBeenCalledWith('@shop_channel', 42);
  });

  it('marks FAILED without rolling back the product on publish failure', async () => {
    telegram.sendPhoto.mockRejectedValue(new BadGatewayException());
    const result = await service.syncAfterCreate(product);
    expect(result.id).toBe(product.id);
    expect(result.telegramSyncStatus).toBe(TelegramProductSyncStatus.FAILED);
    expect(repository.updateTelegramSync).toHaveBeenCalledWith(product.id, {
      telegramSyncStatus: TelegramProductSyncStatus.FAILED,
    });
  });

  it('does not publish a product without Mini App deep-link configuration', async () => {
    const serviceWithoutDeepLink = new ProductTelegramPublisherService(
      telegram as never,
      repository as never,
      new ConfigService({ TELEGRAM_CHANNEL_ID: '@shop_channel' }),
    );

    const result = await serviceWithoutDeepLink.syncAfterCreate(product);

    expect(telegram.sendPhoto).not.toHaveBeenCalled();
    expect(result.telegramSyncStatus).toBe(TelegramProductSyncStatus.FAILED);
  });

  it('manual sync edits unchanged posts and force republish publishes anew', async () => {
    const published = {
      ...product,
      telegramChannelMessageId: 77,
      telegramButtonMessageId: 79,
    };
    await service.syncManually(published, false);
    expect(telegram.editMessageCaption).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    telegram.sendPhoto.mockResolvedValue(88);
    repository.updateTelegramPublication.mockImplementation(
      (_id: string, data: Record<string, unknown>) =>
        Promise.resolve({ ...published, ...data }),
    );
    await service.syncManually(published, true);
    expect(telegram.sendPhoto).toHaveBeenCalledOnce();
    expect(repository.updateTelegramPublication).toHaveBeenCalledWith(
      product.id,
      expect.objectContaining({
        telegramChannelMessageId: 88,
        telegramButtonMessageId: 79,
      }),
      [88],
    );
  });

  it('manual retry republishes a FAILED product', async () => {
    const result = await service.syncManually(
      { ...product, telegramSyncStatus: TelegramProductSyncStatus.FAILED },
      false,
    );
    expect(telegram.sendPhoto).toHaveBeenCalledOnce();
    expect(result.telegramSyncStatus).toBe(TelegramProductSyncStatus.SYNCED);
  });

  it('keeps Telegram delete best-effort', async () => {
    telegram.deleteMessage.mockRejectedValue(new BadGatewayException());
    await expect(service.deletePostBestEffort(77)).resolves.toBeUndefined();
  });

  it('does not log provider secrets', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    telegram.sendPhoto.mockRejectedValue(
      new Error('private_test bot-token webhook-secret signature-value'),
    );
    await service.syncAfterCreate(product);
    expect(JSON.stringify(logger.mock.calls)).not.toMatch(
      /private_test|bot-token|webhook-secret|signature-value/,
    );
    logger.mockRestore();
  });
});

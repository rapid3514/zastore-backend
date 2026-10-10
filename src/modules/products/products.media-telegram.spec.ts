import {
  AuditAction,
  AuditEntityType,
  Prisma,
  ProductAvailabilityStatus,
  TelegramProductSyncStatus,
} from '../../generated/prisma/client.js';
import { Logger, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

const productId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    name: 'Qora ko‘ylak',
    description: 'Tavsif',
    price: new Prisma.Decimal('180000.00'),
    imageUrl: 'https://ik.imagekit.io/account/products/old.jpg',
    imageFileId: 'old-file',
    categoryId,
    category: { id: categoryId, name: 'Kiyim', slug: 'kiyim' },
    availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
    isActive: true,
    version: 0,
    telegramChannelMessageId: 77,
    telegramButtonMessageId: 78,
    telegramPublishedAt: new Date(),
    telegramSyncedAt: new Date(),
    telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProductsService media and Telegram flow', () => {
  it('keeps the backward-compatible create flow without an image', async () => {
    const created = product({
      imageUrl: null,
      imageFileId: null,
      telegramChannelMessageId: null,
      telegramPublishedAt: null,
      telegramSyncedAt: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    });
    const repository = {
      findCategoryById: vi.fn().mockResolvedValue({
        id: categoryId,
        isActive: true,
      }),
      create: vi.fn().mockResolvedValue(created),
    };
    const media = { verifyProductImage: vi.fn() };
    const publisher = { syncAfterCreate: vi.fn() };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await expect(
      service.create({ name: 'Legacy product', price: 1000, categoryId }),
    ).resolves.toMatchObject({
      imageUrl: null,
      imageFileId: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    });
    expect(media.verifyProductImage).not.toHaveBeenCalled();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrl: null, imageFileId: null }),
    );
    expect(publisher.syncAfterCreate).not.toHaveBeenCalled();
  });

  it('rejects an unknown image before product persistence or Telegram publish', async () => {
    const repository = {
      findCategoryById: vi.fn().mockResolvedValue({
        id: categoryId,
        isActive: true,
      }),
      create: vi.fn(),
    };
    const media = {
      verifyProductImage: vi.fn().mockRejectedValue(new NotFoundException()),
    };
    const publisher = { syncAfterCreate: vi.fn() };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await expect(
      service.create({
        name: 'Invalid image',
        price: 1000,
        categoryId,
        image: {
          fileId: 'missing-file',
          url: 'https://frontend.example/missing.jpg',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(publisher.syncAfterCreate).not.toHaveBeenCalled();
  });

  it('creates with authoritative image metadata and returns Telegram sync result', async () => {
    const events: string[] = [];
    const repository = {
      findCategoryById: vi.fn().mockResolvedValue({
        id: categoryId,
        isActive: true,
      }),
      create: vi.fn().mockImplementation((data: Record<string, unknown>) => {
        events.push('db-create');
        return Promise.resolve(
          product({
            ...data,
            telegramChannelMessageId: null,
            telegramPublishedAt: null,
            telegramSyncedAt: null,
          }),
        );
      }),
      createInTransaction: vi.fn().mockImplementation((_transaction: unknown, data: Record<string, unknown>) => repository.create(data)),
    };
    const media = {
      verifyProductImage: vi.fn().mockImplementation(() => {
        events.push('verify');
        return Promise.resolve({
          fileId: 'verified-file',
          url: 'https://ik.imagekit.io/account/products/verified.jpg',
          filePath: '/products/verified.jpg',
          mime: 'image/jpeg',
          size: 100,
        });
      }),
      withReservedAssets: vi.fn().mockImplementation((_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({})),
    };
    const publisher = {
      syncAfterCreate: vi.fn().mockImplementation((created) => {
        events.push('telegram-publish');
        return Promise.resolve(
          product({
            ...created,
            telegramChannelMessageId: 99,
            telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
          }),
        );
      }),
    };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    const response = await service.create({
      name: 'Qora ko‘ylak',
      price: 180000,
      categoryId,
      image: {
        fileId: 'verified-file',
        url: 'https://attacker.example/not-trusted.jpg',
      },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageFileId: 'verified-file',
        imageUrl: 'https://ik.imagekit.io/account/products/verified.jpg',
        telegramSyncStatus: TelegramProductSyncStatus.PENDING,
      }),
    );
    expect(publisher.syncAfterCreate).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      imageFileId: 'verified-file',
      telegramChannelMessageId: 99,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    });
    expect(events).toEqual(['verify', 'db-create', 'telegram-publish']);
  });

  it('returns a persisted product with FAILED sync after Telegram failure', async () => {
    const created = product({
      telegramChannelMessageId: null,
      telegramPublishedAt: null,
      telegramSyncedAt: null,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    });
    const repository = {
      findCategoryById: vi.fn().mockResolvedValue({
        id: categoryId,
        isActive: true,
      }),
      create: vi.fn().mockResolvedValue(created),
      createInTransaction: vi.fn().mockImplementation(() => repository.create()),
    };
    const media = {
      verifyProductImage: vi.fn().mockResolvedValue({
        fileId: 'old-file',
        url: created.imageUrl,
      }),
      withReservedAssets: vi.fn().mockImplementation((_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({})),
    };
    const publisher = {
      syncAfterCreate: vi.fn().mockResolvedValue(
        product({
          telegramChannelMessageId: null,
          telegramSyncStatus: TelegramProductSyncStatus.FAILED,
        }),
      ),
    };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await expect(
      service.create({
        name: 'Qora ko‘ylak',
        price: 180000,
        categoryId,
        image: { fileId: 'old-file', url: created.imageUrl },
      }),
    ).resolves.toMatchObject({
      id: productId,
      telegramSyncStatus: TelegramProductSyncStatus.FAILED,
    });
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it('routes text, category, price, and availability updates to caption sync', async () => {
    const nextCategoryId = '33333333-3333-4333-8333-333333333333';
    const updated = product({
      name: 'Yangi nom',
      description: 'Yangi tavsif',
      price: new Prisma.Decimal('190000.00'),
      categoryId: nextCategoryId,
      category: { id: nextCategoryId, name: 'Yangi kategoriya', slug: 'yangi' },
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(product()),
      findCategoryById: vi.fn().mockResolvedValue({
        id: nextCategoryId,
        isActive: true,
      }),
      update: vi.fn().mockResolvedValue(updated),
    };
    const publisher = { syncAfterUpdate: vi.fn().mockResolvedValue(updated) };
    const service = new ProductsService(
      repository as never,
      undefined,
      undefined,
      publisher as never,
    );

    await service.update(productId, {
      name: 'Yangi nom',
      description: 'Yangi tavsif',
      price: 190000,
      categoryId: nextCategoryId,
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });
    expect(repository.update).toHaveBeenCalledWith(productId, {
      name: 'Yangi nom',
      description: 'Yangi tavsif',
      price: 190000,
      categoryId: nextCategoryId,
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    }, 0);
    expect(publisher.syncAfterUpdate).toHaveBeenCalledWith(updated, false);
  });

  it('edits Telegram media, then cleans up the old image after DB update', async () => {
    const events: string[] = [];
    const existing = product();
    const updated = product({
      imageFileId: 'new-file',
      imageUrl: 'https://ik.imagekit.io/account/products/new.jpg',
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(existing),
      findCategoryById: vi.fn(),
      update: vi.fn().mockImplementation(() => {
        events.push('db-update');
        return Promise.resolve(updated);
      }),
      updateInTransaction: vi.fn().mockImplementation((_transaction: unknown, ...args: [string, Record<string, unknown>, number]) => repository.update(...args)),
    };
    const media = {
      verifyProductImage: vi.fn().mockImplementation(() => {
        events.push('verify');
        return Promise.resolve({
          fileId: 'new-file',
          url: 'https://ik.imagekit.io/account/products/new.jpg',
        });
      }),
      deleteImageIfUnreferenced: vi.fn().mockImplementation(() => {
        events.push('old-image-delete');
        return Promise.resolve(true);
      }),
      withReservedAssets: vi.fn().mockImplementation((_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({})),
    };
    const publisher = {
      syncAfterUpdate: vi.fn().mockImplementation(() => {
        events.push('telegram-sync');
        return Promise.resolve(updated);
      }),
    };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await service.update(productId, {
      image: {
        fileId: 'new-file',
        url: 'https://attacker.example/not-trusted.jpg',
      },
    });

    expect(repository.update).toHaveBeenCalledWith(productId, {
      imageFileId: 'new-file',
      imageUrl: 'https://ik.imagekit.io/account/products/new.jpg',
    }, 0);
    expect(publisher.syncAfterUpdate).toHaveBeenCalledWith(updated, true);
    expect(media.deleteImageIfUnreferenced).toHaveBeenCalledWith('old-file');
    expect(repository.update.mock.invocationCallOrder[0]).toBeLessThan(
      media.deleteImageIfUnreferenced.mock.invocationCallOrder[0],
    );
    expect(events).toEqual([
      'verify',
      'db-update',
      'telegram-sync',
      'old-image-delete',
    ]);
  });

  it('rejects an invalid replacement before DB, Telegram, or old-image cleanup', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(product()),
      update: vi.fn(),
    };
    const media = {
      verifyProductImage: vi.fn().mockRejectedValue(new NotFoundException()),
      deleteImageIfUnreferenced: vi.fn(),
    };
    const publisher = { syncAfterUpdate: vi.fn() };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await expect(
      service.update(productId, {
        image: {
          fileId: 'missing-file',
          url: 'https://frontend.example/missing.jpg',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(publisher.syncAfterUpdate).not.toHaveBeenCalled();
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('keeps an updated product when old ImageKit cleanup fails', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const existing = product();
    const updated = product({
      imageFileId: 'new-file',
      imageUrl: 'https://ik.imagekit.io/account/products/new.jpg',
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(updated),
      updateInTransaction: vi.fn().mockImplementation((_transaction: unknown, ...args: [string, Record<string, unknown>, number]) => repository.update(...args)),
    };
    const media = {
      verifyProductImage: vi.fn().mockResolvedValue({
        fileId: 'new-file',
        url: 'https://ik.imagekit.io/account/products/new.jpg',
      }),
      deleteImageIfUnreferenced: vi
        .fn()
        .mockRejectedValue(new Error('provider unavailable')),
      withReservedAssets: vi.fn().mockImplementation((_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({})),
    };
    const publisher = { syncAfterUpdate: vi.fn().mockResolvedValue(updated) };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await expect(
      service.update(productId, {
        image: { fileId: 'new-file', url: 'https://frontend.example/new.jpg' },
      }),
    ).resolves.toMatchObject({ imageFileId: 'new-file' });
    expect(logger).toHaveBeenCalledWith(
      'ImageKit asset cleanup failed after product commit',
    );
    logger.mockRestore();
  });

  it('hard-deletes first, then best-effort deletes Telegram and ImageKit assets', async () => {
    const events: string[] = [];
    const existing = product();
    const repository = {
      findById: vi.fn().mockResolvedValue(existing),
      removeOrDeactivate: vi.fn().mockImplementation(() => {
        events.push('db-delete');
        return Promise.resolve({ product: existing, softDeleted: false });
      }),
    };
    const publisher = {
      deleteProductPostsBestEffort: vi.fn().mockImplementation(() => {
        events.push('telegram-delete');
        return Promise.resolve();
      }),
    };
    const media = {
      deleteImageIfUnreferenced: vi.fn().mockImplementation(() => {
        events.push('image-delete');
        return Promise.resolve(true);
      }),
    };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await service.remove(productId);
    expect(events).toEqual(['db-delete', 'telegram-delete', 'image-delete']);
    expect(repository.removeOrDeactivate).toHaveBeenCalledWith(productId, 0);
    expect(publisher.deleteProductPostsBestEffort).toHaveBeenCalledWith(
      existing,
    );
    expect(media.deleteImageIfUnreferenced).toHaveBeenCalledWith('old-file');
  });

  it('soft-deletes the product and removes its Telegram media and button posts', async () => {
    const inactive = product({
      isActive: false,
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(product()),
      removeOrDeactivate: vi.fn().mockResolvedValue({ product: inactive, softDeleted: true }),
    };
    const publisher = {
      removeProductPostsBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    const media = { deleteImageIfUnreferenced: vi.fn() };
    const service = new ProductsService(
      repository as never,
      undefined,
      media as never,
      publisher as never,
    );

    await service.remove(productId);
    expect(repository.removeOrDeactivate).toHaveBeenCalledWith(productId, 0);
    expect(publisher.removeProductPostsBestEffort).toHaveBeenCalledWith(
      inactive,
    );
    expect(media.deleteImageIfUnreferenced).not.toHaveBeenCalled();
  });

  it('audits safe old/new image identifiers on image change', async () => {
    const existing = product();
    const updated = product({
      imageFileId: 'new-file',
      imageUrl: 'https://ik.imagekit.io/account/products/new.jpg',
    });
    const repository = {
      findById: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(updated),
      updateInTransaction: vi.fn().mockImplementation((_transaction: unknown, ...args: [string, Record<string, unknown>, number]) => repository.update(...args)),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const media = {
      verifyProductImage: vi.fn().mockResolvedValue({
        fileId: 'new-file',
        url: updated.imageUrl,
      }),
      deleteImageIfUnreferenced: vi.fn().mockResolvedValue(true),
      withReservedAssets: vi.fn().mockImplementation((_assets: unknown, operation: (transaction: object) => Promise<unknown>) => operation({})),
    };
    const publisher = { syncAfterUpdate: vi.fn().mockResolvedValue(updated) };
    const service = new ProductsService(
      repository as never,
      audit as never,
      media as never,
      publisher as never,
    );

    await service.update(
      productId,
      { image: { fileId: 'new-file', url: 'https://attacker.example/x.jpg' } },
      'actor-id',
    );
    expect(audit.log).toHaveBeenCalledWith({
      actorUserId: 'actor-id',
      action: AuditAction.PRODUCT_UPDATE,
      entityType: AuditEntityType.PRODUCT,
      entityId: productId,
      metadata: {
        fields: ['imageUrl', 'imageFileId'],
        oldImageFileId: 'old-file',
        newImageFileId: 'new-file',
      },
    });
  });

  it('audits a successful manual Telegram republish result', async () => {
    const synced = product({
      telegramChannelMessageId: 99,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    });
    const repository = { findById: vi.fn().mockResolvedValue(product()) };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const publisher = { syncManually: vi.fn().mockResolvedValue(synced) };
    const service = new ProductsService(
      repository as never,
      audit as never,
      undefined,
      publisher as never,
    );

    await service.syncTelegram(productId, true, 'actor-id');
    expect(audit.log).toHaveBeenCalledWith({
      actorUserId: 'actor-id',
      action: AuditAction.PRODUCT_UPDATE,
      entityType: AuditEntityType.PRODUCT,
      entityId: productId,
      metadata: {
        telegramSyncResult: { success: true, forceRepublish: true },
      },
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  ProductMediaType,
  TelegramProductSyncStatus,
} from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import type { ProductMediaDto } from './dto/product-media.dto.js';
import { ProductsService } from './products.service.js';

const productId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';

const inputMedia = (
  imageCount: number,
  videoCount: number,
): ProductMediaDto[] => [
  ...Array.from({ length: imageCount }, (_, position) => ({
    type: ProductMediaType.IMAGE,
    fileId: `image-${position}`,
    url: `https://frontend.example/image-${position}.jpg`,
    position,
  })),
  ...Array.from({ length: videoCount }, (_, position) => ({
    type: ProductMediaType.VIDEO,
    fileId: `video-${position}`,
    url: `https://frontend.example/video-${position}.mp4`,
    position,
  })),
];

const storedMedia = (media: ProductMediaDto[]) =>
  media.map((item, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    productId,
    type: item.type,
    fileId: item.fileId,
    url: `https://ik.imagekit.io/account/products/${item.fileId}`,
    position: item.position,
    mimeType: item.type === ProductMediaType.IMAGE ? 'image/jpeg' : 'video/mp4',
    width: 1200,
    height: 800,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));

function product(media: ReturnType<typeof storedMedia> = []) {
  const cover = media.find((item) => item.type === ProductMediaType.IMAGE);
  return {
    id: productId,
    name: 'Product',
    description: null,
    price: new Prisma.Decimal('100.00'),
    imageUrl: cover?.url ?? null,
    imageFileId: cover?.fileId ?? null,
    categoryId,
    category: { id: categoryId, name: 'Category', slug: 'category' },
    isAvailable: true,
    isActive: true,
    media,
    telegramMessages: [],
    telegramChannelMessageId: null,
    telegramPublishedAt: null,
    telegramSyncedAt: null,
    telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function harness(existingMedia: ProductMediaDto[] = []) {
  const current = product(storedMedia(existingMedia));
  const repository = {
    findCategoryById: vi
      .fn()
      .mockResolvedValue({ id: categoryId, isActive: true }),
    findById: vi.fn().mockResolvedValue(current),
    list: vi.fn(),
    create: vi.fn().mockResolvedValue(product()),
    createWithMedia: vi
      .fn()
      .mockImplementation((_data: unknown, media: ProductMediaDto[]) =>
        Promise.resolve(product(storedMedia(media))),
      ),
    update: vi
      .fn()
      .mockImplementation((_id: string, data: Record<string, unknown>) =>
        Promise.resolve({ ...current, ...data }),
      ),
    replaceMedia: vi
      .fn()
      .mockImplementation(
        (
          _id: string,
          data: Record<string, unknown>,
          media: ProductMediaDto[],
        ) => Promise.resolve({ ...product(storedMedia(media)), ...data }),
      ),
  };
  const mediaService = {
    verifyProductMedia: vi.fn().mockImplementation((item: ProductMediaDto) =>
      Promise.resolve({
        type: item.type,
        fileId: item.fileId,
        url: `https://ik.imagekit.io/account/products/${item.fileId}`,
        filePath: `/products/${item.fileId}`,
        mime: item.type === ProductMediaType.IMAGE ? 'image/jpeg' : 'video/mp4',
        size: 100,
        width: 1200,
        height: 800,
      }),
    ),
    verifyProductImage: vi.fn(),
    deleteImageIfUnreferenced: vi.fn().mockResolvedValue(true),
  };
  const publisher = {
    syncAfterCreate: vi
      .fn()
      .mockImplementation((value) => Promise.resolve(value)),
    syncAfterUpdate: vi
      .fn()
      .mockImplementation((value) => Promise.resolve(value)),
    removeProductPostsBestEffort: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    mediaService,
    publisher,
    service: new ProductsService(
      repository as never,
      undefined,
      mediaService as never,
      publisher as never,
    ),
  };
}

describe('ProductsService multi-media', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [5, 0],
    [0, 1],
    [1, 1],
    [3, 1],
    [5, 1],
  ])(
    'accepts optional media within limits: %i image(s), %i video(s)',
    async (imageCount, videoCount) => {
      const { service } = harness();
      await expect(
        service.create({
          name: 'Product',
          price: 100,
          categoryId,
          media: inputMedia(imageCount, videoCount),
        }),
      ).resolves.toMatchObject({ id: productId });
    },
  );

  it.each([
    [6, 0, 'Bir mahsulotga maksimal 5 ta rasm qo‘shish mumkin.'],
    [0, 2, 'Bir mahsulotga maksimal 1 ta video qo‘shish mumkin.'],
    [4, 2, 'Bir mahsulotga maksimal 1 ta video qo‘shish mumkin.'],
    [5, 2, 'Bir mahsulotga maksimal 1 ta video qo‘shish mumkin.'],
  ])(
    'rejects %i images and %i videos',
    async (imageCount, videoCount, message) => {
      const { service, repository, mediaService } = harness();
      await expect(
        service.create({
          name: 'Product',
          price: 100,
          categoryId,
          media: inputMedia(imageCount, videoCount),
        }),
      ).rejects.toThrow(message);
      expect(mediaService.verifyProductMedia).not.toHaveBeenCalled();
      expect(repository.createWithMedia).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate fileId and mixed legacy/new inputs', async () => {
    const duplicate = inputMedia(2, 0);
    duplicate[1].fileId = duplicate[0].fileId;
    const first = harness();
    await expect(
      first.service.create({
        name: 'Product',
        price: 100,
        categoryId,
        media: duplicate,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const second = harness();
    await expect(
      second.service.create({
        name: 'Product',
        price: 100,
        categoryId,
        image: { fileId: 'legacy', url: 'https://frontend.example/legacy.jpg' },
        media: inputMedia(1, 0),
      }),
    ).rejects.toThrow(
      '`image` va `media` bir requestda birga yuborilmasligi kerak.',
    );
  });

  it('persists authoritative media and returns the created DB media state', async () => {
    const requested = inputMedia(2, 1);
    const { service, repository } = harness();
    const response = await service.create({
      name: 'Product',
      price: 100,
      categoryId,
      media: requested,
    });
    expect(repository.createWithMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://ik.imagekit.io/account/products/image-0',
      }),
      expect.arrayContaining([
        expect.objectContaining({
          fileId: 'image-0',
          url: 'https://ik.imagekit.io/account/products/image-0',
          mimeType: 'image/jpeg',
        }),
      ]),
    );
    expect(response.media).toHaveLength(3);
    expect(response.media[0]).toMatchObject({
      type: ProductMediaType.IMAGE,
      fileId: 'image-0',
      url: 'https://ik.imagekit.io/account/products/image-0',
    });
  });

  it('preserves unchanged existing media without re-verification or replacement', async () => {
    const existing = inputMedia(2, 1);
    const { service, repository, mediaService } = harness(existing);
    const editPayload = existing.map((item, index) => ({
      type: item.type,
      fileId: item.fileId,
      position: item.position,
      id: storedMedia(existing)[index].id,
      url: 'https://untrusted.example/ignored',
    }));
    await service.update(productId, { media: editPayload });
    expect(mediaService.verifyProductMedia).not.toHaveBeenCalled();
    expect(repository.replaceMedia).not.toHaveBeenCalled();
  });

  it('verifies only new media and atomically replaces the media rows', async () => {
    const existing = inputMedia(1, 0);
    const { service, repository, mediaService } = harness(existing);
    await service.update(productId, { media: inputMedia(2, 0) });
    expect(mediaService.verifyProductMedia).toHaveBeenCalledTimes(1);
    expect(mediaService.verifyProductMedia).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'image-1' }),
    );
    expect(repository.replaceMedia).toHaveBeenCalledWith(
      productId,
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({ fileId: 'image-0' }),
        expect.objectContaining({ fileId: 'image-1' }),
      ]),
    );
  });

  it('adds an optional video and replaces only the changed video asset', async () => {
    const imageOnly = inputMedia(1, 0);
    const first = harness(imageOnly);
    await first.service.update(productId, { media: inputMedia(1, 1) });
    expect(first.mediaService.verifyProductMedia).toHaveBeenCalledTimes(1);
    expect(first.mediaService.verifyProductMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ProductMediaType.VIDEO,
        fileId: 'video-0',
      }),
    );

    const withVideo = inputMedia(1, 1);
    const replacement = [
      withVideo[0],
      {
        type: ProductMediaType.VIDEO,
        fileId: 'video-new',
        url: 'https://frontend.example/video-new.mp4',
        position: 0,
      },
    ];
    const second = harness(withVideo);
    await second.service.update(productId, { media: replacement });
    expect(second.mediaService.verifyProductMedia).toHaveBeenCalledTimes(1);
    expect(second.mediaService.verifyProductMedia).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'video-new' }),
    );
    expect(second.mediaService.deleteImageIfUnreferenced).toHaveBeenCalledWith(
      'video-0',
    );
  });

  it('supports reorder without verification', async () => {
    const existing = inputMedia(2, 0);
    const reordered = [
      {
        type: existing[1].type,
        fileId: existing[1].fileId,
        url: existing[1].url,
        position: 0,
      },
      {
        type: existing[0].type,
        fileId: existing[0].fileId,
        url: existing[0].url,
        position: 1,
      },
    ];
    const { service, repository, mediaService } = harness(existing);
    await service.update(productId, { media: reordered });
    expect(mediaService.verifyProductMedia).not.toHaveBeenCalled();
    expect(repository.replaceMedia).toHaveBeenCalledOnce();
  });

  it('cleans removed media only after DB commit and Telegram republish', async () => {
    const events: string[] = [];
    const existing = inputMedia(2, 0);
    const { service, repository, mediaService, publisher } = harness(existing);
    repository.replaceMedia.mockImplementation(async (_id, data, media) => {
      events.push('db-commit');
      return { ...product(storedMedia(media)), ...data };
    });
    publisher.syncAfterUpdate.mockImplementation(async (value) => {
      events.push('telegram');
      return value;
    });
    mediaService.deleteImageIfUnreferenced.mockImplementation(async () => {
      events.push('cleanup');
      return true;
    });

    const response = await service.update(productId, { media: [existing[0]] });
    expect(response.media).toHaveLength(1);
    expect(mediaService.deleteImageIfUnreferenced).toHaveBeenCalledWith(
      'image-1',
    );
    expect(events).toEqual(['db-commit', 'telegram', 'cleanup']);
  });

  it('returns public media without fileId and manage media with fileId', async () => {
    const media = storedMedia(inputMedia(1, 1));
    const record = product(media);
    const { service, repository } = harness();
    repository.list
      .mockResolvedValueOnce({ data: [record], total: 1 })
      .mockResolvedValueOnce({ data: [record], total: 1 });
    const publicResult = await service.findPublic({});
    const manageResult = await service.findForAdmin({});
    expect(publicResult.data[0].media[0]).toEqual({
      id: media[0].id,
      type: ProductMediaType.IMAGE,
      url: media[0].url,
      position: 0,
    });
    expect(publicResult.data[0].media[0]).not.toHaveProperty('fileId');
    expect(manageResult.data[0].media[0]).toMatchObject({
      fileId: 'image-0',
      mimeType: 'image/jpeg',
    });
  });

  it('keeps a legacy image as a response fallback', async () => {
    const legacy = {
      ...product(),
      imageUrl: 'https://ik.imagekit.io/account/products/legacy.jpg',
      imageFileId: 'legacy-file',
    };
    const { service, repository } = harness();
    repository.list.mockResolvedValue({ data: [legacy], total: 1 });
    const result = await service.findForAdmin({});
    expect(result.data[0].media).toEqual([
      expect.objectContaining({
        id: null,
        type: ProductMediaType.IMAGE,
        fileId: 'legacy-file',
        url: legacy.imageUrl,
      }),
    ]);
  });
});

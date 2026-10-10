import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { ImageKitService } from '../src/modules/media/imagekit.service.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { createConfigService } from './helpers/config.js';

describe('media lifecycle concurrency with real PostgreSQL', () => {
  let prisma: PrismaService;
  let media: MediaService;
  let imageKit: ImageKitService;
  let categoryId: string | undefined;
  let productId: string | undefined;
  let fileId: string | undefined;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('TEST_DATABASE_URL must point to an isolated migrated test database');
    }
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (!/(?:^|_)(?:test|audit|security)(?:_|$)/i.test(databaseName)) {
      throw new Error('Refusing integration writes: database name must contain a test, audit or security segment');
    }
    const config: ConfigService = createConfigService({ DATABASE_URL: databaseUrl });
    prisma = new PrismaService(config);
    await prisma.$connect();
    imageKit = new ImageKitService(config);
    media = new MediaService(imageKit, config, prisma);
  });

  afterEach(async () => {
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (fileId) await prisma.mediaAsset.deleteMany({ where: { fileId } });
    categoryId = productId = fileId = undefined;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('rejects an attachment while an unreferenced asset is being deleted', async () => {
    categoryId = randomUUID();
    productId = randomUUID();
    fileId = `media-race-${randomUUID()}`;
    await prisma.category.create({
      data: { id: categoryId, name: 'Media race category', slug: `media-race-${categoryId}` },
    });
    let releaseProviderDeletion: (() => void) | undefined;
    const providerMayFinish = new Promise<void>((resolve) => {
      releaseProviderDeletion = resolve;
    });
    let providerDeletionStarted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      providerDeletionStarted = resolve;
    });
    const deletionSpy = vi.spyOn(imageKit, 'deleteFile').mockImplementation(async () => {
      providerDeletionStarted?.();
      await providerMayFinish;
    });
    const deletion = media.deleteImageIfUnreferenced(fileId);
    await providerStarted;

    await expect(media.withReservedAssets([{ fileId }], async (tx) =>
      tx.product.create({
        data: {
          id: productId!,
          categoryId: categoryId!,
          name: 'Media race product',
          price: '10.00',
          imageFileId: fileId!,
        },
      }),
    )).rejects.toBeInstanceOf(ConflictException);
    releaseProviderDeletion?.();
    await expect(deletion).resolves.toBe(true);
    expect(deletionSpy).toHaveBeenCalledWith(fileId);
    await expect(prisma.product.findUnique({ where: { id: productId } })).resolves.toBeNull();
  });
});

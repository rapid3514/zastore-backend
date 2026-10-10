import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MediaAssetStatus } from '../../generated/prisma/client.js';
import { createConfigService } from '../../../test/helpers/config.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService } from './media.service.js';

describe('MediaService', () => {
  const imageKit = {
    getUploadAuthentication: vi.fn(),
    getFile: vi.fn(),
    deleteFile: vi.fn(),
  };
  const prisma = {
    product: { count: vi.fn() },
    productMedia: { count: vi.fn() },
    mediaAsset: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  const config = createConfigService({
    IMAGEKIT_PUBLIC_KEY: 'public_test',
    IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
    IMAGEKIT_PRODUCT_FOLDER: '/products',
    MEDIA_MAX_IMAGE_BYTES: 1_024,
  });
  let service: MediaService;

  function imageAsset(
    mime: string,
    size: number,
    filePath = '/products/photo.jpg',
    url = `https://ik.imagekit.io/account${filePath}`,
  ) {
    return {
      fileId: 'file-1',
      url,
      filePath,
      fileType: 'image',
      mime,
      size,
      width: 800,
      height: 600,
      isPrivateFile: false,
      isPublished: true,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    imageKit.getUploadAuthentication.mockReturnValue({
      token: 'one-time-token',
      signature: 'signature',
      expire: 123,
    });
    imageKit.getFile.mockResolvedValue({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/photo.webp',
      filePath: '/products/photo.webp',
      fileType: 'image',
      mime: 'image/webp',
      size: 900,
      width: 800,
      height: 600,
      isPrivateFile: false,
      isPublished: true,
    });
    prisma.product.count.mockResolvedValue(0);
    prisma.productMedia.count.mockResolvedValue(0);
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.mediaAsset.createMany.mockResolvedValue({ count: 1 });
    prisma.mediaAsset.upsert.mockResolvedValue({ status: MediaAssetStatus.ACTIVE });
    prisma.mediaAsset.update.mockResolvedValue({});
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation(async (operation: (tx: typeof prisma) => unknown) => operation(prisma));
    service = new MediaService(imageKit as never, config, prisma as never);
  });

  it('returns upload auth without the private key', () => {
    const response = service.getImageKitUploadAuth();
    expect(response).toEqual({
      token: 'one-time-token',
      signature: 'signature',
      expire: 123,
      publicKey: 'public_test',
      urlEndpoint: 'https://ik.imagekit.io/account',
      folder: '/products',
      limits: {
        maxImageBytes: 1024,
        maxImageWidth: 6000,
        maxImageHeight: 6000,
        maxVideoBytes: 157286400,
        maxVideoDurationSeconds: 60,
      },
    });
    expect(response).not.toHaveProperty('privateKey');
  });

  it('uses authoritative ImageKit metadata instead of the submitted URL', async () => {
    await expect(
      service.verifyProductImage({
        fileId: 'file-1',
        url: 'https://attacker.example/image.jpg',
      }),
    ).resolves.toMatchObject({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/photo.webp',
      mime: 'image/webp',
    });
  });

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])(
    'accepts allowed MIME %s',
    async (mime) => {
      imageKit.getFile.mockResolvedValueOnce(imageAsset(mime, 500));
      await expect(
        service.verifyProductImage({
          fileId: 'file-1',
          url: 'https://attacker.example/fake.jpg',
        }),
      ).resolves.toMatchObject({ mime });
    },
  );

  it.each([
    'application/pdf',
    'application/zip',
    'text/plain',
    'application/javascript',
    'image/svg+xml',
  ])('rejects disallowed MIME %s', async (mime) => {
    imageKit.getFile.mockResolvedValueOnce(imageAsset(mime, 500));
    await expect(
      service.verifyProductImage({
        fileId: 'file-1',
        url: 'https://ik.imagekit.io/account/products/photo.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['20 MB', 20 * 1024 * 1024],
    ['50 MB', 50 * 1024 * 1024],
    ['100 MB', 100 * 1024 * 1024],
  ] as const)(
    'rejects oversized assets at %s',
    async (_label, size) => {
      const defaultLimitService = new MediaService(
        imageKit as never,
        createConfigService({
          IMAGEKIT_PUBLIC_KEY: 'public_test',
          IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
          IMAGEKIT_PRODUCT_FOLDER: '/products',
        }),
        prisma as never,
      );
      imageKit.getFile.mockResolvedValueOnce(imageAsset('image/jpeg', size));
      const verification = defaultLimitService.verifyProductImage({
        fileId: 'file-1',
        url: 'https://frontend.example/photo.jpg',
      });
      await expect(verification).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('enforces the canonical configured image size limit', async () => {
    const customLimitService = new MediaService(
      imageKit as never,
      createConfigService({
        IMAGEKIT_PUBLIC_KEY: 'public_test',
        IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
        IMAGEKIT_PRODUCT_FOLDER: '/products',
        MEDIA_MAX_IMAGE_BYTES: 1024,
      }),
      prisma as never,
    );
    imageKit.getFile.mockResolvedValueOnce(imageAsset('image/png', 1025));
    await expect(
      customLimitService.verifyProductImage({
        fileId: 'file-1',
        url: 'https://frontend.example/photo.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts an image exactly at its configured byte limit', async () => {
    imageKit.getFile.mockResolvedValueOnce(imageAsset('image/jpeg', 1_024));
    await expect(
      service.verifyProductImage({ fileId: 'file-1', url: 'https://x.test/x' }),
    ).resolves.toMatchObject({ size: 1_024 });
  });

  it('rejects assets outside the configured product folder', async () => {
    imageKit.getFile.mockResolvedValueOnce(
      imageAsset('image/jpeg', 500, '/avatars/photo.jpg'),
    );
    await expect(
      service.verifyProductImage({
        fileId: 'file-1',
        url: 'https://frontend.example/photo.jpg',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    'https://ik.imagekit.io/other-account/products/photo.jpg',
    'https://cdn.attacker.example/products/photo.jpg',
  ])('rejects a URL outside the configured endpoint: %s', async (url) => {
    imageKit.getFile.mockResolvedValueOnce(
      imageAsset('image/jpeg', 500, '/products/photo.jpg', url),
    );
    await expect(
      service.verifyProductImage({ fileId: 'file-1', url }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a non-image and an oversized image', async () => {
    imageKit.getFile.mockResolvedValueOnce({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/file.exe',
      filePath: '/products/file.exe',
      fileType: 'non-image',
      mime: 'application/x-msdownload',
      size: 10,
    });
    await expect(
      service.verifyProductImage({ fileId: 'file-1', url: 'https://x.test/x' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    imageKit.getFile.mockResolvedValueOnce({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/large.jpg',
      filePath: '/products/large.jpg',
      fileType: 'image',
      mime: 'image/jpeg',
      size: 1_025,
      width: 800,
      height: 600,
    });
    await expect(
      service.verifyProductImage({ fileId: 'file-1', url: 'https://x.test/x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a real video and rejects a requested type mismatch', async () => {
    imageKit.getFile.mockResolvedValue({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/video.mp4',
      filePath: '/products/video.mp4',
      fileType: 'non-image',
      mime: 'video/mp4',
      size: 1_000_000,
      width: 1920,
      height: 1080,
      duration: 30,
      isPrivateFile: false,
      isPublished: true,
    });
    await expect(
      service.verifyProductMedia({
        type: 'VIDEO',
        fileId: 'file-1',
        url: 'https://frontend.example/video.mp4',
        position: 0,
      }),
    ).resolves.toMatchObject({ type: 'VIDEO', mime: 'video/mp4' });
    await expect(
      service.verifyProductMedia({
        type: 'IMAGE',
        fileId: 'file-1',
        url: 'https://frontend.example/video.mp4',
        position: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['exactly 150 MiB', 150 * 1024 * 1024, true],
    ['one byte over 150 MiB', 150 * 1024 * 1024 + 1, false],
  ])('applies the canonical video byte limit at %s', async (_label, size, allowed) => {
    imageKit.getFile.mockResolvedValueOnce({
      ...imageAsset('video/mp4', size),
      fileType: 'non-image',
      duration: 30,
    });
    const verification = service.verifyProductMedia({
      type: 'VIDEO', fileId: 'file-1', url: 'https://x.test/x', position: 0,
    });
    if (allowed) await expect(verification).resolves.toMatchObject({ size });
    else await expect(verification).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown fileId', async () => {
    imageKit.getFile.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.verifyProductImage({
        fileId: 'missing-file',
        url: 'https://ik.imagekit.io/account/products/missing.jpg',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    { width: undefined },
    { height: undefined },
    { width: 6001 },
    { height: 6001 },
    { width: 0 },
    { height: Number.NaN },
  ])('rejects invalid authoritative dimensions %j', async (metadata) => {
    imageKit.getFile.mockResolvedValueOnce({ ...imageAsset('image/jpeg', 500), ...metadata });
    await expect(service.verifyProductImage({ fileId: 'file-1', url: 'https://x.test/x' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([undefined, 0, 61, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects missing or excessive video duration %s', async (duration) => {
      imageKit.getFile.mockResolvedValueOnce({
        ...imageAsset('video/mp4', 500), fileType: 'non-image', duration,
      });
      await expect(service.verifyProductMedia({ type: 'VIDEO', fileId: 'file-1', url: 'https://x.test/x', position: 0 }))
        .rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('allows cleanup of rejected oversized unassigned assets', async () => {
    imageKit.getFile.mockResolvedValueOnce(imageAsset('image/jpeg', 100 * 1024 * 1024));
    await expect(service.deleteUnassignedImage('file-1')).resolves.toBeUndefined();
    expect(imageKit.deleteFile).toHaveBeenCalledWith('file-1');
  });

  it('does not delete an asset referenced by a product', async () => {
    prisma.product.count.mockResolvedValue(1);
    await expect(
      service.deleteUnassignedImage('file-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(imageKit.deleteFile).not.toHaveBeenCalled();
  });

  it('does not delete an asset referenced by ProductMedia', async () => {
    prisma.productMedia.count.mockResolvedValue(1);
    await expect(
      service.deleteUnassignedImage('file-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(imageKit.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes a verified unreferenced asset', async () => {
    await expect(
      service.deleteUnassignedImage('file-1'),
    ).resolves.toBeUndefined();
    expect(prisma.product.count).toHaveBeenCalledWith({
      where: { imageFileId: 'file-1' },
    });
    expect(prisma.productMedia.count).toHaveBeenCalledWith({
      where: { fileId: 'file-1' },
    });
    expect(imageKit.deleteFile).toHaveBeenCalledWith('file-1');
  });

  it('rejects attaching an asset already leased for deletion', async () => {
    prisma.mediaAsset.findMany.mockResolvedValueOnce([
      { fileId: 'file-1', status: MediaAssetStatus.DELETE_PENDING },
    ]);
    await expect(
      service.withReservedAssets([{ fileId: 'file-1' }], async () => undefined),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('retries a deletion only after a pending lease has expired', async () => {
    prisma.mediaAsset.upsert.mockResolvedValueOnce({
      status: MediaAssetStatus.DELETE_PENDING,
      deleteLeaseExpiresAt: new Date(Date.now() - 1),
    });
    await expect(service.deleteImageIfUnreferenced('file-1')).resolves.toBe(true);
    expect(imageKit.deleteFile).toHaveBeenCalledWith('file-1');
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MediaAssetStatus.DELETE_PENDING }),
      }),
    );
  });

  it('does not retry a deletion with a live pending lease', async () => {
    prisma.mediaAsset.upsert.mockResolvedValueOnce({
      status: MediaAssetStatus.DELETE_PENDING,
      deleteLeaseExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.deleteImageIfUnreferenced('file-1')).resolves.toBe(false);
    expect(imageKit.deleteFile).not.toHaveBeenCalled();
  });

  it('treats an already missing provider asset as a completed cleanup', async () => {
    imageKit.deleteFile.mockRejectedValueOnce(new NotFoundException({
      error: 'IMAGE_NOT_FOUND',
    }));
    await expect(service.deleteImageIfUnreferenced('file-1')).resolves.toBe(true);
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MediaAssetStatus.DELETED }),
      }),
    );
  });

  it('restores an asset to ACTIVE when provider deletion fails', async () => {
    imageKit.deleteFile.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.deleteImageIfUnreferenced('file-1')).resolves.toBe(false);
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: MediaAssetStatus.ACTIVE }),
      }),
    );
  });
});

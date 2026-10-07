import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  };
  const config = new ConfigService({
    IMAGEKIT_PUBLIC_KEY: 'public_test',
    IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
    IMAGEKIT_PRODUCT_FOLDER: '/products',
    IMAGEKIT_MAX_IMAGE_BYTES: 1_000,
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
      isPrivateFile: false,
      isPublished: true,
    });
    prisma.product.count.mockResolvedValue(0);
    prisma.productMedia.count.mockResolvedValue(0);
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
    'does not enforce an app-level size limit at %s',
    async (_label, size) => {
      const defaultLimitService = new MediaService(
        imageKit as never,
        new ConfigService({
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
      await expect(verification).resolves.toMatchObject({ size });
    },
  );

  it('ignores the deprecated environment-specific image size limit', async () => {
    const customLimitService = new MediaService(
      imageKit as never,
      new ConfigService({
        IMAGEKIT_PUBLIC_KEY: 'public_test',
        IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
        IMAGEKIT_PRODUCT_FOLDER: '/products',
        IMAGEKIT_MAX_IMAGE_BYTES: 100,
      }),
      prisma as never,
    );
    imageKit.getFile.mockResolvedValueOnce(imageAsset('image/png', 101));
    await expect(
      customLimitService.verifyProductImage({
        fileId: 'file-1',
        url: 'https://frontend.example/photo.png',
      }),
    ).resolves.toMatchObject({ size: 101 });
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

  it('rejects a non-image but not a large valid image', async () => {
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
      size: 1_001,
    });
    await expect(
      service.verifyProductImage({ fileId: 'file-1', url: 'https://x.test/x' }),
    ).resolves.toMatchObject({ size: 1_001 });
  });

  it('accepts a real video and rejects a requested type mismatch', async () => {
    imageKit.getFile.mockResolvedValue({
      fileId: 'file-1',
      url: 'https://ik.imagekit.io/account/products/video.mp4',
      filePath: '/products/video.mp4',
      fileType: 'non-image',
      mime: 'video/mp4',
      size: 25_000_000,
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

  it('rejects an unknown fileId', async () => {
    imageKit.getFile.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.verifyProductImage({
        fileId: 'missing-file',
        url: 'https://ik.imagekit.io/account/products/missing.jpg',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
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
});

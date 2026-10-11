import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConfiguration } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  MediaAssetStatus,
  ProductMediaType,
  type Prisma,
} from '../../generated/prisma/client.js';
import type { ProductMediaDto } from '../products/dto/product-media.dto.js';
import type { ProductImageDto } from './dto/product-image.dto.js';
import { ImageKitService } from './imagekit.service.js';

const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
]);
const allowedVideoTypes = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

// A crashed process may leave an otherwise unreferenced provider file in
// DELETE_PENDING after the provider operation has already completed.  The
// lease makes cleanup recoverable without allowing a second request to race a
// deletion already in progress.
const deletionLeaseMs = 5 * 60 * 1_000;

export interface VerifiedImageAsset {
  fileId: string;
  url: string;
  filePath: string;
  mime: string;
  size: number;
}

export interface VerifiedMediaAsset extends VerifiedImageAsset {
  type: ProductMediaType;
  width: number | null;
  height: number | null;
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly imageKitService: ImageKitService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  getImageKitUploadAuth() {
    const authentication = this.imageKitService.getUploadAuthentication();
    return {
      ...authentication,
      publicKey: getConfiguration(this.configService).media.publicKey,
      urlEndpoint: getConfiguration(this.configService).media.urlEndpoint,
      folder: this.productFolder,
      limits: this.limits,
    };
  }

  async verifyProductImage(
    image: Pick<ProductImageDto, 'fileId' | 'url'>,
  ): Promise<VerifiedImageAsset> {
    return this.verifyAsset(image.fileId, ProductMediaType.IMAGE);
  }

  async verifyProductMedia(
    media: Pick<ProductMediaDto, 'type' | 'fileId' | 'url' | 'position'>,
  ): Promise<VerifiedMediaAsset> {
    return this.verifyAsset(media.fileId, media.type);
  }

  async deleteUnassignedImage(fileId: string): Promise<void> {
    const normalized = fileId.trim();
    if (!normalized || normalized.length > 255) {
      throw this.invalidMedia('ImageKit fileId yaroqsiz');
    }
    await this.verifyAsset(normalized, undefined, false);
    if (!(await this.deleteWhenUnreferenced(normalized))) {
      throw new ConflictException({
        error: 'MEDIA_IN_USE',
        message: 'Product ishlatayotgan media faylini o‘chirib bo‘lmaydi',
      });
    }
  }

  async deleteImageIfUnreferenced(fileId: string): Promise<boolean> {
    try {
      return await this.deleteWhenUnreferenced(fileId);
    } catch (error) {
      this.logger.warn({
        event: 'unreferenced_media_cleanup_failed',
        errorType: error instanceof Error ? error.name : 'unknown',
        ...(typeof error === 'object' && error !== null && 'code' in error &&
        typeof error.code === 'string' ? { code: error.code } : {}),
      });
      return false;
    }
  }

  /**
   * A product write runs under the same PostgreSQL advisory locks used by
   * deletion. This is distributed (not process-local), so it remains safe
   * when multiple backend containers are serving requests.
   */
  async withReservedAssets<T>(
    assets: readonly Pick<VerifiedMediaAsset, 'fileId'>[],
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const fileIds = [...new Set(assets.map((asset) => asset.fileId.trim()))]
      .filter(Boolean)
      .sort();
    if (!fileIds.length) return operation(this.prisma);

    return this.prisma.$transaction(async (transaction) => {
      await this.lockAssets(transaction, fileIds);
      const known = await transaction.mediaAsset.findMany({
        where: { fileId: { in: fileIds } },
        select: { fileId: true, status: true },
      });
      if (known.some((asset) => asset.status !== MediaAssetStatus.ACTIVE)) {
        throw new ConflictException({
          error: 'MEDIA_UNAVAILABLE',
          message: 'Media fayli oâ€˜chirish jarayonida yoki oâ€˜chirilgan',
        });
      }
      const knownIds = new Set(known.map((asset) => asset.fileId));
      const missing = fileIds.filter((fileId) => !knownIds.has(fileId));
      if (missing.length) {
        await transaction.mediaAsset.createMany({
          data: missing.map((fileId) => ({
            fileId,
            status: MediaAssetStatus.ACTIVE,
          })),
          skipDuplicates: true,
        });
      }
      return operation(transaction);
    });
  }

  private async deleteWhenUnreferenced(fileId: string): Promise<boolean> {
    const state = await this.prisma.$transaction(async (transaction) => {
      await this.lockAssets(transaction, [fileId]);
      const asset = await transaction.mediaAsset.upsert({
        where: { fileId },
        create: { fileId, status: MediaAssetStatus.ACTIVE },
        update: {},
        select: { status: true, deleteLeaseExpiresAt: true },
      });
      const now = new Date();
      const mayRetryExpiredLease =
        asset.status === MediaAssetStatus.DELETE_PENDING &&
        asset.deleteLeaseExpiresAt !== null &&
        asset.deleteLeaseExpiresAt !== undefined &&
        asset.deleteLeaseExpiresAt <= now;
      if (asset.status !== MediaAssetStatus.ACTIVE && !mayRetryExpiredLease) {
        return 'unavailable' as const;
      }
      if (!mayRetryExpiredLease && (await this.countReferences(transaction, fileId)) > 0) {
        return 'referenced' as const;
      }
      await transaction.mediaAsset.update({
        where: { fileId },
        data: {
          status: MediaAssetStatus.DELETE_PENDING,
          deleteRequestedAt: now,
          deleteLeaseExpiresAt: new Date(now.getTime() + deletionLeaseMs),
          deletedAt: null,
        },
      });
      return 'ready' as const;
    });
    if (state !== 'ready') return false;

    try {
      await this.imageKitService.deleteFile(fileId);
    } catch (error) {
      // A retry can reach the provider after the original deletion succeeded
      // but before this process persisted DELETED.  A 404 therefore means the
      // desired provider state already exists and is safe to finalize.
      if (this.isProviderNotFound(error)) {
        await this.markDeleted(fileId);
        return true;
      }
      await this.restoreActiveAfterDeleteFailure(fileId);
      throw error;
    }

    await this.markDeleted(fileId);
    return true;
  }

  private async markDeleted(fileId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockAssets(transaction, [fileId]);
      await transaction.mediaAsset.updateMany({
        where: { fileId, status: MediaAssetStatus.DELETE_PENDING },
        data: {
          status: MediaAssetStatus.DELETED,
          deleteLeaseExpiresAt: null,
          deletedAt: new Date(),
        },
      });
    });
  }

  private async restoreActiveAfterDeleteFailure(fileId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockAssets(transaction, [fileId]);
      await transaction.mediaAsset.updateMany({
        where: { fileId, status: MediaAssetStatus.DELETE_PENDING },
        data: {
          status: MediaAssetStatus.ACTIVE,
          deleteRequestedAt: null,
          deleteLeaseExpiresAt: null,
        },
      });
    });
  }

  private isProviderNotFound(error: unknown): boolean {
    if (!(error instanceof NotFoundException)) return false;
    const response = error.getResponse();
    return typeof response === 'object' && response !== null &&
      'error' in response && response.error === 'IMAGE_NOT_FOUND';
  }

  private async lockAssets(
    transaction: Prisma.TransactionClient,
    fileIds: readonly string[],
  ): Promise<void> {
    for (const fileId of [...fileIds].sort()) {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fileId}, 0::bigint))`;
    }
  }

  private async verifyAsset(
    rawFileId: string,
    requestedType?: ProductMediaType,
    enforceLimits = true,
  ): Promise<VerifiedMediaAsset> {
    const fileId = rawFileId.trim();
    if (!fileId) {
      throw this.invalidMedia('ImageKit fileId bo‘sh bo‘lishi mumkin emas');
    }
    const file = await this.imageKitService.getFile(fileId);
    const actualFileId = file.fileId?.trim();
    const url = file.url?.trim();
    const filePath = file.filePath?.trim();
    const mime = file.mime?.toLowerCase();
    const size = file.size;
    if (!actualFileId || actualFileId !== fileId || !url || !filePath) {
      throw this.invalidMedia('ImageKit fayl metadata-si yaroqsiz');
    }
    if (!Number.isSafeInteger(size) || (size ?? 0) <= 0) {
      throw this.invalidMedia('Media hajmi aniqlanmadi');
    }

    const inferredType =
      file.fileType === 'image' && mime && allowedImageTypes.has(mime)
        ? ProductMediaType.IMAGE
        : (file.fileType === 'video' || file.fileType === 'non-image') &&
            mime &&
            allowedVideoTypes.has(mime)
          ? ProductMediaType.VIDEO
          : null;
    if (!inferredType) {
      throw this.invalidMedia('Media formati qo‘llab-quvvatlanmaydi');
    }
    if (requestedType && requestedType !== inferredType) {
      throw this.invalidMedia('Media turi ImageKit metadata-siga mos emas');
    }
    if (file.isPrivateFile === true || file.isPublished === false) {
      throw this.invalidMedia(
        'Product media-si ommaviy va published bo‘lishi kerak',
      );
    }
    if (!this.isInsideProductFolder(filePath)) {
      throw this.invalidMedia('Media products papkasiga yuklanmagan');
    }
    if (!this.isConfiguredImageKitUrl(url, filePath)) {
      throw this.invalidMedia('ImageKit media URL konfiguratsiyaga mos emas');
    }
    if (enforceLimits) {
      const limits = this.limits;
      const maxBytes = inferredType === ProductMediaType.IMAGE
        ? limits.maxImageBytes : limits.maxVideoBytes;
      if (typeof size !== 'number' || size > maxBytes) {
        throw this.invalidMedia('Media hajmi ruxsat etilgan limitdan katta');
      }
      if (!Number.isSafeInteger(file.width) || !Number.isSafeInteger(file.height) ||
          !file.width || !file.height || file.width < 1 || file.height < 1 ||
          file.width > limits.maxImageWidth || file.height > limits.maxImageHeight) {
        throw this.invalidMedia('Media o‘lchamlari aniqlanmagan yoki limitdan katta');
      }
      if (inferredType === ProductMediaType.VIDEO &&
          (typeof file.duration !== 'number' || !Number.isFinite(file.duration) ||
           file.duration <= 0 || file.duration > limits.maxVideoDurationSeconds)) {
        throw this.invalidMedia('Video davomiyligi aniqlanmagan yoki limitdan katta');
      }
    }
    return {
      type: inferredType,
      fileId: actualFileId,
      url,
      filePath,
      mime: mime!,
      size: size as number,
      width: Number.isSafeInteger(file.width) ? (file.width ?? null) : null,
      height: Number.isSafeInteger(file.height) ? (file.height ?? null) : null,
    };
  }

  private async countReferences(
    database: Pick<Prisma.TransactionClient, 'product' | 'productMedia' | 'botAppearance'>,
    fileId: string,
  ): Promise<number> {
    const [legacyReferences, mediaReferences, backgroundReferences] = await Promise.all([
      database.product.count({ where: { imageFileId: fileId } }),
      database.productMedia.count({ where: { fileId } }),
      database.botAppearance.count({ where: { backgroundFileId: fileId } }),
    ]);
    return legacyReferences + mediaReferences + backgroundReferences;
  }

  private isInsideProductFolder(filePath: string): boolean {
    return filePath.startsWith(`${this.productFolder}/`);
  }

  private isConfiguredImageKitUrl(url: string, filePath: string): boolean {
    try {
      const actual = new URL(url);
      const configuredEndpoint = getConfiguration(this.configService).media.urlEndpoint;
      if (!configuredEndpoint) return false;
      const endpoint = new URL(configuredEndpoint);
      const endpointPath = decodeURIComponent(endpoint.pathname).replace(
        /\/$/,
        '',
      );
      return (
        actual.protocol === 'https:' &&
        actual.origin === endpoint.origin &&
        decodeURIComponent(actual.pathname) === `${endpointPath}${filePath}`
      );
    } catch {
      return false;
    }
  }

  private get productFolder(): string {
    return getConfiguration(this.configService).media.productFolder;
  }

  private get limits() {
    const media = getConfiguration(this.configService).media;
    return {
      maxImageBytes: media.maxImageBytes,
      maxImageWidth: media.maxImageWidth,
      maxImageHeight: media.maxImageHeight,
      maxVideoBytes: media.maxVideoBytes,
      maxVideoDurationSeconds: media.maxVideoDurationSeconds,
    };
  }

  private invalidMedia(message: string) {
    this.logger.warn('ImageKit asset validation failed');
    return new BadRequestException({ error: 'INVALID_MEDIA', message });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { ProductMediaType } from '../../generated/prisma/client.js';
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
  'video/x-m4v',
  'video/ogg',
  'video/mpeg',
]);

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
      publicKey: this.configService.getOrThrow<string>('IMAGEKIT_PUBLIC_KEY'),
      urlEndpoint: this.configService.getOrThrow<string>(
        'IMAGEKIT_URL_ENDPOINT',
      ),
      folder: this.productFolder,
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
    await this.verifyAsset(normalized);
    if ((await this.countReferences(normalized)) > 0) {
      throw new ConflictException({
        error: 'MEDIA_IN_USE',
        message: 'Product ishlatayotgan media faylini o‘chirib bo‘lmaydi',
      });
    }
    await this.imageKitService.deleteFile(normalized);
  }

  async deleteImageIfUnreferenced(fileId: string): Promise<boolean> {
    if ((await this.countReferences(fileId)) > 0) return false;
    try {
      await this.imageKitService.deleteFile(fileId);
      return true;
    } catch {
      this.logger.warn('Unreferenced ImageKit asset cleanup failed');
      return false;
    }
  }

  private async verifyAsset(
    rawFileId: string,
    requestedType?: ProductMediaType,
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

  private async countReferences(fileId: string): Promise<number> {
    const [legacyReferences, mediaReferences] = await Promise.all([
      this.prisma.product.count({ where: { imageFileId: fileId } }),
      this.prisma.productMedia?.count({ where: { fileId } }) ?? 0,
    ]);
    return legacyReferences + mediaReferences;
  }

  private isInsideProductFolder(filePath: string): boolean {
    return filePath.startsWith(`${this.productFolder}/`);
  }

  private isConfiguredImageKitUrl(url: string, filePath: string): boolean {
    try {
      const actual = new URL(url);
      const endpoint = new URL(
        this.configService.getOrThrow<string>('IMAGEKIT_URL_ENDPOINT'),
      );
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
    return this.configService.get<string>(
      'IMAGEKIT_PRODUCT_FOLDER',
      '/products',
    );
  }

  private invalidMedia(message: string) {
    this.logger.warn('ImageKit asset validation failed');
    return new BadRequestException({ error: 'INVALID_MEDIA', message });
  }
}

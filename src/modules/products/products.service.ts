import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  ProductAvailabilityStatus,
  ProductMediaType,
  TelegramProductSyncStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { imageVariants } from '../media/image-variants.js';
import {
  MediaService,
  type VerifiedMediaAsset,
} from '../media/media.service.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { ProductMediaDto } from './dto/product-media.dto.js';
import type { QueryProductsDto } from './dto/query-products.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductTelegramPublisherService } from './product-telegram-publisher.service.js';
import {
  ProductsRepository,
  type ProductData,
  type ProductMediaData,
  type PublicProductCard,
} from './products.repository.js';

const productNotFound = () =>
  new NotFoundException({
    error: 'PRODUCT_NOT_FOUND',
    message: 'Mahsulot topilmadi',
  });
const categoryNotFound = () =>
  new NotFoundException({
    error: 'CATEGORY_NOT_FOUND',
    message: 'Kategoriya topilmadi',
  });
const categoryInactive = () =>
  new BadRequestException({
    error: 'CATEGORY_INACTIVE',
    message: 'Faol bo‘lmagan kategoriyaga mahsulot biriktirib bo‘lmaydi',
  });

type ProductRecord = NonNullable<
  Awaited<ReturnType<ProductsRepository['findById']>>
>;
type PublicProductRecord = NonNullable<
  Awaited<ReturnType<ProductsRepository['findPublicById']>>
>;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly productsRepository: ProductsRepository,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly mediaService?: MediaService,
    @Optional()
    private readonly telegramPublisher?: ProductTelegramPublisherService,
  ) {}

  async findPublic(query: QueryProductsDto) {
    const { data, total } = await this.productsRepository.list(query, false);
    return this.paginate(
      data.map((product) => this.toCardResponse(product)),
      total,
      query,
    );
  }

  async findForAdmin(query: QueryProductsDto) {
    const { data, total } = await this.productsRepository.list(query, true);
    return this.paginate(
      data.map((product) => this.toAdminResponse(product)),
      total,
      query,
    );
  }

  async findOnePublic(id: string) {
    const product = await this.productsRepository.findPublicById(id);
    if (!product) throw productNotFound();
    return this.toPublicResponse(product);
  }

  async findOneForAdmin(id: string) {
    const product = await this.productsRepository.findById(id);
    if (!product) throw productNotFound();
    return this.toAdminResponse(product);
  }

  async create(dto: CreateProductDto, actorUserId?: string) {
    this.assertExclusiveInputs(dto.image, dto.media);
    const availabilityStatus =
      dto.availabilityStatus ?? ProductAvailabilityStatus.IN_STOCK;
    this.assertCargoPrice(availabilityStatus, dto.cargoPrice);
    await this.ensureCategory(dto.categoryId);
    const requestedMedia = dto.media?.length ? dto.media : undefined;
    if (requestedMedia) this.validateMediaSet(requestedMedia);
    const media = requestedMedia
      ? await this.verifyNewMedia(requestedMedia)
      : [];
    const legacyImage =
      !requestedMedia && dto.image
        ? await this.getMediaService().verifyProductImage(dto.image)
        : undefined;
    const primaryImage = media.find(
      (item) => item.type === ProductMediaType.IMAGE,
    );
    const data: ProductData = {
      name: dto.name.trim(),
      description: this.optionalText(dto.description),
      price: dto.price,
      cargoPrice: dto.cargoPrice ?? null,
      imageUrl: primaryImage?.url ?? legacyImage?.url ?? null,
      imageFileId: primaryImage?.fileId ?? legacyImage?.fileId ?? null,
      categoryId: dto.categoryId,
      availabilityStatus,
      telegramSyncStatus: TelegramProductSyncStatus.PENDING,
    };
    const assetsToReserve = legacyImage ? [...media, legacyImage] : media;

    try {
      let product = assetsToReserve.length
        ? await this.getMediaService().withReservedAssets(
            assetsToReserve,
            (transaction) =>
              media.length
                ? this.productsRepository.createWithMediaInTransaction(
                    transaction,
                    data,
                    media,
                  )
                : this.productsRepository.createInTransaction(
                    transaction,
                    data,
                  ),
          )
        : await this.productsRepository.create(data);
      if (actorUserId) {
        await this.auditService?.log({
          actorUserId,
          action: AuditAction.PRODUCT_CREATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: product.id,
          metadata: {
            name: product.name,
            categoryId: product.categoryId,
            mediaAdded: media.map((item) => ({
              type: item.type,
              fileId: item.fileId,
            })),
          },
        });
      }
      if (this.hasMedia(product) && this.telegramPublisher) {
        product = await this.telegramPublisher.syncAfterCreate(product);
      }
      return this.toAdminResponse(product);
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) throw categoryNotFound();
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto, actorUserId?: string) {
    this.assertExclusiveInputs(dto.image, dto.media);
    const existing = await this.productsRepository.findById(id);
    if (!existing) throw productNotFound();
    const availabilityStatus =
      dto.availabilityStatus ?? existing.availabilityStatus;
    const cargoPrice =
      availabilityStatus === ProductAvailabilityStatus.ARRIVING_IN_14_DAYS
        ? dto.cargoPrice === undefined
          ? existing.cargoPrice
          : dto.cargoPrice
        : dto.cargoPrice;
    this.assertCargoPrice(availabilityStatus, cargoPrice);
    if (dto.categoryId !== undefined) await this.ensureCategory(dto.categoryId);

    const data: Partial<ProductData> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined)
      data.description = this.optionalText(dto.description);
    if (dto.price !== undefined) data.price = dto.price;
    if (availabilityStatus === ProductAvailabilityStatus.ARRIVING_IN_14_DAYS) {
      if (dto.cargoPrice !== undefined) data.cargoPrice = dto.cargoPrice;
    } else if (
      existing.cargoPrice !== null &&
      existing.cargoPrice !== undefined
    ) {
      data.cargoPrice = null;
    }
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.availabilityStatus !== undefined)
      data.availabilityStatus = dto.availabilityStatus;

    const oldMedia = existing.media ?? [];
    let mediaChanged = false;
    let newMedia: ProductMediaData[] | undefined;
    let removedFileIds: string[] = [];
    let assetsToReserve: Array<Pick<VerifiedMediaAsset, 'fileId'>> = [];

    if (dto.media !== undefined && !dto.image) {
      this.validateMediaSet(dto.media);
      newMedia = await this.resolveUpdatedMedia(dto.media, oldMedia);
      mediaChanged =
        !this.sameMediaSet(oldMedia, newMedia) ||
        Boolean(existing.imageUrl && oldMedia.length === 0);
      if (mediaChanged) {
        assetsToReserve = newMedia.filter(
          (item) => !oldMedia.some((old) => old.fileId === item.fileId),
        );
        const retained = new Set(newMedia.map((item) => item.fileId));
        removedFileIds = oldMedia
          .filter((item) => !retained.has(item.fileId))
          .map((item) => item.fileId);
        if (existing.imageFileId && !retained.has(existing.imageFileId)) {
          removedFileIds.push(existing.imageFileId);
        }
        const primaryImage = newMedia.find(
          (item) => item.type === ProductMediaType.IMAGE,
        );
        data.imageUrl = primaryImage?.url ?? null;
        data.imageFileId = primaryImage?.fileId ?? null;
      }
    } else if (dto.image) {
      const verified = await this.getMediaService().verifyProductImage(
        dto.image,
      );
      const legacyChanged =
        verified.fileId !== existing.imageFileId ||
        verified.url !== existing.imageUrl;
      mediaChanged = legacyChanged || oldMedia.length > 0;
      if (legacyChanged) assetsToReserve = [verified];
      data.imageUrl = verified.url;
      data.imageFileId = verified.fileId;
      if (oldMedia.length) {
        newMedia = [];
        removedFileIds = oldMedia.map((item) => item.fileId);
      } else if (legacyChanged && existing.imageFileId) {
        removedFileIds = [existing.imageFileId];
      }
    }

    if (!Object.keys(data).length && !mediaChanged)
      return this.toAdminResponse(existing);
    try {
      const persist = (transaction?: Prisma.TransactionClient) =>
        newMedia !== undefined && mediaChanged
          ? transaction
            ? this.productsRepository.replaceMediaInTransaction(
                transaction,
                id,
                data,
                newMedia,
                existing.version,
              )
            : this.productsRepository.replaceMedia(
                id,
                data,
                newMedia,
                existing.version,
              )
          : transaction
            ? this.productsRepository.updateInTransaction(
                transaction,
                id,
                data,
                existing.version,
              )
            : this.productsRepository.update(id, data, existing.version);
      let product = assetsToReserve.length
        ? await this.getMediaService().withReservedAssets(assetsToReserve, persist)
        : await persist();

      if (actorUserId) {
        const oldKeys = oldMedia.map(
          (item) => `${item.type}:${item.fileId}:${item.position}`,
        );
        const newKeys = (newMedia ?? oldMedia).map(
          (item) => `${item.type}:${item.fileId}:${item.position}`,
        );
        const added = (newMedia ?? []).filter(
          (item) => !oldMedia.some((old) => old.fileId === item.fileId),
        );
        const metadata: Record<string, unknown> = { fields: Object.keys(data) };
        if (dto.image && mediaChanged) {
          metadata.oldImageFileId = existing.imageFileId;
          metadata.newImageFileId = data.imageFileId;
        } else if (newMedia !== undefined) {
          metadata.mediaAdded = added.map((item) => ({
            type: item.type,
            fileId: item.fileId,
          }));
          metadata.mediaRemoved = removedFileIds;
          metadata.mediaReordered =
            mediaChanged && oldKeys.join('|') !== newKeys.join('|');
          metadata.videoChanged =
            mediaChanged &&
            (oldMedia.some((item) => item.type === ProductMediaType.VIDEO) ||
              (newMedia ?? []).some(
                (item) => item.type === ProductMediaType.VIDEO,
              ));
        }
        await this.auditService?.log({
          actorUserId,
          action: Object.keys(data).every((key) =>
            ['availabilityStatus', 'cargoPrice'].includes(key),
          )
            ? AuditAction.PRODUCT_STATUS_CHANGE
            : AuditAction.PRODUCT_UPDATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: id,
          metadata,
        });
      }

      if (this.telegramPublisher) {
        if (this.hasMedia(product)) {
          product = await this.telegramPublisher.syncAfterUpdate(
            product,
            mediaChanged,
          );
        } else if (mediaChanged) {
          await this.telegramPublisher.removeProductPostsBestEffort(product);
        }
      }
      for (const fileId of new Set(removedFileIds))
        await this.cleanupMedia(fileId);
      return this.toAdminResponse(product);
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) throw categoryNotFound();
      if (this.isPrismaError(error, 'P2025')) throw new ConflictException({
        error: 'PRODUCT_CHANGED',
        message: 'Mahsulot boshqa so‘rov tomonidan o‘zgartirilgan; qayta yuklab ko‘ring',
      });
      throw error;
    }
  }

  async syncTelegram(
    id: string,
    forceRepublish: boolean,
    actorUserId?: string,
  ) {
    const product = await this.productsRepository.findById(id);
    if (!product) throw productNotFound();
    if (!this.telegramPublisher) {
      throw new ServiceUnavailableException('Telegram publisher unavailable');
    }
    try {
      const synced = await this.telegramPublisher.syncManually(
        product,
        forceRepublish,
      );
      await this.auditTelegramSync(actorUserId, id, {
        success: true,
        forceRepublish,
      });
      return this.toAdminResponse(synced);
    } catch (error) {
      await this.auditTelegramSync(actorUserId, id, {
        success: false,
        forceRepublish,
      });
      throw error;
    }
  }

  async remove(id: string, actorUserId?: string): Promise<void> {
    const product = await this.productsRepository.findById(id);
    if (!product) throw productNotFound();
    try {
      const removal = await this.productsRepository.removeOrDeactivate(id, product.version);
      if (!removal) throw productNotFound();
      if (removal.softDeleted) {
        if (this.telegramPublisher) {
          await this.telegramPublisher.removeProductPostsBestEffort(
            removal.product,
          );
        }
        if (actorUserId) await this.logDelete(actorUserId, id, true);
        return;
      }

      const fileIds = new Set((removal.product.media ?? []).map((item) => item.fileId));
      if (removal.product.imageFileId) fileIds.add(removal.product.imageFileId);
      if (this.telegramPublisher) await this.telegramPublisher.deleteProductPostsBestEffort(removal.product);
      for (const fileId of fileIds) await this.cleanupMedia(fileId);
      if (actorUserId) await this.logDelete(actorUserId, id, false);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) throw productNotFound();
      throw error;
    }
  }

  private validateMediaSet(media: ProductMediaDto[]): void {
    const imageCount = media.filter(
      (item) => item.type === ProductMediaType.IMAGE,
    ).length;
    const videoCount = media.filter(
      (item) => item.type === ProductMediaType.VIDEO,
    ).length;
    if (imageCount > 5) {
      throw new BadRequestException(
        'Bir mahsulotga maksimal 5 ta rasm qo‘shish mumkin.',
      );
    }
    if (videoCount > 1) {
      throw new BadRequestException(
        'Bir mahsulotga maksimal 1 ta video qo‘shish mumkin.',
      );
    }
    if (media.length > 6) {
      throw new BadRequestException(
        'Bir mahsulotga maksimal 6 ta media qo‘shish mumkin.',
      );
    }
    const fileIds = media.map((item) => item.fileId.trim());
    if (new Set(fileIds).size !== fileIds.length) {
      throw new BadRequestException(
        'Bir xil fileId bir requestda takrorlanmasligi kerak.',
      );
    }
    for (const type of [ProductMediaType.IMAGE, ProductMediaType.VIDEO]) {
      const positions = media
        .filter((item) => item.type === type)
        .map((item) => item.position)
        .sort((a, b) => a - b);
      if (positions.some((position, index) => position !== index)) {
        throw new BadRequestException(
          'Media position qiymatlari 0 dan ketma-ket bo‘lishi kerak.',
        );
      }
    }
  }

  private assertExclusiveInputs(
    image: CreateProductDto['image'],
    media: CreateProductDto['media'],
  ): void {
    if (image && media?.length) {
      throw new BadRequestException(
        '`image` va `media` bir requestda birga yuborilmasligi kerak.',
      );
    }
  }

  private async verifyNewMedia(
    media: ProductMediaDto[],
  ): Promise<ProductMediaData[]> {
    const verified = await Promise.all(
      media.map((item) => this.getMediaService().verifyProductMedia(item)),
    );
    return this.toMediaData(media, verified);
  }

  private async resolveUpdatedMedia(
    requested: ProductMediaDto[],
    existing: ProductRecord['media'],
  ): Promise<ProductMediaData[]> {
    const existingByFileId = new Map(
      existing.map((item) => [item.fileId, item]),
    );
    const resolved = await Promise.all(
      requested.map(async (item): Promise<ProductMediaData> => {
        const stored = existingByFileId.get(item.fileId);
        if (stored) {
          if (stored.type !== item.type || (item.id && item.id !== stored.id)) {
            throw new BadRequestException(
              'Existing media identifikatori yoki turi mos emas.',
            );
          }
          return {
            type: stored.type,
            fileId: stored.fileId,
            url: stored.url,
            position: item.position,
            mimeType: stored.mimeType,
            width: stored.width,
            height: stored.height,
          };
        }
        const verified = await this.getMediaService().verifyProductMedia(item);
        return this.mediaData(item, verified);
      }),
    );
    return this.sortMedia(resolved);
  }

  private toMediaData(
    requested: ProductMediaDto[],
    verified: VerifiedMediaAsset[],
  ): ProductMediaData[] {
    return this.sortMedia(
      requested.map((item, index) => this.mediaData(item, verified[index])),
    );
  }

  private mediaData(
    item: ProductMediaDto,
    verified: VerifiedMediaAsset,
  ): ProductMediaData {
    return {
      type: verified.type,
      fileId: verified.fileId,
      url: verified.url,
      position: item.position,
      mimeType: verified.mime,
      width: verified.width,
      height: verified.height,
    };
  }

  private sortMedia<T extends { type: ProductMediaType; position: number }>(
    media: T[],
  ): T[] {
    return [...media].sort((a, b) =>
      a.type === b.type
        ? a.position - b.position
        : a.type === ProductMediaType.IMAGE
          ? -1
          : 1,
    );
  }

  private sameMediaSet(
    existing: ProductRecord['media'],
    requested: ProductMediaData[],
  ): boolean {
    const oldSet = this.sortMedia(existing).map(
      (item) => `${item.type}:${item.fileId}:${item.position}:${item.url}`,
    );
    const newSet = this.sortMedia(requested).map(
      (item) => `${item.type}:${item.fileId}:${item.position}:${item.url}`,
    );
    return (
      oldSet.length === newSet.length &&
      oldSet.every((value, index) => value === newSet[index])
    );
  }

  private hasMedia(product: {
    media?: unknown[];
    imageUrl: string | null;
  }): boolean {
    return Boolean(product.media?.length || product.imageUrl);
  }

  private publicMedia(product: PublicProductRecord | ProductRecord) {
    if (product.media?.length) {
      return this.sortMedia(product.media).map((item) => ({
        id: item.id,
        type: item.type,
        url: item.url,
        position: item.position,
        width: item.width,
        height: item.height,
        ...(item.type === ProductMediaType.IMAGE ? { variants: imageVariants(item.url) } : {}),
      }));
    }
    return product.imageUrl
      ? [
          {
            id: null,
            type: ProductMediaType.IMAGE,
            url: product.imageUrl,
            position: 0,
            variants: imageVariants(product.imageUrl),
          },
        ]
      : [];
  }

  private toCardResponse(product: PublicProductCard) {
    const variants = imageVariants(product.media?.[0]?.url ?? product.imageUrl);
    return {
      id: product.id,
      name: product.name,
      price: product.price.toFixed(2),
      ...(product.availabilityStatus === ProductAvailabilityStatus.ARRIVING_IN_14_DAYS
        ? { cargoPrice: product.cargoPrice?.toFixed(2) ?? null } : {}),
      imageUrl: variants?.card ?? null,
      imageVariants: variants,
      categoryId: product.categoryId,
      category: product.category,
      availabilityStatus: product.availabilityStatus,
    };
  }

  private toPublicResponse(product: PublicProductRecord | ProductRecord) {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price.toFixed(2),
      ...(product.availabilityStatus ===
      ProductAvailabilityStatus.ARRIVING_IN_14_DAYS
        ? { cargoPrice: product.cargoPrice?.toFixed(2) ?? null }
        : {}),
      imageUrl: product.imageUrl,
      imageVariants: imageVariants(product.media?.find((item) => item.type === ProductMediaType.IMAGE)?.url ?? product.imageUrl),
      media: this.publicMedia(product),
      categoryId: product.categoryId,
      category: product.category,
      availabilityStatus: product.availabilityStatus,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private toAdminResponse(product: ProductRecord) {
    const media = product.media?.length
      ? this.sortMedia(product.media).map((item) => ({
          id: item.id,
          type: item.type,
          fileId: item.fileId,
          url: item.url,
          position: item.position,
          mimeType: item.mimeType,
          width: item.width,
          height: item.height,
        }))
      : product.imageUrl
        ? [
            {
              id: null,
              type: ProductMediaType.IMAGE,
              fileId: product.imageFileId,
              url: product.imageUrl,
              position: 0,
              mimeType: null,
              width: null,
              height: null,
            },
          ]
        : [];
    return {
      ...this.toPublicResponse(product),
      media,
      imageFileId: product.imageFileId,
      telegramChannelMessageId: product.telegramChannelMessageId,
      telegramButtonMessageId: product.telegramButtonMessageId,
      telegramMessageIds: (product.telegramMessages ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((item) => item.messageId),
      telegramSyncStatus: product.telegramSyncStatus,
      telegramPublishedAt: product.telegramPublishedAt,
      telegramSyncedAt: product.telegramSyncedAt,
    };
  }

  private auditTelegramSync(
    actorUserId: string | undefined,
    entityId: string,
    telegramSyncResult: Record<string, unknown>,
  ) {
    if (!actorUserId) return Promise.resolve();
    return (
      this.auditService?.log({
        actorUserId,
        action: AuditAction.PRODUCT_UPDATE,
        entityType: AuditEntityType.PRODUCT,
        entityId,
        metadata: { telegramSyncResult },
      }) ?? Promise.resolve()
    );
  }

  private logDelete(
    actorUserId: string,
    entityId: string,
    softDelete: boolean,
  ) {
    return this.auditService?.log({
      actorUserId,
      action: AuditAction.PRODUCT_DELETE,
      entityType: AuditEntityType.PRODUCT,
      entityId,
      metadata: { softDelete },
    });
  }

  private async ensureCategory(id: string): Promise<void> {
    const category = await this.productsRepository.findCategoryById(id);
    if (!category) throw categoryNotFound();
    if (!category.isActive) throw categoryInactive();
  }

  private getMediaService(): MediaService {
    if (!this.mediaService)
      throw new ServiceUnavailableException('Media service unavailable');
    return this.mediaService;
  }

  private async cleanupMedia(fileId: string): Promise<void> {
    try {
      await this.mediaService?.deleteImageIfUnreferenced(fileId);
    } catch {
      this.logger.warn('ImageKit asset cleanup failed after product commit');
    }
  }

  private optionalText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return value.trim() || null;
  }

  private assertCargoPrice(
    status: ProductAvailabilityStatus,
    cargoPrice: number | { toString(): string } | null | undefined,
  ): void {
    if (status === ProductAvailabilityStatus.ARRIVING_IN_14_DAYS) {
      if (cargoPrice === null || cargoPrice === undefined) {
        throw new BadRequestException({
          error: 'CARGO_PRICE_REQUIRED',
          message: '14 kunda keladigan mahsulot uchun kargo narxi majburiy',
        });
      }
    } else if (cargoPrice !== undefined && cargoPrice !== null) {
      throw new BadRequestException({
        error: 'CARGO_PRICE_NOT_ALLOWED',
        message: 'Kargo narxi faqat 14 kunda keladigan mahsulot uchun',
      });
    }
  }

  private paginate<T>(data: T[], total: number, query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}

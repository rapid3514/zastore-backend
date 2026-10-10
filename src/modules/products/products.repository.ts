import { ConflictException, Injectable } from '@nestjs/common';
import type {
  Prisma,
  ProductAvailabilityStatus,
  ProductMediaType,
  TelegramProductSyncStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryProductsDto } from './dto/query-products.dto.js';

const categoryInclude = {
  category: { select: { id: true, name: true, slug: true } },
  media: { orderBy: [{ type: 'asc' }, { position: 'asc' }] },
  telegramMessages: { orderBy: { position: 'asc' } },
} satisfies Prisma.ProductInclude;

const publicProductSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  cargoPrice: true,
  imageUrl: true,
  media: {
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
    select: {
      id: true,
      type: true,
      url: true,
      position: true,
      width: true,
      height: true,
    },
  },
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  availabilityStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

const publicCardSelect = {
  id: true,
  name: true,
  price: true,
  cargoPrice: true,
  imageUrl: true,
  media: {
    where: { type: 'IMAGE' },
    orderBy: { position: 'asc' },
    take: 1,
    select: { url: true },
  },
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  availabilityStatus: true,
} satisfies Prisma.ProductSelect;

export type PublicProductCard = Prisma.ProductGetPayload<{ select: typeof publicCardSelect }>;

type AdminProduct = Prisma.ProductGetPayload<{
  include: typeof categoryInclude;
}>;
export interface ProductData {
  name: string;
  description?: string | null;
  price: number;
  cargoPrice?: number | null;
  imageUrl?: string | null;
  imageFileId?: string | null;
  categoryId: string;
  availabilityStatus?: ProductAvailabilityStatus;
  telegramSyncStatus?: TelegramProductSyncStatus;
}

export interface TelegramSyncData {
  telegramChannelMessageId?: number | null;
  telegramButtonMessageId?: number | null;
  telegramPublishedAt?: Date | null;
  telegramSyncedAt?: Date | null;
  telegramSyncStatus: TelegramProductSyncStatus;
}

export interface ProductMediaData {
  type: ProductMediaType;
  fileId: string;
  url: string;
  position: number;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
}

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCategoryById(id: string) {
    return this.prisma.category.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
  }

  countOrderItems(id: string) {
    return this.prisma.orderItem.count({ where: { productId: id } });
  }

  list(
    query: QueryProductsDto,
    includeInactive: true,
  ): Promise<{ data: AdminProduct[]; total: number }>;
  list(
    query: QueryProductsDto,
    includeInactive: false,
  ): Promise<{ data: PublicProductCard[]; total: number }>;
  async list(query: QueryProductsDto, includeInactive: boolean) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(includeInactive ? {} : { category: { isActive: true } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.availabilityStatus === undefined
        ? {}
        : { availabilityStatus: query.availabilityStatus }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      includeInactive
        ? this.prisma.product.findMany({
            where,
            include: categoryInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
          })
        : this.prisma.product.findMany({
            where,
            select: publicCardSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
      this.prisma.product.count({ where }),
    ]);
    return { data, total };
  }

  findPublicById(id: string) {
    return this.prisma.product.findFirst({
      where: { id, category: { isActive: true } },
      select: publicProductSelect,
    });
  }

  findById(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: categoryInclude,
    });
  }

  create(data: ProductData) {
    return this.prisma.product.create({ data, include: categoryInclude });
  }

  createInTransaction(
    transaction: Prisma.TransactionClient,
    data: ProductData,
  ) {
    return transaction.product.create({ data, include: categoryInclude });
  }

  createWithMedia(data: ProductData, media: ProductMediaData[]) {
    return this.prisma.product.create({
      data: { ...data, media: { create: media } },
      include: categoryInclude,
    });
  }

  createWithMediaInTransaction(
    transaction: Prisma.TransactionClient,
    data: ProductData,
    media: ProductMediaData[],
  ) {
    return transaction.product.create({
      data: { ...data, media: { create: media } },
      include: categoryInclude,
    });
  }

  update(id: string, data: Partial<ProductData>, expectedVersion: number) {
    return this.prisma.product.update({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
      include: categoryInclude,
    });
  }

  updateInTransaction(
    transaction: Prisma.TransactionClient,
    id: string,
    data: Partial<ProductData>,
    expectedVersion: number,
  ) {
    return transaction.product.update({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
      include: categoryInclude,
    });
  }

  replaceMedia(
    id: string,
    data: Partial<ProductData>,
    media: ProductMediaData[],
    expectedVersion: number,
  ) {
    return this.prisma.product.update({
      where: { id, version: expectedVersion },
      data: {
        ...data,
        version: { increment: 1 },
        media: { deleteMany: {}, create: media },
      },
      include: categoryInclude,
    });
  }

  replaceMediaInTransaction(
    transaction: Prisma.TransactionClient,
    id: string,
    data: Partial<ProductData>,
    media: ProductMediaData[],
    expectedVersion: number,
  ) {
    return transaction.product.update({
      where: { id, version: expectedVersion },
      data: {
        ...data,
        version: { increment: 1 },
        media: { deleteMany: {}, create: media },
      },
      include: categoryInclude,
    });
  }

  updateTelegramSync(id: string, data: TelegramSyncData) {
    return this.prisma.product.update({
      where: { id },
      data,
      include: categoryInclude,
    });
  }

  updateTelegramPublication(
    id: string,
    data: TelegramSyncData,
    messageIds: number[],
  ) {
    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
        telegramMessages: {
          deleteMany: {},
          create: messageIds.map((messageId, position) => ({
            messageId,
            position,
          })),
        },
      },
      include: categoryInclude,
    });
  }

  delete(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }

  removeOrDeactivate(id: string, expectedVersion: number) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const product = await transaction.product.findUnique({ where: { id }, include: categoryInclude });
      if (!product) return null;
      if (product.version !== expectedVersion) {
        throw new ConflictException('Mahsulot boshqa so‘rov tomonidan o‘zgartirilgan; qayta yuklab ko‘ring');
      }
      const references = await transaction.orderItem.count({ where: { productId: id } });
      if (references > 0) {
        if (product.availabilityStatus === 'OUT_OF_STOCK') {
          return { product, softDeleted: true };
        }
        const unavailable = await transaction.product.update({
          where: { id, version: expectedVersion },
          data: {
            availabilityStatus: 'OUT_OF_STOCK',
            cargoPrice: null,
            version: { increment: 1 },
          },
          include: categoryInclude,
        });
        return { product: unavailable, softDeleted: true };
      }
      await transaction.product.delete({ where: { id, version: expectedVersion } });
      return { product, softDeleted: false };
    });
  }
}

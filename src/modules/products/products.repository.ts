import { Injectable } from '@nestjs/common';
import type {
  Prisma,
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
  imageUrl: true,
  media: {
    orderBy: [{ type: 'asc' }, { position: 'asc' }],
    select: {
      id: true,
      type: true,
      url: true,
      position: true,
    },
  },
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  isAvailable: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type AdminProduct = Prisma.ProductGetPayload<{
  include: typeof categoryInclude;
}>;
type PublicProduct = Prisma.ProductGetPayload<{
  select: typeof publicProductSelect;
}>;

export interface ProductData {
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  imageFileId?: string | null;
  categoryId: string;
  isAvailable?: boolean;
  isActive?: boolean;
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
  ): Promise<{ data: PublicProduct[]; total: number }>;
  async list(query: QueryProductsDto, includeInactive: boolean) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(includeInactive
        ? query.isActive === undefined
          ? {}
          : { isActive: query.isActive }
        : { isActive: true, category: { isActive: true } }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.isAvailable === undefined
        ? {}
        : { isAvailable: query.isAvailable }),
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
            select: publicProductSelect,
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
      where: { id, isActive: true, category: { isActive: true } },
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

  createWithMedia(data: ProductData, media: ProductMediaData[]) {
    return this.prisma.product.create({
      data: { ...data, media: { create: media } },
      include: categoryInclude,
    });
  }

  update(id: string, data: Partial<ProductData>) {
    return this.prisma.product.update({
      where: { id },
      data,
      include: categoryInclude,
    });
  }

  replaceMedia(
    id: string,
    data: Partial<ProductData>,
    media: ProductMediaData[],
  ) {
    return this.prisma.product.update({
      where: { id },
      data: {
        ...data,
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
}

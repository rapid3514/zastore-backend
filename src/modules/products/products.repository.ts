import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryProductsDto } from './dto/query-products.dto.js';

const categoryInclude = {
  category: { select: { id: true, name: true, slug: true } },
} as const;

export interface ProductData {
  name: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  categoryId: string;
  isAvailable?: boolean;
  isActive?: boolean;
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
      this.prisma.product.findMany({
        where,
        include: categoryInclude,
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
      include: categoryInclude,
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

  update(id: string, data: Partial<ProductData>) {
    return this.prisma.product.update({
      where: { id },
      data,
      include: categoryInclude,
    });
  }

  delete(id: string) {
    return this.prisma.product.delete({ where: { id } });
  }
}

import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  CreateCategoryData,
  UpdateCategoryData,
} from './types/category.types.js';

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPublicCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findAllForAdmin() {
    return this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findActiveById(id: string) {
    return this.prisma.category.findFirst({
      where: { id, isActive: true },
    });
  }

  findById(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.prisma.category.findUnique({ where: { slug } });
  }

  countProducts(id: string) {
    return this.prisma.product.count({ where: { categoryId: id } });
  }

  findDuplicateByNameOrSlug(name: string, slug: string, excludeId?: string) {
    const where: Prisma.CategoryWhereInput = {
      OR: [{ slug }, { name: { equals: name, mode: 'insensitive' } }],
      ...(excludeId ? { id: { not: excludeId } } : {}),
    };
    return this.prisma.category.findFirst({ where });
  }

  create(data: CreateCategoryData) {
    return this.prisma.category.create({ data });
  }

  update(id: string, data: UpdateCategoryData) {
    return this.prisma.category.update({ where: { id }, data });
  }

  setActive(id: string, isActive: boolean) {
    return this.prisma.category.update({
      where: { id },
      data: { isActive },
    });
  }

  delete(id: string) {
    return this.prisma.category.delete({ where: { id } });
  }
}

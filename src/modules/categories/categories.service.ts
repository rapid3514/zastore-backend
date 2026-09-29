import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Category } from '../../generated/prisma/client.js';
import { CategoriesRepository } from './categories.repository.js';
import type { CreateCategoryDto } from './dto/create-category.dto.js';
import type { UpdateCategoryDto } from './dto/update-category.dto.js';
import type {
  AdminCategoryResponseDto,
  PublicCategoryResponseDto,
} from './dto/category-response.dto.js';
import type { UpdateCategoryData } from './types/category.types.js';
import {
  createCategorySlug,
  normalizeCategoryName,
} from './utils/category-slug.util.js';

const duplicateCategory = () =>
  new ConflictException({
    error: 'CATEGORY_ALREADY_EXISTS',
    message: 'Bu nomdagi kategoriya allaqachon mavjud',
  });

const categoryNotFound = () =>
  new NotFoundException({
    error: 'CATEGORY_NOT_FOUND',
    message: 'Kategoriya topilmadi',
  });

const categoryHasProducts = () =>
  new ConflictException({
    error: 'CATEGORY_HAS_PRODUCTS',
    message:
      'Bu kategoriyada mahsulotlar mavjud. Avval mahsulotlarni boshqa kategoriyaga o‘tkazing yoki kategoriyani faolsizlantiring.',
  });

@Injectable()
export class CategoriesService {
  constructor(private readonly categoriesRepository: CategoriesRepository) {}

  async findPublic(): Promise<PublicCategoryResponseDto[]> {
    const categories = await this.categoriesRepository.findPublicCategories();
    return categories.map((category) => this.toPublicResponse(category));
  }

  async findOnePublic(id: string): Promise<PublicCategoryResponseDto> {
    const category = await this.categoriesRepository.findActiveById(id);
    if (!category) throw categoryNotFound();
    return this.toPublicResponse(category);
  }

  async findAllForAdmin(): Promise<AdminCategoryResponseDto[]> {
    const categories = await this.categoriesRepository.findAllForAdmin();
    return categories.map((category) => this.toAdminResponse(category));
  }

  async create(dto: CreateCategoryDto): Promise<AdminCategoryResponseDto> {
    const name = normalizeCategoryName(dto.name);
    const slug = this.slugFromName(name);
    if (
      await this.categoriesRepository.findDuplicateByNameOrSlug(name, slug)
    ) {
      throw duplicateCategory();
    }

    try {
      const category = await this.categoriesRepository.create({
        name,
        slug,
        description: this.optionalText(dto.description),
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
      });
      return this.toAdminResponse(category);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) throw duplicateCategory();
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<AdminCategoryResponseDto> {
    const existing = await this.categoriesRepository.findById(id);
    if (!existing) throw categoryNotFound();

    const data: UpdateCategoryData = {};
    if (dto.name !== undefined) {
      const name = normalizeCategoryName(dto.name);
      const slug = this.slugFromName(name);
      if (
        await this.categoriesRepository.findDuplicateByNameOrSlug(
          name,
          slug,
          id,
        )
      ) {
        throw duplicateCategory();
      }
      data.name = name;
      data.slug = slug;
    }
    if (dto.description !== undefined) {
      data.description = this.optionalText(dto.description);
    }
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    if (!Object.keys(data).length) return this.toAdminResponse(existing);
    try {
      return this.toAdminResponse(
        await this.categoriesRepository.update(id, data),
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) throw duplicateCategory();
      if (this.isPrismaError(error, 'P2025')) throw categoryNotFound();
      throw error;
    }
  }

  activate(id: string): Promise<AdminCategoryResponseDto> {
    return this.setActive(id, true);
  }

  deactivate(id: string): Promise<AdminCategoryResponseDto> {
    return this.setActive(id, false);
  }

  async remove(id: string): Promise<void> {
    if (!(await this.categoriesRepository.findById(id))) {
      throw categoryNotFound();
    }
    if ((await this.categoriesRepository.countProducts(id)) > 0) {
      throw categoryHasProducts();
    }
    try {
      await this.categoriesRepository.delete(id);
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) {
        throw categoryHasProducts();
      }
      if (this.isPrismaError(error, 'P2025')) throw categoryNotFound();
      throw error;
    }
  }

  private async setActive(
    id: string,
    isActive: boolean,
  ): Promise<AdminCategoryResponseDto> {
    const category = await this.categoriesRepository.findById(id);
    if (!category) throw categoryNotFound();
    if (category.isActive === isActive) return this.toAdminResponse(category);
    try {
      return this.toAdminResponse(
        await this.categoriesRepository.setActive(id, isActive),
      );
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) throw categoryNotFound();
      throw error;
    }
  }

  private slugFromName(name: string): string {
    const slug = createCategorySlug(name);
    if (!slug) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Kategoriya nomidan slug yaratib bo‘lmadi',
      });
    }
    return slug;
  }

  private optionalText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return value.trim() || null;
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }

  private toPublicResponse(category: Category): PublicCategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      isActive: category.isActive,
      sortOrder: category.sortOrder,
    };
  }

  private toAdminResponse(category: Category): AdminCategoryResponseDto {
    return {
      ...this.toPublicResponse(category),
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}

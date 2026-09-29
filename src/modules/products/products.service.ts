import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { QueryProductsDto } from './dto/query-products.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import { ProductsRepository, type ProductData } from './products.repository.js';

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

@Injectable()
export class ProductsService {
  constructor(private readonly productsRepository: ProductsRepository) {}

  async findPublic(query: QueryProductsDto) {
    if (query.isActive === false) return this.paginate([], 0, query);
    const { data, total } = await this.productsRepository.list(query, false);
    return this.paginate(
      data.map((product) => this.toResponse(product)),
      total,
      query,
    );
  }

  async findForAdmin(query: QueryProductsDto) {
    const { data, total } = await this.productsRepository.list(query, true);
    return this.paginate(
      data.map((product) => this.toResponse(product)),
      total,
      query,
    );
  }

  async findOnePublic(id: string) {
    const product = await this.productsRepository.findPublicById(id);
    if (!product) throw productNotFound();
    return this.toResponse(product);
  }

  async findOneForAdmin(id: string) {
    const product = await this.productsRepository.findById(id);
    if (!product) throw productNotFound();
    return this.toResponse(product);
  }

  async create(dto: CreateProductDto) {
    await this.ensureCategory(dto.categoryId);
    const data: ProductData = {
      name: dto.name.trim(),
      description: this.optionalText(dto.description),
      price: dto.price,
      imageUrl: dto.imageUrl ?? null,
      categoryId: dto.categoryId,
      isAvailable: dto.isAvailable ?? true,
      isActive: dto.isActive ?? true,
    };
    try {
      return this.toResponse(await this.productsRepository.create(data));
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) throw categoryNotFound();
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.productsRepository.findById(id);
    if (!existing) throw productNotFound();
    if (dto.categoryId !== undefined) {
      await this.ensureCategory(dto.categoryId);
    }
    const data: Partial<ProductData> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) {
      data.description = this.optionalText(dto.description);
    }
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
    if (dto.isAvailable !== undefined) data.isAvailable = dto.isAvailable;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (!Object.keys(data).length) return this.toResponse(existing);

    try {
      return this.toResponse(await this.productsRepository.update(id, data));
    } catch (error) {
      if (this.isPrismaError(error, 'P2003')) throw categoryNotFound();
      if (this.isPrismaError(error, 'P2025')) throw productNotFound();
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const product = await this.productsRepository.findById(id);
    if (!product) throw productNotFound();

    if ((await this.productsRepository.countOrderItems(id)) > 0) {
      if (product.isActive || product.isAvailable) {
        await this.productsRepository.update(id, {
          isActive: false,
          isAvailable: false,
        });
      }
      return;
    }

    try {
      await this.productsRepository.delete(id);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) throw productNotFound();
      throw error;
    }
  }

  private async ensureCategory(id: string): Promise<void> {
    const category = await this.productsRepository.findCategoryById(id);
    if (!category) throw categoryNotFound();
    if (!category.isActive) throw categoryInactive();
  }

  private optionalText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return value.trim() || null;
  }

  private paginate<T>(data: T[], total: number, query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private toResponse(product: ProductRecord) {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price.toFixed(2),
      imageUrl: product.imageUrl,
      categoryId: product.categoryId,
      category: product.category,
      isAvailable: product.isAvailable,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
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

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Category } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoriesService } from './categories.service.js';

const categoryId = '11111111-1111-4111-8111-111111111111';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: categoryId,
    name: 'Burgerlar',
    slug: 'burgerlar',
    description: null,
    imageUrl: null,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    updatedAt: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

describe('CategoriesService', () => {
  const repository = {
    findPublicCategories: vi.fn(),
    findAllForAdmin: vi.fn(),
    findActiveById: vi.fn(),
    findById: vi.fn(),
    findBySlug: vi.fn(),
    countProducts: vi.fn(),
    findDuplicateByNameOrSlug: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    setActive: vi.fn(),
    delete: vi.fn(),
  };
  let service: CategoriesService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.countProducts.mockResolvedValue(0);
    service = new CategoriesService(repository as never);
  });

  it('creates a category successfully', async () => {
    repository.findDuplicateByNameOrSlug.mockResolvedValue(null);
    repository.create.mockResolvedValue(category());

    await expect(
      service.create({ name: 'Burgerlar', sortOrder: 1 }),
    ).resolves.toMatchObject({ name: 'Burgerlar', slug: 'burgerlar' });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Burgerlar',
      slug: 'burgerlar',
      description: null,
      imageUrl: null,
      sortOrder: 1,
    });
  });

  it('rejects a duplicate category with 409', async () => {
    repository.findDuplicateByNameOrSlug.mockResolvedValue(category());
    const promise = service.create({ name: 'BURGERLAR' });
    await expect(promise).rejects.toBeInstanceOf(ConflictException);
    await expect(promise).rejects.toMatchObject({ status: 409 });
  });

  it('generates and normalizes the slug from the name', async () => {
    repository.findDuplicateByNameOrSlug.mockResolvedValue(null);
    repository.create.mockImplementation((data) =>
      Promise.resolve(category({ ...data, id: categoryId })),
    );

    await service.create({ name: '  Issiq   Ichimliklar  ' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Issiq Ichimliklar',
        slug: 'issiq-ichimliklar',
      }),
    );
  });

  it('updates a category', async () => {
    repository.findById.mockResolvedValue(category());
    repository.update.mockResolvedValue(
      category({ description: 'Yangi tavsif', sortOrder: 2 }),
    );

    await expect(
      service.update(categoryId, {
        description: 'Yangi tavsif',
        sortOrder: 2,
      }),
    ).resolves.toMatchObject({ description: 'Yangi tavsif', sortOrder: 2 });
  });

  it('updates the slug when the name changes', async () => {
    repository.findById.mockResolvedValue(category());
    repository.findDuplicateByNameOrSlug.mockResolvedValue(null);
    repository.update.mockResolvedValue(
      category({
        name: 'Burger va Sendvichlar',
        slug: 'burger-va-sendvichlar',
      }),
    );

    await service.update(categoryId, { name: 'Burger va Sendvichlar' });

    expect(repository.update).toHaveBeenCalledWith(
      categoryId,
      expect.objectContaining({
        name: 'Burger va Sendvichlar',
        slug: 'burger-va-sendvichlar',
      }),
    );
  });

  it('rejects a duplicate slug during update', async () => {
    repository.findById.mockResolvedValue(category());
    repository.findDuplicateByNameOrSlug.mockResolvedValue(
      category({ id: '22222222-2222-4222-8222-222222222222' }),
    );

    await expect(
      service.update(categoryId, { name: 'Lavashlar' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 404 when a public category is missing or inactive', async () => {
    repository.findActiveById.mockResolvedValue(null);
    await expect(service.findOnePublic(categoryId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('activates a category', async () => {
    repository.findById.mockResolvedValue(category({ isActive: false }));
    repository.setActive.mockResolvedValue(category({ isActive: true }));
    await expect(service.activate(categoryId)).resolves.toMatchObject({
      isActive: true,
    });
    expect(repository.setActive).toHaveBeenCalledWith(categoryId, true);
  });

  it('deactivates a category', async () => {
    repository.findById.mockResolvedValue(category());
    repository.setActive.mockResolvedValue(category({ isActive: false }));
    await expect(service.deactivate(categoryId)).resolves.toMatchObject({
      isActive: false,
    });
    expect(repository.setActive).toHaveBeenCalledWith(categoryId, false);
  });

  it('returns the public list without metadata', async () => {
    repository.findPublicCategories.mockResolvedValue([category()]);
    const result = await service.findPublic();
    expect(repository.findPublicCategories).toHaveBeenCalledOnce();
    expect(result[0]).not.toHaveProperty('createdAt');
  });

  it('includes inactive categories and metadata in the admin list', async () => {
    repository.findAllForAdmin.mockResolvedValue([
      category({ isActive: false }),
    ]);
    await expect(service.findAllForAdmin()).resolves.toEqual([
      expect.objectContaining({ isActive: false, createdAt: expect.any(Date) }),
    ]);
  });

  it('deletes an existing category', async () => {
    repository.findById.mockResolvedValue(category());
    repository.delete.mockResolvedValue(category());
    await expect(service.remove(categoryId)).resolves.toBeUndefined();
    expect(repository.delete).toHaveBeenCalledWith(categoryId);
  });

  it('maps a future product foreign-key conflict to 409', async () => {
    repository.findById.mockResolvedValue(category());
    repository.delete.mockRejectedValue({ code: 'P2003' });
    await expect(service.remove(categoryId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('checks linked products before attempting category deletion', async () => {
    repository.findById.mockResolvedValue(category());
    repository.countProducts.mockResolvedValue(1);

    await expect(service.remove(categoryId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race to 409', async () => {
    repository.findDuplicateByNameOrSlug.mockResolvedValue(null);
    repository.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create({ name: 'Burgerlar' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

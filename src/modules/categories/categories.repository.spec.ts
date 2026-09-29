import { describe, expect, it, vi } from 'vitest';
import { CategoriesRepository } from './categories.repository.js';

describe('CategoriesRepository', () => {
  it('filters public categories by active status and stable ordering', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new CategoriesRepository({
      category: { findMany },
    } as never);

    await repository.findPublicCategories();

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('does not filter inactive categories from the admin list', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new CategoriesRepository({
      category: { findMany },
    } as never);

    await repository.findAllForAdmin();

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('counts linked products before deletion', async () => {
    const count = vi.fn().mockResolvedValue(2);
    const repository = new CategoriesRepository({
      product: { count },
    } as never);

    await expect(repository.countProducts('category-1')).resolves.toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: { categoryId: 'category-1' },
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ProductsRepository } from './products.repository.js';

describe('ProductsRepository.list', () => {
  it('filters public products by active product and category while keeping unavailable items', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new ProductsRepository({
      product: { findMany, count },
    } as never);

    await repository.list(
      {
        page: 2,
        limit: 10,
        categoryId: '11111111-1111-4111-8111-111111111111',
        search: 'burger',
      },
      false,
    );

    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      isActive: true,
      category: { isActive: true },
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(args.where).not.toHaveProperty('isAvailable');
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'burger', mode: 'insensitive' } },
      ]),
    );
    expect(args).toMatchObject({ skip: 10, take: 10 });
    expect(count).toHaveBeenCalledWith({ where: args.where });
  });

  it('lets management filter inactive or unavailable products', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new ProductsRepository({
      product: { findMany, count },
    } as never);

    await repository.list({ isActive: false, isAvailable: false }, true);

    expect(findMany.mock.calls[0][0].where).toEqual({
      isActive: false,
      isAvailable: false,
    });
  });

  it('counts historical order references before deletion', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const repository = new ProductsRepository({
      orderItem: { count },
    } as never);

    await expect(repository.countOrderItems('product-1')).resolves.toBe(1);
    expect(count).toHaveBeenCalledWith({
      where: { productId: 'product-1' },
    });
  });
});

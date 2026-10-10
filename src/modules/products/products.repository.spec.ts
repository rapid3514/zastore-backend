import { describe, expect, it, vi } from 'vitest';
import { ProductAvailabilityStatus } from '../../generated/prisma/client.js';
import { ProductsRepository } from './products.repository.js';

describe('ProductsRepository.list', () => {
  it.each([0, 1])('serializes product removal with order references (%i existing)', async (references) => {
    const product = { id: '11111111-1111-4111-8111-111111111111', version: 0, availabilityStatus: ProductAvailabilityStatus.IN_STOCK };
    const transactionClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: product.id }]),
      product: {
        findUnique: vi.fn().mockResolvedValue(product),
        update: vi.fn().mockResolvedValue({ ...product, availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK }),
        delete: vi.fn().mockResolvedValue(product),
      },
      orderItem: { count: vi.fn().mockResolvedValue(references) },
    };
    const repository = new ProductsRepository({
      $transaction: vi.fn((callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
    } as never);
    const result = await repository.removeOrDeactivate(product.id, 0);
    expect(transactionClient.$queryRaw).toHaveBeenCalledOnce();
    expect(transactionClient.orderItem.count).toHaveBeenCalledWith({ where: { productId: product.id } });
    expect(result?.softDeleted).toBe(references > 0);
    if (references) {
      expect(transactionClient.product.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: product.id, version: 0 } }));
      expect(transactionClient.product.delete).not.toHaveBeenCalled();
    } else {
      expect(transactionClient.product.delete).toHaveBeenCalledWith({ where: { id: product.id, version: 0 } });
    }
  });
  it('increments an exact product version on update', async () => {
    const update = vi.fn().mockResolvedValue({});
    const repository = new ProductsRepository({ product: { update } } as never);
    await repository.update('product-1', { price: 100 }, 7);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'product-1', version: 7 },
      data: { price: 100, version: { increment: 1 } },
    }));
  });
  it('filters public products by active category while keeping unavailable items', async () => {
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
      category: { isActive: true },
      categoryId: '11111111-1111-4111-8111-111111111111',
    });
    expect(args.where).not.toHaveProperty('availabilityStatus');
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { name: { contains: 'burger', mode: 'insensitive' } },
      ]),
    );
    expect(args).toMatchObject({ skip: 10, take: 10 });
    expect(args.select.media.select).toEqual({
      url: true,
    });
    expect(args.select.media.take).toBe(1);
    expect(args.select).not.toHaveProperty('description');
    expect(args.select.media.select).not.toHaveProperty('fileId');
    expect(count).toHaveBeenCalledWith({ where: args.where });
  });

  it('lets management filter unavailable products', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new ProductsRepository({
      product: { findMany, count },
    } as never);

    await repository.list(
      {
        availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
      },
      true,
    );

    expect(findMany.mock.calls[0][0].where).toEqual({
      availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK,
    });
    expect(findMany.mock.calls[0][0].include).toHaveProperty('media');
    expect(findMany.mock.calls[0][0].include).toHaveProperty(
      'telegramMessages',
    );
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

  it('creates and replaces media with atomic nested writes', async () => {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const repository = new ProductsRepository({
      product: { create, update },
    } as never);
    const data = {
      name: 'Product',
      price: 100,
      categoryId: '11111111-1111-4111-8111-111111111111',
    };
    const media = [
      {
        type: 'IMAGE' as const,
        fileId: 'file-1',
        url: 'https://ik.imagekit.io/account/products/one.jpg',
        position: 0,
      },
    ];

    await repository.createWithMedia(data, media);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ media: { create: media } }),
      }),
    );

    await repository.replaceMedia('product-1', { name: 'Updated' }, media, 0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'product-1', version: 0 },
        data: {
          name: 'Updated',
          media: { deleteMany: {}, create: media },
          version: { increment: 1 },
        },
      }),
    );
  });
});

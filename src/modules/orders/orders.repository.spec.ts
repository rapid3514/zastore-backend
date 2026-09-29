import { describe, expect, it, vi } from 'vitest';
import { OrdersRepository } from './orders.repository.js';

describe('OrdersRepository', () => {
  it('builds user-specific queries with pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(3);
    const repository = new OrdersRepository({
      order: { findMany, count },
      product: { findMany: vi.fn() },
      $transaction: vi.fn(),
    } as never);

    await repository.findUserOrders('user-1', {
      page: 2,
      limit: 10,
      status: 'CONFIRMED' as never,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'CONFIRMED' },
        skip: 10,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'CONFIRMED' },
    });
  });

  it('filters management orders by customer and creation date', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new OrdersRepository({
      order: { findMany, count },
    } as never);

    await repository.findManageOrders({
      customerId: '11111111-1111-4111-8111-111111111111',
      createdFrom: '2026-09-01T00:00:00.000Z',
      createdTo: '2026-09-30T23:59:59.999Z',
    });

    expect(findMany.mock.calls[0][0].where).toMatchObject({
      userId: '11111111-1111-4111-8111-111111111111',
      createdAt: {
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lte: new Date('2026-09-30T23:59:59.999Z'),
      },
    });
  });

  it('aggregates order and catalog data for the management summary', async () => {
    const prisma = {
      order: {
        count: vi.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(4),
        groupBy: vi.fn().mockResolvedValue([
          { status: 'COMPLETED', _count: { _all: 3 } },
          { status: 'PENDING_CONFIRMATION', _count: { _all: 2 } },
        ]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { total: '450000.00' } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      product: {
        count: vi
          .fn()
          .mockResolvedValueOnce(12)
          .mockResolvedValueOnce(10)
          .mockResolvedValueOnce(8),
      },
      category: {
        count: vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(4),
      },
      user: {
        count: vi.fn().mockResolvedValue(4),
      },
    };
    const repository = new OrdersRepository(prisma as never);

    const summary = await repository.getManageSummary();

    expect(summary).toEqual(
      expect.objectContaining({
        totalOrders: 9,
        customersWithOrders: 4,
        productsTotal: 12,
        productsActive: 10,
        productsAvailable: 8,
        categoriesTotal: 5,
        categoriesActive: 4,
        recentOrders: [],
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { orders: { some: {} } },
    });
  });
});

import { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { OrdersRepository } from './orders.repository.js';

describe('OrdersRepository', () => {
  it('does not pass an out-of-range Telegram ID to PostgreSQL', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new OrdersRepository({ order: { findMany, count } } as never);
    await repository.findManageOrders({ search: '9'.repeat(100) });
    const where = findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('telegramId');
  });
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

  it('creates orders and nested items inside a transaction and propagates rollback errors', async () => {
    const transactionError = new Error('item creation failed');
    const create = vi.fn().mockRejectedValue(transactionError);
    const transaction = vi.fn(async (callback) =>
      callback({
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: '22222222-2222-4222-8222-222222222222',
              isActive: true,
              categoryActive: true,
              availabilityStatus: 'IN_STOCK',
            },
          ]),
        order: { create, findUnique: vi.fn().mockResolvedValue(null) },
        product: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              {
                id: '22222222-2222-4222-8222-222222222222',
                price: new Prisma.Decimal('10.00'),
              },
            ]),
        },
      }),
    );
    const repository = new OrdersRepository({
      $transaction: transaction,
    } as never);

    await expect(
      repository.createOrder({
        userId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
        requestHash: 'a'.repeat(64),
        status: OrderStatus.PENDING_CONFIRMATION,
        phone: null,
        deliveryAddress: null,
        btcPostBranchNumber: null,
        latitude: null,
        longitude: null,
        note: null,
        subtotal: new Prisma.Decimal('10.00'),
        total: new Prisma.Decimal('10.00'),
        confirmationDeadline: new Date('2026-09-29T16:00:00.000Z'),
        items: [
          {
            productId: '22222222-2222-4222-8222-222222222222',
            productName: 'Burger',
            unitPrice: new Prisma.Decimal('10.00'),
            quantity: 1,
            lineTotal: new Prisma.Decimal('10.00'),
          },
        ],
      }),
    ).rejects.toBe(transactionError);
    expect(transaction).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { createMany: { data: [expect.any(Object)] } },
        }),
      }),
    );
  });

  it('updates status only when the persisted status still matches', async () => {
    const update = vi
      .fn()
      .mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.CONFIRMED,
        user: { telegramId: 123n },
      });
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'product-1',
            isActive: true,
            categoryActive: true,
            availabilityStatus: 'IN_STOCK',
          },
        ]),
      order: { update },
      orderItem: {
        findMany: vi.fn().mockResolvedValue([{ productId: 'product-1' }]),
      },
      notificationOutbox: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new OrdersRepository({
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as never);

    await repository.updateStatus('order-1', OrderStatus.PENDING_CONFIRMATION, {
      status: OrderStatus.CONFIRMED,
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'order-1',
          status: OrderStatus.PENDING_CONFIRMATION,
          confirmationDeadline: { gt: expect.any(Date) },
        },
      }),
    );
  });
});

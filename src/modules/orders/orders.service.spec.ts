import { BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductAvailabilityStatus,
} from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const secondProductId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

const order = (overrides: Record<string, unknown> = {}) => ({
  id: orderId,
  status: OrderStatus.PENDING_CONFIRMATION,
  user: {
    id: userId,
    firstName: 'Ali',
    lastName: null,
    username: null,
    phone: '+998901234567',
    telegramId: 123n,
  },
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      productId,
      productName: 'Burger',
      unitPrice: new Prisma.Decimal('12.50'),
      quantity: 2,
      lineTotal: new Prisma.Decimal('25.00'),
    },
  ],
  subtotal: new Prisma.Decimal('25.00'),
  total: new Prisma.Decimal('25.00'),
  phone: '+998901234567',
  deliveryAddress: null,
  latitude: null,
  longitude: null,
  note: null,
  confirmationDeadline: new Date('2099-01-01T00:00:00.000Z'),
  confirmedAt: null,
  cancelledAt: null,
  completedAt: null,
  expiredAt: null,
  cancelReason: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const product = (overrides: Record<string, unknown> = {}) => ({
  id: productId,
  name: 'Burger',
  price: new Prisma.Decimal('12.50'),
  isActive: true,
  availabilityStatus: ProductAvailabilityStatus.IN_STOCK,
  category: { isActive: true },
  ...overrides,
});

describe('OrdersService', () => {
  const repository = {
    findById: vi.fn(),
    findByIdempotencyKey: vi.fn(),
    findUserOrderById: vi.fn(),
    findUserOrders: vi.fn(),
    findManageOrders: vi.fn(),
    getManageSummary: vi.fn(),
    findProductsForOrder: vi.fn(),
    createOrder: vi.fn(),
    updateStatus: vi.fn(),
    expirePendingOrders: vi.fn(),
  };
  const usersService = { findById: vi.fn() };
  const workHoursService = {
    calculateBusinessDeadline: vi.fn(),
    isOpenAt: vi.fn(),
    getNextOpenAt: vi.fn(),
  };
  const auditService = { log: vi.fn() };
  let service: OrdersService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findByIdempotencyKey.mockResolvedValue(null);
    service = new OrdersService(
      repository as never,
      usersService as never,
      workHoursService as never,
      auditService as never,
    );
  });

  it.each([
    0,
    -1,
    1001,
    2147483648,
    Number.MAX_SAFE_INTEGER,
    Infinity,
    NaN,
    1.5,
  ])(
    'rejects invalid quantity %s before any DB product lookup',
    async (quantity) => {
      usersService.findById.mockResolvedValue({ id: userId, isBlocked: false });
      await expect(
        service.createOrder(
          { sub: userId },
          { items: [{ productId, quantity }] },
          idempotencyKey,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(repository.findProductsForOrder).not.toHaveBeenCalled();
      expect(repository.createOrder).not.toHaveBeenCalled();
    },
  );

  it('revalidates aggregate duplicate quantities and maximum item count', async () => {
    usersService.findById.mockResolvedValue({ id: userId, isBlocked: false });
    await expect(
      service.createOrder(
        { sub: userId },
        {
          items: [
            { productId, quantity: 600 },
            { productId, quantity: 600 },
          ],
        },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ response: { error: 'INVALID_ORDER_QUANTITY' } });
    await expect(
      service.createOrder(
        { sub: userId },
        {
          items: Array.from({ length: 101 }, () => ({
            productId,
            quantity: 1,
          })),
        },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ response: { error: 'INVALID_ORDER_ITEMS' } });
  });

  it('rejects Decimal line/total overflow as 400 before persisting', async () => {
    usersService.findById.mockResolvedValue({ id: userId, isBlocked: false });
    repository.findProductsForOrder.mockResolvedValue([
      product({ price: new Prisma.Decimal('99999999.99') }),
    ]);
    await expect(
      service.createOrder(
        { sub: userId },
        { items: [{ productId, quantity: 2 }] },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'ORDER_TOTAL_LIMIT' },
    });
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('returns an idempotent retry before rechecking changed catalog/work hours and rejects key payload conflicts', async () => {
    usersService.findById.mockResolvedValue({ id: userId, isBlocked: false });
    repository.findProductsForOrder.mockResolvedValue([product()]);
    workHoursService.calculateBusinessDeadline.mockResolvedValue(
      new Date('2099-01-01'),
    );
    repository.createOrder.mockResolvedValue(order());
    const dto = { items: [{ productId, quantity: 1 }] };
    await service.createOrder({ sub: userId }, dto, idempotencyKey);
    const requestHash = repository.createOrder.mock.calls[0][0]
      .requestHash as string;
    repository.findByIdempotencyKey.mockResolvedValue(order({ requestHash }));
    repository.findProductsForOrder.mockClear();
    workHoursService.calculateBusinessDeadline.mockClear();
    await expect(
      service.createOrder({ sub: userId }, dto, idempotencyKey),
    ).resolves.toMatchObject({ id: orderId });
    expect(repository.findProductsForOrder).not.toHaveBeenCalled();
    expect(workHoursService.calculateBusinessDeadline).not.toHaveBeenCalled();
    await expect(
      service.createOrder(
        { sub: userId },
        { items: [{ productId, quantity: 2 }] },
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(repository.createOrder).toHaveBeenCalledOnce();
  });

  it('merges duplicate items and calculates trusted totals from DB prices', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      phone: '+998901234567',
      isBlocked: false,
    });
    repository.findProductsForOrder.mockResolvedValue([product()]);
    workHoursService.calculateBusinessDeadline.mockResolvedValue(
      new Date('2026-09-29T13:00:00.000Z'),
    );
    repository.createOrder.mockResolvedValue(
      order({
        items: [
          {
            ...order().items[0],
            quantity: 3,
            lineTotal: new Prisma.Decimal('37.50'),
          },
        ],
        subtotal: new Prisma.Decimal('37.50'),
        total: new Prisma.Decimal('37.50'),
      }),
    );

    await service.createOrder(
      { sub: userId },
      {
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      },
      idempotencyKey,
    );

    expect(repository.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        status: OrderStatus.PENDING_CONFIRMATION,
        subtotal: new Prisma.Decimal('37.50'),
        total: new Prisma.Decimal('37.50'),
        items: [
          expect.objectContaining({
            productId,
            quantity: 3,
            unitPrice: new Prisma.Decimal('12.50'),
            lineTotal: new Prisma.Decimal('37.50'),
          }),
        ],
      }),
    );
    expect(workHoursService.calculateBusinessDeadline).toHaveBeenCalledWith(
      expect.any(Date),
      240,
    );
  });

  it('returns the created order without waiting for Telegram delivery', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      phone: '+998901234567',
      isBlocked: false,
    });
    repository.findProductsForOrder.mockResolvedValue([product()]);
    workHoursService.calculateBusinessDeadline.mockResolvedValue(
      new Date('2026-09-29T13:00:00.000Z'),
    );
    repository.createOrder.mockResolvedValue(order());

    await expect(
      service.createOrder(
        { sub: userId },
        { items: [{ productId, quantity: 2 }] },
        idempotencyKey,
      ),
    ).resolves.toMatchObject({ id: orderId });
    expect(repository.createOrder).toHaveBeenCalledOnce();
  });

  it('calculates a multi-product total from database prices and snapshots them', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      phone: '+998901234567',
      isBlocked: false,
    });
    repository.findProductsForOrder.mockResolvedValue([
      product({ price: new Prisma.Decimal('100000.00') }),
      product({
        id: secondProductId,
        name: 'Drink',
        price: new Prisma.Decimal('50000.00'),
      }),
    ]);
    workHoursService.calculateBusinessDeadline.mockResolvedValue(
      new Date('2026-09-29T13:00:00.000Z'),
    );
    repository.createOrder.mockResolvedValue(
      order({
        subtotal: new Prisma.Decimal('350000.00'),
        total: new Prisma.Decimal('350000.00'),
      }),
    );

    const response = await service.createOrder(
      { sub: userId },
      {
        items: [
          { productId, quantity: 2 },
          { productId: secondProductId, quantity: 3 },
        ],
      },
      idempotencyKey,
    );

    expect(response.total).toBe('350000.00');
    expect(repository.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        total: new Prisma.Decimal('350000.00'),
        items: expect.arrayContaining([
          expect.objectContaining({
            productId,
            unitPrice: new Prisma.Decimal('100000.00'),
            lineTotal: new Prisma.Decimal('200000.00'),
          }),
          expect.objectContaining({
            productId: secondProductId,
            unitPrice: new Prisma.Decimal('50000.00'),
            lineTotal: new Prisma.Decimal('150000.00'),
          }),
        ]),
      }),
    );
  });

  it('expires an overdue order instead of confirming it', async () => {
    repository.findById.mockResolvedValue(
      order({ confirmationDeadline: new Date('2000-01-01T00:00:00.000Z') }),
    );
    repository.updateStatus.mockResolvedValue(order());

    await expect(service.confirmOrder(orderId)).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'ORDER_CONFIRMATION_EXPIRED',
      }),
    });
    expect(repository.updateStatus).toHaveBeenCalledWith(
      orderId,
      OrderStatus.PENDING_CONFIRMATION,
      expect.objectContaining({ status: OrderStatus.EXPIRED }),
    );
  });

  it('does not confirm an order whose product became unavailable', async () => {
    repository.findById.mockResolvedValue(order());
    repository.findProductsForOrder.mockResolvedValue([
      product({ availabilityStatus: ProductAvailabilityStatus.OUT_OF_STOCK }),
    ]);

    await expect(service.confirmOrder(orderId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('confirms an available order during working hours', async () => {
    repository.findById.mockResolvedValue(order());
    repository.findProductsForOrder.mockResolvedValue([product()]);
    workHoursService.isOpenAt.mockResolvedValue(true);
    repository.updateStatus.mockResolvedValue(
      order({
        status: OrderStatus.CONFIRMED,
        confirmedAt: new Date(),
      }),
    );

    await expect(service.confirmOrder(orderId, userId)).resolves.toMatchObject({
      id: orderId,
      status: OrderStatus.CONFIRMED,
    });
    expect(repository.updateStatus).toHaveBeenCalledWith(
      orderId,
      OrderStatus.PENDING_CONFIRMATION,
      expect.objectContaining({ status: OrderStatus.CONFIRMED }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: userId,
        entityId: orderId,
      }),
    );
  });

  it('allows ordering a product that arrives in 14 days', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      phone: '+998901234567',
      isBlocked: false,
    });
    repository.findProductsForOrder.mockResolvedValue([
      product({
        availabilityStatus: ProductAvailabilityStatus.ARRIVING_IN_14_DAYS,
      }),
    ]);
    repository.createOrder.mockResolvedValue(order());
    workHoursService.calculateBusinessDeadline.mockResolvedValue(
      new Date('2026-10-08T12:00:00.000Z'),
    );

    await expect(
      service.createOrder(
        { sub: userId },
        { items: [{ productId, quantity: 1 }] },
        idempotencyKey,
      ),
    ).resolves.toMatchObject({ id: orderId });
  });

  it('rejects only pending orders by mapping rejection to CANCELLED', async () => {
    repository.findById.mockResolvedValue(order());
    repository.updateStatus.mockResolvedValue(
      order({ status: OrderStatus.CANCELLED }),
    );

    await service.rejectOrder(orderId, 'Mahsulot qolmagan');

    expect(repository.updateStatus).toHaveBeenCalledWith(
      orderId,
      OrderStatus.PENDING_CONFIRMATION,
      expect.objectContaining({
        status: OrderStatus.CANCELLED,
        cancelReason: 'Mahsulot qolmagan',
      }),
      true,
    );
  });

  it.each([
    [OrderStatus.CONFIRMED, OrderStatus.PROCESSING],
    [OrderStatus.PROCESSING, OrderStatus.COMPLETED],
  ])('allows %s -> %s', async (currentStatus, nextStatus) => {
    repository.findById.mockResolvedValue(order({ status: currentStatus }));
    repository.updateStatus.mockResolvedValue(order({ status: nextStatus }));

    await expect(
      service.updateOrderStatus(orderId, nextStatus, userId),
    ).resolves.toMatchObject({ status: nextStatus });
  });

  it.each([
    [OrderStatus.COMPLETED, OrderStatus.PROCESSING],
    [OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
  ])('rejects %s -> %s', async (currentStatus, nextStatus) => {
    repository.findById.mockResolvedValue(order({ status: currentStatus }));

    await expect(
      service.updateOrderStatus(orderId, nextStatus),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'INVALID_ORDER_STATUS_TRANSITION',
      }),
    });
  });

  it('prevents cancellation of another customer order or a completed order', async () => {
    repository.findUserOrderById.mockResolvedValueOnce(null);
    await expect(
      service.cancelMyOrder({ sub: 'another-user' }, orderId),
    ).rejects.toMatchObject({ status: 404 });

    repository.findUserOrderById.mockResolvedValueOnce(
      order({ status: OrderStatus.COMPLETED }),
    );
    await expect(
      service.cancelMyOrder({ sub: userId }, orderId),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ORDER_CANNOT_BE_CANCELLED' }),
    });
  });

  it('rejects an inverted date range', async () => {
    await expect(
      service.getManageOrders({
        createdFrom: '2026-09-30T00:00:00.000Z',
        createdTo: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.findManageOrders).not.toHaveBeenCalled();
  });

  it.each([
    [{ imageUrl: 'https://images.example/legacy.jpg', media: [{ url: 'https://images.example/first.jpg' }] }, 'https://images.example/first.jpg'],
    [{ imageUrl: 'https://images.example/legacy.jpg', media: [] }, 'https://images.example/legacy.jpg'],
    [{ imageUrl: null, media: [] }, null],
    [null, null],
  ])('includes the product thumbnail with a fallback for missing or deleted products', async (product, imageUrl) => {
    const fixture = order();
    repository.findManageOrders.mockResolvedValueOnce({
      data: [{ ...fixture, items: fixture.items.map((item) => ({ ...item, product })) }],
      total: 1,
    });
    const response = await service.getManageOrders({});
    expect(response.data[0].items[0]).toMatchObject({ productName: 'Burger', imageUrl });
  });

  it('scopes customer detail lookup to the authenticated owner', async () => {
    repository.findUserOrderById.mockResolvedValueOnce(order());
    await expect(
      service.getMyOrder({ sub: userId }, orderId),
    ).resolves.toMatchObject({ id: orderId });
    expect(repository.findUserOrderById).toHaveBeenCalledWith(userId, orderId);

    repository.findUserOrderById.mockResolvedValueOnce(null);
    await expect(
      service.getMyOrder({ sub: 'another-user' }, orderId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects invalid and concurrently changed status transitions', async () => {
    repository.findById.mockResolvedValueOnce(
      order({ status: OrderStatus.CONFIRMED }),
    );
    await expect(
      service.updateOrderStatus(orderId, OrderStatus.COMPLETED),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: 'INVALID_ORDER_STATUS_TRANSITION',
      }),
    });
    expect(repository.updateStatus).not.toHaveBeenCalled();

    repository.findById.mockResolvedValueOnce(order());
    repository.updateStatus.mockRejectedValueOnce({ code: 'P2025' });
    await expect(
      service.updateOrderStatus(orderId, OrderStatus.CANCELLED),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ORDER_STATUS_CHANGED' }),
    });
  });
});

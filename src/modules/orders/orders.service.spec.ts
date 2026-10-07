import { BadRequestException } from '@nestjs/common';
import { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const productId = '33333333-3333-4333-8333-333333333333';
const secondProductId = '55555555-5555-4555-8555-555555555555';

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
  isAvailable: true,
  category: { isActive: true },
  ...overrides,
});

describe('OrdersService', () => {
  const repository = {
    findById: vi.fn(),
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
  const notificationsService = {
    notifyNewOrder: vi.fn(),
    notifyOrderConfirmed: vi.fn(),
    notifyOrderRejected: vi.fn(),
    notifyOrderStatusChanged: vi.fn(),
  };
  let service: OrdersService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrdersService(
      repository as never,
      usersService as never,
      workHoursService as never,
      auditService as never,
      notificationsService as never,
    );
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
    expect(notificationsService.notifyNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: orderId }),
    );
  });

  it('keeps the created order when notification delivery fails', async () => {
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
    notificationsService.notifyNewOrder.mockRejectedValue(
      new Error('Telegram unavailable'),
    );

    await expect(
      service.createOrder(
        { sub: userId },
        { items: [{ productId, quantity: 2 }] },
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
      product({ isAvailable: false }),
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
    expect(notificationsService.notifyOrderConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.CONFIRMED }),
    );
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
    );
    expect(notificationsService.notifyOrderRejected).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.CANCELLED }),
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
    expect(notificationsService.notifyOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: nextStatus }),
    );
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

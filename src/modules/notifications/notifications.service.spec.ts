import { Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

const order = {
  id: '22222222-2222-4222-8222-222222222222',
  status: OrderStatus.PENDING_CONFIRMATION,
  total: new Prisma.Decimal('25.00'),
  createdAt: new Date('2026-10-02T12:00:00.000Z'),
  user: { telegramId: 100n, firstName: 'Ali', lastName: null },
};

describe('NotificationsService', () => {
  const repository = { findNotificationAdmins: vi.fn() };
  const telegram = {
    sendNewOrderNotification: vi.fn(),
    sendOrderStatusNotification: vi.fn(),
    sendOrderRejectedNotification: vi.fn(),
  };
  let service: NotificationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findNotificationAdmins.mockResolvedValue([
      { telegramId: 200n },
      { telegramId: 300n },
    ]);
    telegram.sendNewOrderNotification.mockResolvedValue(undefined);
    telegram.sendOrderStatusNotification.mockResolvedValue(undefined);
    telegram.sendOrderRejectedNotification.mockResolvedValue(undefined);
    service = new NotificationsService(repository as never, telegram as never);
  });

  it('notifies every eligible admin about a new order', async () => {
    await service.notifyNewOrder(order);

    expect(telegram.sendNewOrderNotification).toHaveBeenCalledTimes(2);
    expect(telegram.sendNewOrderNotification).toHaveBeenCalledWith(
      '200',
      order,
    );
    expect(telegram.sendNewOrderNotification).toHaveBeenCalledWith(
      '300',
      order,
    );
  });

  it('notifies the customer when an order is confirmed', async () => {
    await service.notifyOrderConfirmed({
      ...order,
      status: OrderStatus.CONFIRMED,
    });

    expect(telegram.sendOrderStatusNotification).toHaveBeenCalledWith(
      '100',
      order.id,
      OrderStatus.CONFIRMED,
    );
  });

  it('uses the rejection notification for an admin rejection', async () => {
    await service.notifyOrderRejected({
      ...order,
      status: OrderStatus.CANCELLED,
    });

    expect(telegram.sendOrderRejectedNotification).toHaveBeenCalledWith(
      '100',
      order.id,
    );
  });

  it('notifies the customer when an order is completed', async () => {
    await service.notifyOrderStatusChanged({
      ...order,
      status: OrderStatus.COMPLETED,
    });

    expect(telegram.sendOrderStatusNotification).toHaveBeenCalledWith(
      '100',
      order.id,
      OrderStatus.COMPLETED,
    );
  });

  it('swallows and logs Telegram failures', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    telegram.sendOrderStatusNotification.mockRejectedValue(
      new Error('network down'),
    );

    await expect(
      service.notifyOrderStatusChanged({
        ...order,
        status: OrderStatus.PROCESSING,
      }),
    ).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalled();
  });
});

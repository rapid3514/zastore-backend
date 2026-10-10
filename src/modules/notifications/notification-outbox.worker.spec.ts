import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigService } from '../../../test/helpers/config.js';
import {
  NotificationDeliveryStatus,
  NotificationKind,
  OrderStatus,
} from '../../generated/prisma/client.js';
import { NotificationOutboxWorker } from './notification-outbox.worker.js';
import { TelegramDeliveryError } from './telegram-delivery.error.js';

const notification = {
  id: 'notification-1',
  recipient: 100n,
  kind: NotificationKind.NEW_ORDER,
  orderId: 'order-1',
  orderStatus: OrderStatus.PENDING_CONFIRMATION,
  attempts: 1,
  order: {
    id: 'order-1',
    total: '10.00',
    createdAt: new Date(),
    user: { telegramId: 100n, firstName: 'Ali' },
  },
};

describe('NotificationOutboxWorker', () => {
  const repository = {
    claimNext: vi.fn(),
    markDelivered: vi.fn(),
    markFailed: vi.fn(),
  };
  const telegram = {
    sendNewOrderNotification: vi.fn(),
    sendOrderStatusNotification: vi.fn(),
    sendOrderRejectedNotification: vi.fn(),
  };
  let worker: NotificationOutboxWorker;
  beforeEach(() => {
    vi.resetAllMocks();
    repository.claimNext
      .mockResolvedValueOnce(notification)
      .mockResolvedValue(null);
    worker = new NotificationOutboxWorker(
      repository as never,
      telegram as never,
      createConfigService(),
    );
  });

  it('marks a confirmed success delivered and cannot resend a completed event', async () => {
    await worker.run();
    expect(telegram.sendNewOrderNotification).toHaveBeenCalledOnce();
    expect(repository.markDelivered).toHaveBeenCalledWith(
      notification.id,
      expect.any(String),
      expect.any(Date),
    );
    await worker.run();
    expect(telegram.sendNewOrderNotification).toHaveBeenCalledOnce();
  });

  it('retries definite Telegram rejection with backoff and stops at max attempts', async () => {
    telegram.sendNewOrderNotification.mockRejectedValue(
      new TelegramDeliveryError('retryable', 'TELEGRAM_RATE_LIMIT', 30),
    );
    await worker.run();
    expect(repository.markFailed).toHaveBeenCalledWith(
      notification.id,
      expect.any(String),
      NotificationDeliveryStatus.PENDING,
      'TELEGRAM_RATE_LIMIT',
      expect.any(Date),
    );
    const availableAt = repository.markFailed.mock.calls[0][4] as Date;
    expect(availableAt.getTime()).toBeGreaterThan(Date.now() + 29_000);
    repository.claimNext
      .mockReset()
      .mockResolvedValueOnce({ ...notification, attempts: 8 })
      .mockResolvedValue(null);
    await worker.run();
    expect(repository.markFailed).toHaveBeenLastCalledWith(
      notification.id,
      expect.any(String),
      NotificationDeliveryStatus.FAILED,
      'TELEGRAM_RATE_LIMIT',
      expect.any(Date),
    );
  });

  it.each([
    new Error('network timeout'),
    new TelegramDeliveryError('uncertain', 'TELEGRAM_TIMEOUT'),
  ])(
    'quarantines ambiguous delivery instead of risking duplicate messages',
    async (error) => {
      telegram.sendNewOrderNotification.mockRejectedValue(error);
      await expect(worker.run()).resolves.toBeUndefined();
      expect(repository.markFailed).toHaveBeenCalledWith(
        notification.id,
        expect.any(String),
        NotificationDeliveryStatus.UNCERTAIN,
        expect.any(String),
        expect.any(Date),
      );
      expect(repository.markDelivered).not.toHaveBeenCalled();
    },
  );

  it('keeps original rejection/status recipient behavior', async () => {
    repository.claimNext
      .mockReset()
      .mockResolvedValueOnce({
        ...notification,
        kind: NotificationKind.ORDER_REJECTED,
      })
      .mockResolvedValueOnce({
        ...notification,
        kind: NotificationKind.ORDER_STATUS,
        orderStatus: OrderStatus.CONFIRMED,
      })
      .mockResolvedValue(null);
    await worker.run();
    expect(telegram.sendOrderRejectedNotification).toHaveBeenCalledWith(
      '100',
      'order-1',
    );
    expect(telegram.sendOrderStatusNotification).toHaveBeenCalledWith(
      '100',
      'order-1',
      OrderStatus.CONFIRMED,
    );
  });
});

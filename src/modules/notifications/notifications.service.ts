import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '../../generated/prisma/client.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { NotificationsRepository } from './notifications.repository.js';

export interface NotificationOrder {
  id: string;
  status: OrderStatus;
  btcPostBranchNumber?: string | null;
  total: { toString(): string } | string | number;
  createdAt: Date;
  user: {
    telegramId: bigint;
    firstName: string;
    lastName?: string | null;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly telegramService: TelegramService,
  ) {}

  async notifyNewOrder(order: NotificationOrder): Promise<void> {
    await this.safely('new order', async () => {
      const recipients =
        await this.notificationsRepository.findNotificationAdmins();
      const results = await Promise.allSettled(
        recipients.map((recipient) =>
          this.telegramService.sendNewOrderNotification(
            recipient.telegramId.toString(),
            order,
          ),
        ),
      );
      const failed = results.filter(
        (result) => result.status === 'rejected',
      ).length;
      if (failed)
        this.logger.error(`${failed} new-order notification(s) failed`);
    });
  }

  notifyOrderConfirmed(order: NotificationOrder): Promise<void> {
    return this.notifyCustomer(order, OrderStatus.CONFIRMED);
  }

  notifyOrderRejected(order: NotificationOrder): Promise<void> {
    return this.safely('order rejected', () =>
      this.telegramService.sendOrderRejectedNotification(
        order.user.telegramId.toString(),
        order.id,
      ),
    );
  }

  notifyOrderStatusChanged(order: NotificationOrder): Promise<void> {
    return this.notifyCustomer(order, order.status);
  }

  private notifyCustomer(
    order: NotificationOrder,
    status: OrderStatus,
  ): Promise<void> {
    return this.safely(`order status ${status}`, () =>
      this.telegramService.sendOrderStatusNotification(
        order.user.telegramId.toString(),
        order.id,
        status,
      ),
    );
  }

  private async safely(label: string, operation: () => Promise<void>) {
    try {
      await operation();
    } catch {
      this.logger.error(`Telegram ${label} notification failed`);
    }
  }
}

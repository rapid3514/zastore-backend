import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { getConfiguration } from '../../config/configuration.js';
import {
  NotificationDeliveryStatus,
  NotificationKind,
} from '../../generated/prisma/client.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { NotificationsRepository } from './notifications.repository.js';
import { TelegramDeliveryError } from './telegram-delivery.error.js';

@Injectable()
export class NotificationOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationOutboxWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopping = false;

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => void this.run(),
      getConfiguration(this.config).outbox.pollIntervalMs,
    );
    this.timer.unref();
    void this.run();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      for (let count = 0; count < 25 && !this.stopping; count += 1) {
        const claimToken = randomUUID();
        const notification = await this.repository.claimNext(
          new Date(),
          claimToken,
        );
        if (!notification) break;
        try {
          const recipient = notification.recipient.toString();
          if (notification.kind === NotificationKind.NEW_ORDER) {
            await this.telegram.sendNewOrderNotification(
              recipient,
              notification.order,
            );
          } else if (notification.kind === NotificationKind.ORDER_REJECTED) {
            await this.telegram.sendOrderRejectedNotification(
              recipient,
              notification.orderId,
            );
          } else {
            await this.telegram.sendOrderStatusNotification(
              recipient,
              notification.orderId,
              notification.orderStatus,
            );
          }
          await this.repository.markDelivered(
            notification.id,
            claimToken,
            new Date(),
          );
        } catch (error) {
          const outcome =
            error instanceof TelegramDeliveryError
              ? error.outcome
              : 'uncertain';
          const code =
            error instanceof TelegramDeliveryError
              ? error.code
              : 'DELIVERY_RESULT_UNKNOWN';
          const maxAttempts = getConfiguration(this.config).outbox.maxAttempts;
          const status =
            outcome === 'uncertain'
              ? NotificationDeliveryStatus.UNCERTAIN
              : outcome === 'retryable' && notification.attempts < maxAttempts
                ? NotificationDeliveryStatus.PENDING
                : NotificationDeliveryStatus.FAILED;
          const retrySeconds =
            error instanceof TelegramDeliveryError
              ? (error.retryAfterSeconds ?? 0)
              : 0;
          const backoffMs = Math.max(
            Math.min(
              3_600_000,
              1_000 * 2 ** Math.min(notification.attempts, 12),
            ),
            Math.min(retrySeconds * 1000, 86_400_000),
          );
          await this.repository.markFailed(
            notification.id,
            claimToken,
            status,
            code,
            new Date(Date.now() + backoffMs),
          );
          this.logger.error({
            event: 'notification_delivery_failed',
            notificationId: notification.id,
            outcome,
            status,
            attempt: notification.attempts,
            code,
          });
        }
      }
    } catch {
      this.logger.error({ event: 'notification_outbox_failed' });
    } finally {
      this.running = false;
    }
  }
}

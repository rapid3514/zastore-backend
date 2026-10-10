import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module.js';
import { NotificationsRepository } from './notifications.repository.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationOutboxWorker } from './notification-outbox.worker.js';

@Module({
  imports: [TelegramModule],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationOutboxWorker,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

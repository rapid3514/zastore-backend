import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { TelegramController } from './telegram.controller.js';
import { TelegramService } from './telegram.service.js';

@Module({
  imports: [UsersModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { TelegramService } from './telegram.service.js';
import type { TelegramUpdate } from './telegram.types.js';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Headers('x-telegram-bot-api-secret-token')
    suppliedSecret: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    const expectedSecret = this.configService.get<string>(
      'TELEGRAM_WEBHOOK_SECRET',
    );
    if (!this.secretMatches(suppliedSecret, expectedSecret)) {
      this.logger.warn('Rejected Telegram webhook with invalid secret');
      throw new UnauthorizedException('Invalid Telegram webhook secret');
    }

    await this.telegramService.handleUpdate(update);
    return { ok: true };
  }

  private secretMatches(
    suppliedSecret: string | undefined,
    expectedSecret: string | undefined,
  ): boolean {
    if (!suppliedSecret || !expectedSecret) return false;
    const suppliedHash = createHash('sha256').update(suppliedSecret).digest();
    const expectedHash = createHash('sha256').update(expectedSecret).digest();
    return timingSafeEqual(suppliedHash, expectedHash);
  }
}

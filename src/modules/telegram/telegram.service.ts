import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service.js';
import {
  registrationKeyboard,
  removeRegistrationKeyboard,
} from './keyboards/registration.keyboard.js';
import { shopKeyboard } from './keyboards/shop.keyboard.js';
import { postTelegram } from './telegram-api.js';
import type {
  TelegramApiResponse,
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types.js';

const messages = {
  registration: 'Ro‘yxatdan o‘tish uchun telefon raqamingizni yuboring',
  registrationSuccess: '✅ Ro‘yxatdan muvaffaqiyatli o‘tdingiz',
  ownContactOnly:
    '❌ Iltimos, o‘zingizning telefon raqamingizni yuboring.',
  privateChat:
    'Ro‘yxatdan o‘tish uchun bot bilan shaxsiy chatni oching.',
  blocked: '⛔ Hisobingiz bloklangan',
  phoneInUse: '❌ Bu telefon raqami boshqa akkauntga biriktirilgan.',
  phoneRequest: 'Telefon raqamingizni yuboring:',
  phoneSaved: '✅ Telefon raqamingiz saqlandi.',
  phoneUpdated: '✅ Telefon raqamingiz yangilandi.',
  ownPhoneOnly: '❌ Faqat o‘zingizning telefon raqamingizni yuboring.',
  phoneSaveError: '❌ Telefon raqamini saqlashda xatolik yuz berdi.',
  openShop: 'Menyuni Mini App orqali oching:',
} as const;

const botCommands = [
  { command: 'start', description: 'Botni ishga tushirish' },
  { command: 'phone', description: 'Telefon raqamni qo‘shish yoki yangilash' },
] as const;

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly phoneCommandUsers = new Set<bigint>();

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;
    if (!message.from) return;
    if (!Number.isSafeInteger(message.from.id)) return;
    if (!Number.isSafeInteger(message.chat.id)) return;

    if (message.text?.trim().startsWith('/start')) {
      await this.handleStart(message);
      return;
    }

    if (/^\/phone(?:@[\w_]+)?(?:\s|$)/.test(message.text?.trim() ?? '')) {
      await this.handlePhoneCommand(message);
      return;
    }

    if (message.contact) {
      await this.handleContact(message);
    }
  }

  async setMyCommands(): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) return;

    try {
      const { statusCode, payload } = await postTelegram<unknown>(
        token,
        'setMyCommands',
        { commands: botCommands },
      );
      if (statusCode < 200 || statusCode >= 300 || !payload.ok) {
        this.logger.error(
          `Telegram commands could not be registered: ${payload.description ?? 'unknown error'}`,
        );
      }
    } catch {
      this.logger.error('Telegram commands could not be registered');
    }
  }

  private async handleStart(message: TelegramMessage): Promise<void> {
    if (message.chat.type !== 'private') {
      await this.sendMessage(message.chat.id, messages.privateChat);
      return;
    }

    const sender = message.from!;
    const user = await this.usersService.findByTelegramId(BigInt(sender.id));

    if (!user) {
      await this.sendRegistrationKeyboard(message.chat.id);
      return;
    }
    if (user.isBlocked) {
      await this.sendMessage(message.chat.id, messages.blocked);
      return;
    }
    if (!user.phone) {
      await this.sendRegistrationKeyboard(message.chat.id);
      return;
    }
    await this.sendShopButton(message.chat.id);
  }

  private async handlePhoneCommand(message: TelegramMessage): Promise<void> {
    if (message.chat.type !== 'private') {
      await this.sendMessage(message.chat.id, messages.privateChat);
      return;
    }

    const telegramId = BigInt(message.from!.id);
    const user = await this.usersService.findByTelegramId(telegramId);
    if (user?.isBlocked) {
      await this.sendMessage(message.chat.id, messages.blocked);
      return;
    }

    await this.sendMessage(
      message.chat.id,
      messages.phoneRequest,
      registrationKeyboard(),
    );
    this.phoneCommandUsers.add(telegramId);
  }

  private async handleContact(message: TelegramMessage): Promise<void> {
    const sender = message.from!;
    const contact = message.contact!;
    const telegramId = BigInt(sender.id);
    const isPhoneCommand = this.phoneCommandUsers.delete(telegramId);
    if (message.chat.type !== 'private') {
      await this.sendMessage(message.chat.id, messages.privateChat);
      return;
    }
    if (contact.user_id === undefined || contact.user_id !== sender.id) {
      await this.sendMessage(
        message.chat.id,
        isPhoneCommand ? messages.ownPhoneOnly : messages.ownContactOnly,
      );
      return;
    }

    try {
      const existingUser = await this.usersService.findByTelegramId(telegramId);
      await this.usersService.registerFromTelegramContact({
        telegramId,
        firstName: sender.first_name,
        lastName: sender.last_name,
        username: sender.username,
        phone: contact.phone_number,
      });

      if (isPhoneCommand) {
        await this.sendMessage(
          message.chat.id,
          existingUser?.phone ? messages.phoneUpdated : messages.phoneSaved,
          removeRegistrationKeyboard(),
        );
        return;
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        await this.sendMessage(message.chat.id, messages.blocked);
        return;
      }
      if (error instanceof ConflictException) {
        await this.sendMessage(message.chat.id, messages.phoneInUse);
        return;
      }
      await this.sendMessage(message.chat.id, messages.phoneSaveError);
      return;
    }

    await this.sendMessage(
      message.chat.id,
      messages.registrationSuccess,
      removeRegistrationKeyboard(),
    );
    await this.sendShopButton(message.chat.id);
  }

  private async sendRegistrationKeyboard(chatId: number): Promise<void> {
    await this.sendMessage(
      chatId,
      messages.registration,
      registrationKeyboard(),
    );
  }

  private async sendShopButton(chatId: number): Promise<void> {
    const miniAppUrl = this.configService.get<string>('MINI_APP_URL');
    if (!miniAppUrl) {
      throw new ServiceUnavailableException('MINI_APP_URL is not configured');
    }
    await this.sendMessage(chatId, messages.openShop, shopKeyboard(miniAppUrl));
  }

  private async sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new ServiceUnavailableException(
        'TELEGRAM_BOT_TOKEN is not configured',
      );
    }

    let statusCode: number;
    let payload: TelegramApiResponse<unknown>;
    try {
      ({ statusCode, payload } = await postTelegram<unknown>(
        token,
        'sendMessage',
        {
          chat_id: chatId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
      ));
    } catch {
      throw new BadGatewayException('Telegram API is unavailable');
    }

    if (statusCode < 200 || statusCode >= 300 || !payload.ok) {
      throw new BadGatewayException(
        payload.description ?? 'Telegram API request failed',
      );
    }
  }
}

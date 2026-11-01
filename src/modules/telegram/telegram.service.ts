import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '../../generated/prisma/client.js';
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
import { getConfiguration } from '../../config/configuration.js';
import { TelegramDeliveryError } from '../notifications/telegram-delivery.error.js';

const messages = {
  registration: 'Ro‘yxatdan o‘tish uchun telefon raqamingizni yuboring',
  registrationSuccess: '✅ Ro‘yxatdan muvaffaqiyatli o‘tdingiz',
  ownContactOnly: '❌ Iltimos, o‘zingizning telefon raqamingizni yuboring.',
  privateChat: 'Ro‘yxatdan o‘tish uchun bot bilan shaxsiy chatni oching.',
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

export interface TelegramMediaInput {
  type: 'photo' | 'video';
  media: string;
  caption?: string;
  parse_mode?: 'HTML';
}

function escapeHtml(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNotificationMoney(
  amount: { toString(): string } | string | number,
): string {
  const raw =
    typeof amount === 'object' && amount !== null && 'toString' in amount
      ? amount.toString()
      : String(amount);
  const parsed = Number(raw);
  if (!Number.isNaN(parsed)) {
    return `${Math.round(parsed).toLocaleString('uz-UZ')} so'm`;
  }
  return `${raw} so'm`;
}

function formatNotificationDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

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
    const token = getConfiguration(this.configService).telegram.botToken;
    if (!token) return;

    try {
      const { statusCode, payload } = await postTelegram<unknown>(
        token,
        'setMyCommands',
        { commands: botCommands },
      );
      if (statusCode < 200 || statusCode >= 300 || !payload.ok) {
        this.logger.error('Telegram commands could not be registered');
      }
    } catch {
      this.logger.error('Telegram commands could not be registered');
    }
  }

  async setWebhook(): Promise<void> {
    const { botToken, webhookSecret, webhookUrl } = getConfiguration(this.configService).telegram;
    if (!botToken || !webhookSecret || !webhookUrl) return;

    try {
      const { statusCode, payload } = await postTelegram<unknown>(
        botToken,
        'setWebhook',
        {
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ['message'],
          drop_pending_updates: false,
        },
      );
      if (statusCode < 200 || statusCode >= 300 || !payload.ok) {
        this.logger.error('Telegram webhook could not be registered');
      }
    } catch {
      this.logger.error('Telegram webhook could not be registered');
    }
  }

  async sendNewOrderNotification(
    chatId: string,
    order: {
      id: string;
      total: { toString(): string } | string | number;
      createdAt: Date;
      phone?: string | null;
      deliveryAddress?: string | null;
      btcPostBranchNumber?: string | null;
      user: { firstName: string; lastName?: string | null; phone?: string | null };
      items?: Array<{
        productName: string;
        quantity: number;
        unitPrice?: { toString(): string } | string | number;
        lineTotal?: { toString(): string } | string | number;
        product?: {
          imageUrl?: string | null;
          imageFileId?: string | null;
          media?: Array<{ url: string; fileId?: string }>;
        } | null;
      }>;
    },
  ): Promise<void> {
    const customer = [order.user.firstName, order.user.lastName]
      .filter(Boolean)
      .join(' ');
    const phone = order.phone || order.user.phone;
    const items = order.items ?? [];

    const productLines: string[] = [];
    if (items.length === 1) {
      productLines.push(
        `📦 <b>Mahsulot:</b> ${escapeHtml(items[0].productName)} (${items[0].quantity} dona)`,
      );
    } else if (items.length > 1) {
      productLines.push('📦 <b>Mahsulotlar:</b>');
      for (const item of items) {
        productLines.push(
          `• ${escapeHtml(item.productName)} (${item.quantity} dona)`,
        );
      }
    } else {
      productLines.push('📦 <b>Mahsulot:</b> Yangi buyurtma');
    }

    const lines = [
      '🛍 <b>Yangi buyurtma!</b>',
      '',
      ...productLines,
      `👤 <b>Mijoz:</b> ${escapeHtml(customer)}`,
      ...(phone ? [`📞 <b>Telefon:</b> ${escapeHtml(phone)}`] : []),
      ...(order.deliveryAddress
        ? [`📍 <b>Manzil:</b> ${escapeHtml(order.deliveryAddress)}`]
        : []),
      ...(order.btcPostBranchNumber
        ? [`📮 <b>BTC pochta filiali:</b> ${escapeHtml(order.btcPostBranchNumber)}`]
        : []),
      `💰 <b>Summa:</b> ${escapeHtml(formatNotificationMoney(order.total))}`,
      `⏰ <b>Vaqt:</b> ${escapeHtml(formatNotificationDate(order.createdAt))}`,
      '',
      '<i>Admin panelni tekshiring.</i>',
    ];
    const messageText = lines.join('\n');

    let photo: string | undefined;
    for (const item of items) {
      const p = item.product;
      if (!p) continue;
      const candidate =
        p.imageFileId ||
        p.imageUrl ||
        p.media?.find((m) => Boolean(m.fileId))?.fileId ||
        p.media?.find((m) => Boolean(m.url))?.url ||
        p.media?.[0]?.fileId ||
        p.media?.[0]?.url;
      if (candidate) {
        photo = candidate;
        break;
      }
    }

    if (photo) {
      try {
        await this.sendPhoto(chatId, photo, messageText);
        return;
      } catch (error) {
        this.logger.warn(
          `Could not send order photo to admin (${chatId}): ${error instanceof Error ? error.message : String(error)}. Falling back to text message.`,
        );
      }
    }

    await this.sendMessage(chatId, messageText, undefined, 'HTML');
  }

  async sendOrderRejectedNotification(
    chatId: string,
    orderId: string,
  ): Promise<void> {
    await this.sendMessage(
      chatId,
      `❌ Buyurtmangiz rad etildi\n\nBuyurtma: #${orderId}`,
    );
  }

  async sendOrderStatusNotification(
    chatId: string,
    orderId: string,
    status: OrderStatus,
  ): Promise<void> {
    const text: Partial<Record<OrderStatus, string>> = {
      [OrderStatus.CONFIRMED]: '✅ Buyurtmangiz tasdiqlandi',
      [OrderStatus.PROCESSING]: '📦 Buyurtmangiz tayyorlanmoqda',
      [OrderStatus.COMPLETED]: '✅ Buyurtmangiz yakunlandi',
      [OrderStatus.CANCELLED]: '🚫 Buyurtma bekor qilindi',
      [OrderStatus.EXPIRED]: '⌛ Buyurtmani tasdiqlash muddati tugadi',
    };
    const message = text[status];
    if (!message) return;
    await this.sendMessage(chatId, `${message}\n\nBuyurtma: #${orderId}`);
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
    const miniAppUrl = getConfiguration(this.configService).telegram.miniAppUrl;
    if (!miniAppUrl) {
      throw new ServiceUnavailableException('MINI_APP_URL is not configured');
    }
    await this.sendMessage(chatId, messages.openShop, shopKeyboard(miniAppUrl));
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: Record<string, unknown>,
    parseMode?: 'HTML' | 'MarkdownV2',
  ): Promise<number> {
    const message = await this.callTelegram<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
    if (!message || !Number.isSafeInteger(message.message_id)) {
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_INVALID_RESPONSE');
    }
    return message.message_id;
  }

  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<number> {
    const message = await this.callTelegram<TelegramMessage>('sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!message || !Number.isSafeInteger(message.message_id)) {
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_INVALID_RESPONSE');
    }
    return message.message_id;
  }

  async sendVideo(
    chatId: string,
    videoUrl: string,
    caption: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<number> {
    const message = await this.callTelegram<TelegramMessage>('sendVideo', {
      chat_id: chatId,
      video: videoUrl,
      caption,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    if (!message || !Number.isSafeInteger(message.message_id)) {
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_INVALID_RESPONSE');
    }
    return message.message_id;
  }

  async sendMediaGroup(
    chatId: string,
    media: TelegramMediaInput[],
  ): Promise<number[]> {
    const messages = await this.callTelegram<TelegramMessage[]>(
      'sendMediaGroup',
      { chat_id: chatId, media },
    );
    if (
      !Array.isArray(messages) ||
      messages.length !== media.length ||
      messages.some((message) => !Number.isSafeInteger(message.message_id))
    ) {
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_INVALID_RESPONSE');
    }
    return messages.map((message) => message.message_id);
  }

  async editMessageCaption(
    chatId: string,
    messageId: number,
    caption: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    await this.callTelegram<unknown>('editMessageCaption', {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: 'HTML',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    replyMarkup: Record<string, unknown>,
  ): Promise<void> {
    await this.callTelegram<unknown>('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }

  async editMessageMedia(
    chatId: string,
    messageId: number,
    photoUrl: string,
    caption: string,
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    await this.callTelegram<unknown>('editMessageMedia', {
      chat_id: chatId,
      message_id: messageId,
      media: {
        type: 'photo',
        media: photoUrl,
        caption,
        parse_mode: 'HTML',
      },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async deleteMessage(chatId: string, messageId: number): Promise<void> {
    await this.callTelegram<unknown>('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  private async callTelegram<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = getConfiguration(this.configService).telegram.botToken;
    if (!token) {
      throw new ServiceUnavailableException(
        'TELEGRAM_BOT_TOKEN is not configured',
      );
    }

    let statusCode: number;
    let payload: TelegramApiResponse<T>;
    try {
      ({ statusCode, payload } = await postTelegram<T>(token, method, body));
    } catch {
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_UNAVAILABLE');
    }

    if (statusCode < 200 || statusCode >= 300 || !payload.ok) {
      if (payload.ok === false) {
        const retryable = statusCode === 429 || statusCode >= 500;
        throw new TelegramDeliveryError(retryable ? 'retryable' : 'permanent', statusCode === 429 ? 'TELEGRAM_RATE_LIMIT' : 'TELEGRAM_REJECTED');
      }
      throw new TelegramDeliveryError('uncertain', 'TELEGRAM_INVALID_RESPONSE');
    }
    if (payload.result === undefined) {
      return undefined as T;
    }
    return payload.result;
  }
}

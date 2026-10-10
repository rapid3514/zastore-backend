import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConfiguration } from '../../config/configuration.js';
import {
  ProductMediaType,
  ProductAvailabilityStatus,
  TelegramProductSyncStatus,
} from '../../generated/prisma/client.js';
import {
  TelegramService,
  type TelegramMediaInput,
} from '../telegram/telegram.service.js';
import { buildProductTelegramCaption } from './product-telegram-caption.js';
import { ProductsRepository } from './products.repository.js';

interface TelegramProductMedia {
  type: ProductMediaType;
  url: string;
  position: number;
}

interface PublishedProductMessages {
  mediaMessageIds: number[];
  buttonMessageId: number;
}

export interface TelegramProductRecord {
  id: string;
  name: string;
  description: string | null;
  price: { toString(): string };
  cargoPrice?: { toString(): string } | null;
  imageUrl: string | null;
  imageFileId: string | null;
  media?: TelegramProductMedia[];
  telegramMessages?: { messageId: number; position: number }[];
  category: { name: string };
  availabilityStatus: ProductAvailabilityStatus;
  telegramChannelMessageId: number | null;
  telegramButtonMessageId: number | null;
  telegramPublishedAt: Date | null;
  telegramSyncedAt: Date | null;
  telegramSyncStatus: TelegramProductSyncStatus;
}

type SyncMode = 'caption' | 'media';

@Injectable()
export class ProductTelegramPublisherService {
  private readonly logger = new Logger(ProductTelegramPublisherService.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly productsRepository: ProductsRepository,
    private readonly configService: ConfigService,
  ) {}

  syncAfterCreate<T extends TelegramProductRecord>(product: T): Promise<T> {
    return this.syncBestEffort(product, 'media', false);
  }

  syncAfterUpdate<T extends TelegramProductRecord>(
    product: T,
    mediaChanged: boolean,
  ): Promise<T> {
    return this.syncBestEffort(
      product,
      mediaChanged ? 'media' : 'caption',
      false,
    );
  }

  async syncManually<T extends TelegramProductRecord>(
    product: T,
    forceRepublish: boolean,
  ): Promise<T> {
    const mustRepublish =
      forceRepublish ||
      product.telegramSyncStatus === TelegramProductSyncStatus.FAILED ||
      this.messageIds(product).length === 0;
    try {
      return await this.performSync(
        product,
        mustRepublish ? 'media' : 'caption',
        forceRepublish,
      );
    } catch (error) {
      await this.markFailed(product.id);
      this.logger.error('Manual Telegram product sync failed');
      throw error;
    }
  }

  async deletePostBestEffort(messageId: number | null): Promise<void> {
    if (messageId !== null) await this.deleteMessageBestEffort(messageId);
  }

  async deleteProductPostsBestEffort(
    product: TelegramProductRecord,
  ): Promise<void> {
    await Promise.all(
      this.allMessageIds(product).map((messageId) =>
        this.deleteMessageBestEffort(messageId),
      ),
    );
  }

  async removeProductPostsBestEffort(
    product: TelegramProductRecord,
  ): Promise<void> {
    const oldMessageIds = this.allMessageIds(product);
    try {
      await this.productsRepository.updateTelegramPublication(
        product.id,
        {
          telegramChannelMessageId: null,
          telegramButtonMessageId: null,
          telegramSyncedAt: new Date(),
          telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
        },
        [],
      );
    } catch {
      this.logger.warn('Telegram product message metadata cleanup failed');
    }
    await Promise.all(
      oldMessageIds.map((messageId) => this.deleteMessageBestEffort(messageId)),
    );
  }

  private async syncBestEffort<T extends TelegramProductRecord>(
    product: T,
    mode: SyncMode,
    forceRepublish: boolean,
  ): Promise<T> {
    try {
      return await this.performSync(product, mode, forceRepublish);
    } catch {
      this.logger.error('Telegram product sync failed');
      try {
        const failed = await this.productsRepository.updateTelegramSync(
          product.id,
          { telegramSyncStatus: TelegramProductSyncStatus.FAILED },
        );
        return { ...product, ...failed };
      } catch {
        return {
          ...product,
          telegramSyncStatus: TelegramProductSyncStatus.FAILED,
        };
      }
    }
  }

  private async performSync<T extends TelegramProductRecord>(
    product: T,
    mode: SyncMode,
    forceRepublish: boolean,
  ): Promise<T> {
    const media = this.productMedia(product);
    if (!media.length) {
      throw new BadRequestException({
        error: 'PRODUCT_MEDIA_REQUIRED',
        message: 'Telegramga yuborish uchun product media-si kerak',
      });
    }

    const oldMessageIds = this.messageIds(product);
    const oldButtonMessageId = product.telegramButtonMessageId;
    const caption = buildProductTelegramCaption(product);
    if (forceRepublish || mode === 'media' || oldMessageIds.length === 0) {
      const published = await this.publish(media, caption, product.id);
      const now = new Date();
      let synced: Awaited<ReturnType<ProductsRepository['updateTelegramSync']>>;
      try {
        synced = await this.persistPublication(product.id, published, now);
      } catch (error) {
        await Promise.all(
          [...published.mediaMessageIds, published.buttonMessageId].map(
            (messageId) => this.deleteMessageBestEffort(messageId),
          ),
        );
        throw error;
      }
      const replacedMessageIds = [
        ...oldMessageIds,
        ...(oldButtonMessageId === null ? [] : [oldButtonMessageId]),
      ];
      if (replacedMessageIds.length) {
        await Promise.all(
          replacedMessageIds.map((messageId) =>
            this.deleteMessageBestEffort(messageId),
          ),
        );
      }
      return { ...product, ...synced };
    }

    try {
      await this.telegramService.editMessageCaption(
        this.channelId,
        oldMessageIds[0],
        caption,
        { inline_keyboard: [] },
      );
    } catch (error) {
      if (!this.isMessageNotModified(error)) throw error;
    }
    const buttonMessageId = await this.syncButtonMessage(
      product.id,
      oldButtonMessageId,
    );
    let synced: Awaited<ReturnType<ProductsRepository['updateTelegramSync']>>;
    try {
      synced = await this.productsRepository.updateTelegramSync(product.id, {
        telegramButtonMessageId: buttonMessageId,
        telegramSyncedAt: new Date(),
        telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
      });
    } catch (error) {
      if (buttonMessageId !== oldButtonMessageId) {
        await this.deleteMessageBestEffort(buttonMessageId);
      }
      throw error;
    }
    return { ...product, ...synced };
  }

  private async publish(
    media: TelegramProductMedia[],
    caption: string,
    productId: string,
  ): Promise<PublishedProductMessages> {
    const replyMarkup = this.productReplyMarkup(productId);
    let mediaMessageIds: number[];
    if (media.length === 1) {
      const item = media[0];
      const messageId =
        item.type === ProductMediaType.VIDEO
          ? await this.telegramService.sendVideo(
              this.channelId,
              item.url,
              caption,
            )
          : await this.telegramService.sendPhoto(
              this.channelId,
              item.url,
              caption,
            );
      mediaMessageIds = [messageId];
    } else {
      const group: TelegramMediaInput[] = media.map((item, index) => ({
        type: item.type === ProductMediaType.VIDEO ? 'video' : 'photo',
        media: item.url,
        ...(index === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
      }));
      mediaMessageIds = await this.telegramService.sendMediaGroup(
        this.channelId,
        group,
      );
    }

    try {
      const buttonMessageId = await this.sendButtonMessage(
        productId,
        replyMarkup,
      );
      return { mediaMessageIds, buttonMessageId };
    } catch (error) {
      await Promise.all(
        mediaMessageIds.map((messageId) =>
          this.deleteMessageBestEffort(messageId),
        ),
      );
      throw error;
    }
  }

  private persistPublication(
    productId: string,
    published: PublishedProductMessages,
    now: Date,
  ) {
    const data = {
      telegramChannelMessageId: published.mediaMessageIds[0],
      telegramButtonMessageId: published.buttonMessageId,
      telegramPublishedAt: now,
      telegramSyncedAt: now,
      telegramSyncStatus: TelegramProductSyncStatus.SYNCED,
    };
    const repository = this.productsRepository as ProductsRepository & {
      updateTelegramPublication?: ProductsRepository['updateTelegramPublication'];
    };
    return repository.updateTelegramPublication
      ? repository.updateTelegramPublication(
          productId,
          data,
          published.mediaMessageIds,
        )
      : this.productsRepository.updateTelegramSync(productId, data);
  }

  private async syncButtonMessage(
    productId: string,
    currentMessageId: number | null,
  ): Promise<number> {
    if (currentMessageId !== null) {
      try {
        await this.telegramService.editMessageReplyMarkup(
          this.channelId,
          currentMessageId,
          this.productReplyMarkup(productId),
        );
        return currentMessageId;
      } catch (error) {
        if (this.isMessageNotModified(error)) return currentMessageId;
        await this.deleteMessageBestEffort(currentMessageId);
      }
    }
    return this.sendButtonMessage(productId);
  }

  private sendButtonMessage(
    productId: string,
    replyMarkup = this.productReplyMarkup(productId),
  ): Promise<number> {
    return this.telegramService.sendMessage(
      this.channelId,
      '🛒 Buyurtma berish',
      replyMarkup,
    );
  }

  private productMedia(product: TelegramProductRecord): TelegramProductMedia[] {
    if (product.media?.length) {
      return [...product.media].sort((a, b) => {
        if (a.type !== b.type)
          return a.type === ProductMediaType.IMAGE ? -1 : 1;
        return a.position - b.position;
      });
    }
    return product.imageUrl
      ? [{ type: ProductMediaType.IMAGE, url: product.imageUrl, position: 0 }]
      : [];
  }

  private messageIds(product: TelegramProductRecord): number[] {
    if (product.telegramMessages?.length) {
      return [...product.telegramMessages]
        .sort((a, b) => a.position - b.position)
        .map((message) => message.messageId);
    }
    return product.telegramChannelMessageId === null
      ? []
      : [product.telegramChannelMessageId];
  }

  private allMessageIds(product: TelegramProductRecord): number[] {
    const messageIds = this.messageIds(product);
    return product.telegramButtonMessageId === null
      ? messageIds
      : [...messageIds, product.telegramButtonMessageId];
  }

  private async deleteMessageBestEffort(messageId: number): Promise<void> {
    try {
      await this.telegramService.deleteMessage(this.channelId, messageId);
    } catch {
      this.logger.warn('Telegram product post delete failed');
    }
  }

  private isMessageNotModified(error: unknown): boolean {
    return (
      error instanceof Error && /message is not modified/i.test(error.message)
    );
  }

  private async markFailed(productId: string): Promise<void> {
    try {
      await this.productsRepository.updateTelegramSync(productId, {
        telegramSyncStatus: TelegramProductSyncStatus.FAILED,
      });
    } catch {
      this.logger.error('Telegram failed status could not be persisted');
    }
  }

  private get channelId(): string {
    const channelId = getConfiguration(this.configService).telegram.channelId;
    if (!channelId) {
      throw new ServiceUnavailableException({
        error: 'TELEGRAM_CHANNEL_NOT_CONFIGURED',
        message: 'Telegram kanal konfiguratsiyasi mavjud emas',
      });
    }
    return channelId;
  }

  private productReplyMarkup(productId: string): Record<string, unknown> {
    const { botUsername, miniAppShortName, miniAppUseMain: useMainApp } =
      getConfiguration(this.configService).telegram;
    if (!botUsername || (!miniAppShortName && !useMainApp)) {
      throw new ServiceUnavailableException({
        error: 'TELEGRAM_MINI_APP_NOT_CONFIGURED',
        message: 'Telegram Mini App deep link konfiguratsiyasi mavjud emas',
      });
    }

    const startParam = encodeURIComponent(`product_${productId}`);
    const appPath = useMainApp ? '' : `/${miniAppShortName}`;
    const url = `https://t.me/${botUsername}${appPath}?startapp=${startParam}`;
    return { inline_keyboard: [[{ text: '🛒 Zakaz berish', url }]] };
  }
}

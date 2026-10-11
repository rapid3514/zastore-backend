import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import type { UpdateAppearanceDto } from './dto/update-appearance.dto.js';

type AppearanceScope = 'bot' | 'super-admin';
const CHANGE_LIMIT = 5;
const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class AppearanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async findPublic() {
    return this.find('bot');
  }

  async findSuperAdmin() {
    return this.find('super-admin');
  }

  private async find(scope: AppearanceScope) {
    const setting = await this.prisma.botAppearance.findUnique({
      where: { id: scope },
      select: { backgroundUrl: true, updatedAt: true },
    });
    return setting ?? { backgroundUrl: null, updatedAt: null };
  }

  async getLimit(actorId: string, database: Pick<Prisma.TransactionClient, 'botAppearanceChange'> = this.prisma, now = new Date()) {
    const changes = await database.botAppearanceChange.findMany({
      where: { actorId, changedAt: { gt: new Date(now.getTime() - WINDOW_MS) } },
      orderBy: { changedAt: 'asc' },
      select: { changedAt: true },
    });
    const used = changes.length;
    return {
      maxChanges: CHANGE_LIMIT,
      windowDays: WINDOW_DAYS,
      used,
      remaining: Math.max(0, CHANGE_LIMIT - used),
      nextAvailableAt: used >= CHANGE_LIMIT
        ? new Date(changes[used - CHANGE_LIMIT].changedAt.getTime() + WINDOW_MS)
        : null,
    };
  }

  async update(input: UpdateAppearanceDto, actorId: string, scope: AppearanceScope = 'bot') {
    const asset = input.background
      ? await this.media.verifyProductImage(input.background)
      : null;
    const persist = async (transaction: Prisma.TransactionClient) => {
      // The per-account lock prevents parallel saves from exceeding the quota.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-appearance-actor:${actorId}`}, 0::bigint))`;
      // Serializes simultaneous admin saves, including resetting the default.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-appearance:${scope}`}, 0::bigint))`;
      const previous = await transaction.botAppearance.findUnique({ where: { id: scope } });
      if ((previous?.backgroundFileId ?? null) === (asset?.fileId ?? null) &&
          (previous?.backgroundUrl ?? null) === (asset?.url ?? null)) {
        return {
          current: { backgroundUrl: previous?.backgroundUrl ?? null, updatedAt: previous?.updatedAt ?? null },
          previousFileId: previous?.backgroundFileId,
        };
      }
      const now = new Date();
      const limit = await this.getLimit(actorId, transaction, now);
      if (!limit.remaining) {
        throw new HttpException({
          error: 'BACKGROUND_CHANGE_LIMIT',
          message: '30 kun ichida fonni faqat 5 marta o‘zgartirish mumkin. Limit yangilangandan keyin qayta urinib ko‘ring.',
          limit,
        }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const data = {
        backgroundFileId: asset?.fileId ?? null,
        backgroundUrl: asset?.url ?? null,
        updatedById: actorId,
      };
      const current = await transaction.botAppearance.upsert({
        where: { id: scope },
        create: { id: scope, ...data },
        update: data,
        select: { backgroundUrl: true, updatedAt: true },
      });
      await transaction.botAppearanceChange.create({ data: { actorId, scope, changedAt: now } });
      return { current, previousFileId: previous?.backgroundFileId };
    };
    const result = asset
      ? await this.media.withReservedAssets([asset], persist)
      : await this.prisma.$transaction(persist);

    // Cleanup happens after commit and respects references in all other features.
    if (result.previousFileId && result.previousFileId !== asset?.fileId) {
      await this.media.deleteImageIfUnreferenced(result.previousFileId);
    }
    return result.current;
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MediaService } from '../media/media.service.js';
import type { UpdateAppearanceDto } from './dto/update-appearance.dto.js';

type AppearanceScope = 'bot' | 'super-admin';

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

  async update(input: UpdateAppearanceDto, actorId: string, scope: AppearanceScope = 'bot') {
    const asset = input.background
      ? await this.media.verifyProductImage(input.background)
      : null;
    const persist = async (transaction: Prisma.TransactionClient) => {
      // Serializes simultaneous admin saves, including resetting the default.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bot-appearance:${scope}`}, 0::bigint))`;
      const previous = await transaction.botAppearance.findUnique({ where: { id: scope } });
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

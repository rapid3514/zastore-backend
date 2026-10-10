import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

interface NewRefreshSession {
  id: string;
  familyId: string;
  parentId?: string;
  tokenHash: string;
  expiresAt: Date;
  userId: string;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  createRefreshSession(session: NewRefreshSession) {
    return this.prisma.refreshSession.create({ data: session });
  }

  findRefreshSession(id: string) {
    return this.prisma.refreshSession.findUnique({ where: { id } });
  }

  revokeRefreshSession(id: string) {
    return this.prisma.refreshSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeRefreshFamily(familyId: string, userId: string) {
    return this.prisma.$transaction(async (transaction) => {
      // Serialize replay revocation with rotations in the same family. The root
      // exists for the lifetime of the user and gives every rotation one lock.
      await transaction.$queryRaw`SELECT "id" FROM "RefreshSession" WHERE "id" = ${familyId}::uuid FOR UPDATE`;
      return transaction.refreshSession.updateMany({
        where: { familyId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  rotateRefreshSession(
    previousId: string,
    replacement: NewRefreshSession,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "RefreshSession" WHERE "id" = ${replacement.familyId}::uuid FOR UPDATE`;
      const now = new Date();
      const consumed = await transaction.refreshSession.updateMany({
        where: {
          id: previousId,
          familyId: replacement.familyId,
          userId: replacement.userId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return false;
      await transaction.refreshSession.create({ data: replacement });
      return true;
    });
  }
}

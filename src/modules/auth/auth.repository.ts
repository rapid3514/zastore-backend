import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

interface NewRefreshSession {
  id: string;
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
    return this.prisma.refreshSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}

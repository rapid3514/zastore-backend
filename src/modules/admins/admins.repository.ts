import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { UserRole } from '../../generated/prisma/client.js';

@Injectable()
export class AdminsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  listAdmins() {
    return this.prisma.user.findMany({
      where: { role: UserRole.ADMIN },
      orderBy: { createdAt: 'asc' },
    });
  }

  setRole(id: string, role: UserRole) {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  setBlocked(id: string, isBlocked: boolean) {
    return this.prisma.user.update({ where: { id }, data: { isBlocked } });
  }

  updateProfile(
    id: string,
    data: { firstName?: string; lastName?: string; username?: string },
  ) {
    return this.prisma.user.update({ where: { id }, data });
  }
}

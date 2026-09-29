import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { UserRole } from '../../generated/prisma/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';

interface TelegramContactUser {
  telegramId: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  phone: string;
  phoneVerifiedAt: Date;
}

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByTelegramId(telegramId: bigint) {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  updateLastSeen(id: string, lastSeenAt: Date) {
    return this.prisma.user.update({
      where: { id },
      data: { lastSeenAt },
      select: { id: true },
    });
  }

  async list(
    query: QueryUsersDto,
    options: { forcedRole?: UserRole; onlineSince?: Date } = {},
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const telegramId = search && /^\d+$/.test(search) ? BigInt(search) : null;
    const where: Prisma.UserWhereInput = {
      ...(options.forcedRole
        ? { role: options.forcedRole }
        : query.role
          ? { role: query.role }
          : {}),
      ...(query.online !== undefined && options.onlineSince
        ? query.online
          ? { lastSeenAt: { gte: options.onlineSince } }
          : {
              AND: [
                {
                  OR: [
                    { lastSeenAt: null },
                    { lastSeenAt: { lt: options.onlineSince } },
                  ],
                },
              ],
            }
        : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { username: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              ...(telegramId !== null && telegramId <= 9223372036854775807n
                ? [{ telegramId }]
                : []),
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          telegramId: true,
          firstName: true,
          lastName: true,
          username: true,
          phone: true,
          phoneVerifiedAt: true,
          avatarUrl: true,
          role: true,
          isBlocked: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total };
  }

  async getDashboardStats(onlineSince: Date) {
    const [
      totalUsers,
      onlineUsers,
      totalCustomers,
      onlineCustomers,
      totalAdmins,
      onlineAdmins,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { lastSeenAt: { gte: onlineSince } } }),
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
      this.prisma.user.count({
        where: {
          role: UserRole.CUSTOMER,
          lastSeenAt: { gte: onlineSince },
        },
      }),
      this.prisma.user.count({ where: { role: UserRole.ADMIN } }),
      this.prisma.user.count({
        where: { role: UserRole.ADMIN, lastSeenAt: { gte: onlineSince } },
      }),
    ]);

    return {
      totalUsers,
      onlineUsers,
      totalCustomers,
      onlineCustomers,
      totalAdmins,
      onlineAdmins,
    };
  }

  async getCustomerStats(onlineSince: Date) {
    const [totalCustomers, onlineCustomers] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
      this.prisma.user.count({
        where: {
          role: UserRole.CUSTOMER,
          lastSeenAt: { gte: onlineSince },
        },
      }),
    ]);
    return { totalCustomers, onlineCustomers };
  }

  upsertFromTelegramContact(input: TelegramContactUser) {
    return this.prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        firstName: input.firstName,
        lastName: input.lastName,
        username: input.username,
        phone: input.phone,
        phoneVerifiedAt: input.phoneVerifiedAt,
        role: UserRole.CUSTOMER,
      },
      update: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        username: input.username ?? null,
        phone: input.phone,
        phoneVerifiedAt: input.phoneVerifiedAt,
      },
    });
  }

  async promoteGuestToCustomer(id: string) {
    await this.prisma.user.updateMany({
      where: { id, role: UserRole.GUEST },
      data: { role: UserRole.CUSTOMER },
    });
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }
}

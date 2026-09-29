import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';
import type { QueryUsersDto } from './dto/query-users.dto.js';
import { getOnlineSince, isUserOnline } from './presence.util.js';

export interface TelegramContactRegistration {
  telegramId: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  phone: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findByTelegramId(telegramId: bigint) {
    return this.usersRepository.findByTelegramId(telegramId);
  }

  findById(id: string) {
    return this.usersRepository.findById(id);
  }

  async list(query: QueryUsersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { data, total } = await this.usersRepository.list(query);
    return {
      data: data.map((user) => ({
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone,
        phoneVerifiedAt: user.phoneVerifiedAt,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  ping(userId: string) {
    return this.usersRepository.updateLastSeen(userId, new Date());
  }

  superAdminStats() {
    return this.usersRepository.getDashboardStats(getOnlineSince());
  }

  adminStats() {
    return this.usersRepository.getCustomerStats(getOnlineSince());
  }

  listForSuperAdmin(query: QueryUsersDto) {
    return this.listManagedUsers(query);
  }

  listCustomersForAdmin(query: QueryUsersDto) {
    return this.listManagedUsers(query, UserRole.CUSTOMER);
  }

  private async listManagedUsers(query: QueryUsersDto, forcedRole?: UserRole) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const { data, total } = await this.usersRepository.list(query, {
      forcedRole,
      onlineSince: getOnlineSince(now),
    });

    return {
      items: data.map((user) => ({
        id: user.id,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(' '),
        firstName: user.firstName,
        lastName: user.lastName,
        telegramId: user.telegramId.toString(),
        username: user.username,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isBlocked: user.isBlocked,
        lastSeenAt: user.lastSeenAt,
        isOnline: isUserOnline(user.lastSeenAt, now),
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async registerFromTelegramContact(input: TelegramContactRegistration) {
    const phone = this.normalizePhone(input.phone);
    const [existingUser, phoneOwner] = await Promise.all([
      this.usersRepository.findByTelegramId(input.telegramId),
      this.usersRepository.findByPhone(phone),
    ]);

    if (existingUser?.isBlocked) {
      throw new ForbiddenException('User account is blocked');
    }
    if (phoneOwner && phoneOwner.telegramId !== input.telegramId) {
      throw this.phoneAlreadyInUse();
    }

    let user;
    try {
      user = await this.usersRepository.upsertFromTelegramContact({
        ...input,
        phone,
        phoneVerifiedAt: new Date(),
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) throw this.phoneAlreadyInUse();
      throw error;
    }
    if (user.role === UserRole.GUEST) {
      return this.usersRepository.promoteGuestToCustomer(user.id);
    }
    return user;
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '').replace(/^00/, '');
    if (digits.length < 7 || digits.length > 15) {
      throw new BadRequestException('Invalid phone number');
    }
    return `+${digits}`;
  }

  private phoneAlreadyInUse(): ConflictException {
    return new ConflictException({
      error: 'PHONE_ALREADY_IN_USE',
      message: 'Bu telefon raqami boshqa akkauntga biriktirilgan',
    });
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}

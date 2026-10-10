import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  UserRole,
  type User,
} from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { AdminsRepository } from './admins.repository.js';
import type { UpdateAdminDto } from './dto/update-admin.dto.js';

@Injectable()
export class AdminsService {
  constructor(
    private readonly adminsRepository: AdminsRepository,
    private readonly auditService?: AuditService,
  ) {}

  async me(actorUserId: string) {
    const user = await this.requireAdmin(actorUserId);
    return this.present(user);
  }

  async list(actorUserId: string) {
    await this.requireSuperAdmin(actorUserId);
    const users = await this.adminsRepository.listAdmins();
    return users.map((user) => this.present(user));
  }

  async getById(actorUserId: string, targetUserId: string) {
    await this.requireSuperAdmin(actorUserId);
    return this.present(await this.findAdminTarget(targetUserId));
  }

  async update(
    actorUserId: string,
    targetUserId: string,
    input: UpdateAdminDto,
  ) {
    await this.requireSuperAdmin(actorUserId);
    const target = await this.findAdminTarget(targetUserId);
    const data = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.username !== undefined ? { username: input.username } : {}),
    };
    if (!Object.keys(data).length) {
      throw new BadRequestException('At least one editable field is required');
    }
    const updated = await this.guardConcurrentChange(this.adminsRepository.updateProfile(target.id, data));
    await this.auditService?.log({
      actorUserId,
      action: AuditAction.ADMIN_UPDATE,
      entityType: AuditEntityType.USER,
      entityId: target.id,
      metadata: { fields: Object.keys(data) },
    });
    return this.present(updated);
  }

  async promote(actorUserId: string, targetUserId: string) {
    await this.requireSuperAdmin(actorUserId);
    const target = await this.findTarget(targetUserId);
    if (target.isBlocked) {
      throw new BadRequestException('Blocked users cannot be promoted');
    }
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('A super admin cannot be promoted');
    }
    if (target.role === UserRole.ADMIN) {
      return this.present(target);
    }
    if (target.role !== UserRole.CUSTOMER) {
      throw new BadRequestException('Only customers can be promoted');
    }
    const updated = await this.guardConcurrentChange(this.adminsRepository.setRole(
      target.id,
      UserRole.ADMIN,
      target.role,
      target.isBlocked,
    ));
    await this.auditService?.log({
      actorUserId,
      action: AuditAction.ADMIN_PROMOTE,
      entityType: AuditEntityType.USER,
      entityId: target.id,
      metadata: { from: target.role, to: UserRole.ADMIN },
    });
    return this.present(updated);
  }

  async demote(actorUserId: string, targetUserId: string) {
    await this.requireSuperAdmin(actorUserId);
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('A super admin cannot demote themselves');
    }
    const target = await this.findTarget(targetUserId);
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('A super admin cannot be demoted');
    }
    if (target.role !== UserRole.ADMIN) {
      throw new BadRequestException('Target user is not an admin');
    }
    const updated = await this.guardConcurrentChange(this.adminsRepository.setRole(
      target.id,
      UserRole.CUSTOMER,
      target.role,
      target.isBlocked,
    ));
    await this.auditService?.log({
      actorUserId,
      action: AuditAction.ADMIN_DEMOTE,
      entityType: AuditEntityType.USER,
      entityId: target.id,
      metadata: { from: target.role, to: UserRole.CUSTOMER },
    });
    return this.present(updated);
  }

  async block(actorUserId: string, targetUserId: string) {
    return this.changeBlockedState(actorUserId, targetUserId, true);
  }

  async unblock(actorUserId: string, targetUserId: string) {
    return this.changeBlockedState(actorUserId, targetUserId, false);
  }

  private async changeBlockedState(
    actorUserId: string,
    targetUserId: string,
    isBlocked: boolean,
  ) {
    await this.requireSuperAdmin(actorUserId);
    if (actorUserId === targetUserId) {
      throw new ForbiddenException('A super admin cannot block themselves');
    }
    const target = await this.findTarget(targetUserId);
    if (target.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('A super admin cannot be blocked');
    }
    if (target.role !== UserRole.ADMIN) {
      throw new BadRequestException('Target user is not an admin');
    }
    if (target.isBlocked === isBlocked) return this.present(target);
    const updated = await this.guardConcurrentChange(this.adminsRepository.setBlocked(
      target.id,
      isBlocked,
      target.isBlocked,
    ));
    await this.auditService?.log({
      actorUserId,
      action: isBlocked ? AuditAction.ADMIN_BLOCK : AuditAction.ADMIN_UNBLOCK,
      entityType: AuditEntityType.USER,
      entityId: target.id,
      metadata: { isBlocked },
    });
    return this.present(updated);
  }

  private async requireAdmin(id: string): Promise<User> {
    const user = await this.adminsRepository.findById(id);
    if (
      !user ||
      user.isBlocked ||
      (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException('Admin access is not available');
    }
    return user;
  }

  private async requireSuperAdmin(id: string): Promise<User> {
    const user = await this.requireAdmin(id);
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin role is required');
    }
    return user;
  }

  private async findTarget(id: string): Promise<User> {
    const user = await this.adminsRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async findAdminTarget(id: string): Promise<User> {
    const user = await this.findTarget(id);
    if (user.role !== UserRole.ADMIN) {
      throw new NotFoundException('Admin not found');
    }
    return user;
  }

  private present(user: User) {
    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phone: user.phone,
      role: user.role,
      isBlocked: user.isBlocked,
    };
  }

  private async guardConcurrentChange<T>(operation: Promise<T>): Promise<T> {
    try {
      return await operation;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025') {
        throw new ConflictException('Admin holati o‘zgargan; qayta yuklab ko‘ring');
      }
      throw error;
    }
  }
}

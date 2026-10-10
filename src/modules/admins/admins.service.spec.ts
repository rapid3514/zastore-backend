import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole, type User } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { AdminsService } from './admins.service.js';

const superAdminId = '11111111-1111-4111-8111-111111111111';
const adminId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const otherSuperAdminId = '44444444-4444-4444-8444-444444444444';

function user(id: string, role: UserRole, isBlocked = false): User {
  return {
    id,
    telegramId: BigInt(id.slice(0, 8)),
    firstName: role,
    lastName: null,
    username: null,
    phone: role === UserRole.GUEST ? null : '+998901234567',
    phoneVerifiedAt: role === UserRole.GUEST ? null : new Date(),
    avatarUrl: null,
    role,
    isBlocked,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createService(overrides: Partial<Record<string, User>> = {}) {
  const users: Record<string, User> = {
    [superAdminId]: user(superAdminId, UserRole.SUPER_ADMIN),
    [adminId]: user(adminId, UserRole.ADMIN),
    [customerId]: user(customerId, UserRole.CUSTOMER),
    [otherSuperAdminId]: user(otherSuperAdminId, UserRole.SUPER_ADMIN),
    ...overrides,
  };
  const repository = {
    findById: vi.fn((id: string) => Promise.resolve(users[id] ?? null)),
    listAdmins: vi.fn(),
    setRole: vi.fn((id: string, role: UserRole) =>
      Promise.resolve({ ...users[id], role }),
    ),
    setBlocked: vi.fn((id: string, isBlocked: boolean) =>
      Promise.resolve({ ...users[id], isBlocked }),
    ),
    updateProfile: vi.fn((id: string, data: Partial<User>) =>
      Promise.resolve({ ...users[id], ...data }),
    ),
  };
  return { service: new AdminsService(repository as never), repository };
}

describe('AdminsService', () => {
  it('promotes a customer to ADMIN', async () => {
    const { service, repository } = createService();

    await expect(service.promote(superAdminId, customerId)).resolves.toMatchObject({
      id: customerId,
      role: UserRole.ADMIN,
    });
    expect(repository.setRole).toHaveBeenCalledWith(customerId, UserRole.ADMIN, UserRole.CUSTOMER, false);
  });

  it.each([UserRole.ADMIN, UserRole.CUSTOMER])(
    'does not allow %s to promote users',
    async (role) => {
      const actorId = role === UserRole.ADMIN ? adminId : customerId;
      const { service } = createService();
      await expect(service.promote(actorId, customerId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('demotes an ADMIN to CUSTOMER', async () => {
    const { service, repository } = createService();

    await expect(service.demote(superAdminId, adminId)).resolves.toMatchObject({
      id: adminId,
      role: UserRole.CUSTOMER,
    });
    expect(repository.setRole).toHaveBeenCalledWith(
      adminId,
      UserRole.CUSTOMER,
      UserRole.ADMIN,
      false,
    );
  });

  it('does not demote another SUPER_ADMIN', async () => {
    const { service } = createService();
    await expect(
      service.demote(superAdminId, otherSuperAdminId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let a SUPER_ADMIN demote themselves', async () => {
    const { service } = createService();
    await expect(
      service.demote(superAdminId, superAdminId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks and unblocks an ADMIN', async () => {
    const { service, repository } = createService();
    await expect(service.block(superAdminId, adminId)).resolves.toMatchObject({
      isBlocked: true,
    });
    expect(repository.setBlocked).toHaveBeenCalledWith(adminId, true, false);
  });

  it('unblocks a blocked ADMIN', async () => {
    const { service, repository } = createService({
      [adminId]: user(adminId, UserRole.ADMIN, true),
    });
    await expect(service.unblock(superAdminId, adminId)).resolves.toMatchObject({
      isBlocked: false,
    });
    expect(repository.setBlocked).toHaveBeenCalledWith(adminId, false, true);
  });

  it('does not block another SUPER_ADMIN', async () => {
    const { service } = createService();
    await expect(
      service.block(superAdminId, otherSuperAdminId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports a concurrent admin role change as a conflict', async () => {
    const { service, repository } = createService();
    repository.setBlocked.mockRejectedValueOnce({ code: 'P2025' });
    await expect(service.block(superAdminId, adminId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not promote a SUPER_ADMIN', async () => {
    const { service } = createService();
    await expect(
      service.promote(superAdminId, otherSuperAdminId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('edits only allow-listed admin profile fields', async () => {
    const { service, repository } = createService();
    await service.update(superAdminId, adminId, {
      firstName: 'Updated Admin',
      role: UserRole.SUPER_ADMIN,
    } as never);
    expect(repository.updateProfile).toHaveBeenCalledWith(adminId, {
      firstName: 'Updated Admin',
    });
  });

  it('rejects a blocked ADMIN profile', async () => {
    const { service } = createService({
      [adminId]: user(adminId, UserRole.ADMIN, true),
    });
    await expect(service.me(adminId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not promote a blocked customer', async () => {
    const { service } = createService({
      [customerId]: user(customerId, UserRole.CUSTOMER, true),
    });
    await expect(
      service.promote(superAdminId, customerId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

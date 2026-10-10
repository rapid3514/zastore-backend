import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';

function context(role: UserRole): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user: { sub: 'user-id', telegramId: '123', role },
      }),
    }),
  } as unknown as ExecutionContext;
}

function guard(requiredRoles: UserRole[], databaseRole: UserRole) {
  return new RolesGuard(
    { getAllAndOverride: () => requiredRoles } as never,
    {
      findById: vi.fn().mockResolvedValue({
        id: 'user-id',
        role: databaseRole,
        isBlocked: false,
      }),
    } as never,
  );
}

describe('RolesGuard exact role matching', () => {
  it('allows ADMIN on a shop-operator endpoint', async () => {
    await expect(
      guard([UserRole.ADMIN], UserRole.ADMIN).canActivate(
        context(UserRole.ADMIN),
      ),
    ).resolves.toBe(true);
  });

  it('denies SUPER_ADMIN on an ADMIN-only shop endpoint', async () => {
    await expect(
      guard([UserRole.ADMIN], UserRole.SUPER_ADMIN).canActivate(
        context(UserRole.SUPER_ADMIN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows only roles explicitly listed in @Roles()', async () => {
    await expect(
      guard(
        [UserRole.CUSTOMER, UserRole.ADMIN],
        UserRole.SUPER_ADMIN,
      ).canActivate(context(UserRole.SUPER_ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an old ADMIN token after the database role was demoted', async () => {
    await expect(
      guard([UserRole.ADMIN], UserRole.CUSTOMER).canActivate(
        context(UserRole.ADMIN),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a blocked database user despite a signed privileged role', async () => {
    const blocked = new RolesGuard(
      { getAllAndOverride: () => [UserRole.ADMIN] } as never,
      {
        findById: vi
          .fn()
          .mockResolvedValue({
            id: 'user-id',
            role: UserRole.ADMIN,
            isBlocked: true,
          }),
      } as never,
    );
    await expect(
      blocked.canActivate(context(UserRole.ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a signed token whose user no longer exists', async () => {
    const removed = new RolesGuard(
      { getAllAndOverride: () => [UserRole.CUSTOMER] } as never,
      { findById: vi.fn().mockResolvedValue(null) } as never,
    );
    await expect(
      removed.canActivate(context(UserRole.CUSTOMER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

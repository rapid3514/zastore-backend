import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { describe, expect, it } from 'vitest';
import { AuditController } from './audit.controller.js';

describe('AuditController authorization metadata', () => {
  it('exposes audit logs only to SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AuditController)).toEqual([
      UserRole.SUPER_ADMIN,
    ]);
  });

  it.each([
    ['allows SUPER_ADMIN', UserRole.SUPER_ADMIN, true],
    ['denies ADMIN', UserRole.ADMIN, false],
    ['denies CUSTOMER', UserRole.CUSTOMER, false],
  ])('%s', async (_label, role, allowed) => {
    const guard = new RolesGuard(new Reflector(), {
      findById: async () => ({ id: 'user-id', role, isBlocked: false }),
    } as never);
    const context = {
      getHandler: () => () => undefined,
      getClass: () => AuditController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'user-id', telegramId: '123', role },
        }),
      }),
    } as unknown as ExecutionContext;

    if (allowed) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    } else {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
});

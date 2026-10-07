import { Logger } from '@nestjs/common';
import { AuditAction, AuditEntityType } from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  const repository = { create: vi.fn(), list: vi.fn() };
  let service: AuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.create.mockResolvedValue({ id: 'audit-id' });
    service = new AuditService(repository as never);
  });

  it('writes an admin action and removes sensitive metadata', async () => {
    await service.log({
      actorUserId: '11111111-1111-4111-8111-111111111111',
      action: AuditAction.ORDER_CONFIRM,
      entityType: AuditEntityType.ORDER,
      entityId: 'order-id',
      metadata: {
        status: 'CONFIRMED',
        password: 'must-not-be-stored',
        refreshToken: 'must-not-be-stored',
        BOT_TOKEN: 'must-not-be-stored',
        SECRET: 'must-not-be-stored',
        token: 'must-not-be-stored',
        IMAGEKIT_PRIVATE_KEY: 'must-not-be-stored',
        signature: 'must-not-be-stored',
        nested: { jwtSecret: 'hidden', safe: true },
      },
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ORDER_CONFIRM,
        metadata: { status: 'CONFIRMED', nested: { safe: true } },
      }),
    );
  });

  it('does not fail a completed business operation when audit storage is down', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repository.create.mockRejectedValue(new Error('database error'));

    await expect(
      service.log({
        actorUserId: '11111111-1111-4111-8111-111111111111',
        action: AuditAction.PRODUCT_UPDATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: 'product-id',
      }),
    ).resolves.toBeUndefined();
  });
});

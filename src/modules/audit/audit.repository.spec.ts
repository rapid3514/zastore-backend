import { AuditAction, AuditEntityType } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { AuditRepository } from './audit.repository.js';

describe('AuditRepository', () => {
  it('applies filters and pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(25);
    const repository = new AuditRepository({
      auditLog: { findMany, count },
    } as never);

    const result = await repository.list({
      page: 2,
      limit: 10,
      actorUserId: '11111111-1111-4111-8111-111111111111',
      action: AuditAction.ORDER_CONFIRM,
      entityType: AuditEntityType.ORDER,
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: '2026-10-02T23:59:59.999Z',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actorUserId: '11111111-1111-4111-8111-111111111111',
          action: AuditAction.ORDER_CONFIRM,
          entityType: AuditEntityType.ORDER,
          createdAt: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-02T23:59:59.999Z'),
          },
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(result).toMatchObject({ total: 25, page: 2, limit: 10 });
  });
});

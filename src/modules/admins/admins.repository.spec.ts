import { UserRole } from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { AdminsRepository } from './admins.repository.js';

describe('AdminsRepository', () => {
  it('lists only users whose exact role is ADMIN', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new AdminsRepository({ user: { findMany } } as never);

    await repository.listAdmins();

    expect(findMany).toHaveBeenCalledWith({
      where: { role: UserRole.ADMIN },
      orderBy: { createdAt: 'asc' },
    });
  });
});

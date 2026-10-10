import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/client.js';
import { AdminsRepository } from './admins.repository.js';

describe('AdminsRepository conditional authorization writes', () => {
  it('requires the inspected role and block state when promoting', async () => {
    const update = vi.fn().mockResolvedValue({});
    const repository = new AdminsRepository({ user: { update } } as never);
    await repository.setRole('user-id', UserRole.ADMIN, UserRole.CUSTOMER, false);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-id', role: UserRole.CUSTOMER, isBlocked: false },
      data: { role: UserRole.ADMIN },
    });
  });

  it('cannot block a user who was demoted after the read', async () => {
    const update = vi.fn().mockResolvedValue({});
    const repository = new AdminsRepository({ user: { update } } as never);
    await repository.setBlocked('user-id', true, false);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-id', role: UserRole.ADMIN, isBlocked: false },
      data: { isBlocked: true },
    });
  });
});

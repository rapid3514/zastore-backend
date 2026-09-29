import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/client.js';
import { UsersRepository } from './users.repository.js';

describe('UsersRepository.list', () => {
  it('filters by role and searches user fields, including numeric Telegram ID', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new UsersRepository({
      user: { findMany, count },
    } as never);

    await repository.list({
      page: 2,
      limit: 5,
      role: UserRole.ADMIN,
      search: '99890',
    });

    const args = findMany.mock.calls[0][0];
    expect(args.where.role).toBe(UserRole.ADMIN);
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { firstName: { contains: '99890', mode: 'insensitive' } },
        { lastName: { contains: '99890', mode: 'insensitive' } },
        { username: { contains: '99890', mode: 'insensitive' } },
        { phone: { contains: '99890', mode: 'insensitive' } },
        { telegramId: 99890n },
      ]),
    );
    expect(args).toMatchObject({
      skip: 5,
      take: 5,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(args.select).not.toHaveProperty('refreshSessions');
    expect(count).toHaveBeenCalledWith({ where: args.where });
  });

  it('forces CUSTOMER role and applies the offline filter independently of query role', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const repository = new UsersRepository({
      user: { findMany, count },
    } as never);
    const onlineSince = new Date('2026-09-29T11:58:00.000Z');

    await repository.list(
      { role: UserRole.ADMIN, online: false },
      { forcedRole: UserRole.CUSTOMER, onlineSince },
    );

    const where = findMany.mock.calls[0][0].where;
    expect(where.role).toBe(UserRole.CUSTOMER);
    expect(where.AND).toEqual([
      {
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: onlineSince } }],
      },
    ]);
    expect(count).toHaveBeenCalledWith({ where });
  });
});

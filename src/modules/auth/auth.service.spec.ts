import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '../../generated/prisma/client.js';
import { AuthService } from './auth.service.js';

const activeUser = {
  id: '18c613c5-5629-4821-8b41-59e555030ee8',
  telegramId: 123n,
  firstName: 'Customer',
  lastName: null,
  username: null,
  phone: '+998901234567',
  phoneVerifiedAt: new Date(),
  avatarUrl: null,
  role: UserRole.CUSTOMER,
  isBlocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createService(overrides: Record<string, unknown> = {}) {
  const users = {
    findByTelegramId: vi.fn(),
    findById: vi.fn(),
  };
  const repository = {
    createRefreshSession: vi.fn(),
    findRefreshSession: vi.fn(),
    revokeRefreshSession: vi.fn(),
  };
  const telegram = { verify: vi.fn().mockReturnValue({ id: 123n }) };
  const tokens = {
    signAccess: vi.fn().mockResolvedValue('access-token'),
    signRefresh: vi.fn().mockResolvedValue('new-refresh-token'),
    verifyRefresh: vi.fn(),
    refreshExpiresAt: vi
      .fn()
      .mockReturnValue(new Date(Date.now() + 86_400_000)),
  };
  Object.assign(users, overrides.users);
  Object.assign(repository, overrides.repository);
  Object.assign(telegram, overrides.telegram);
  Object.assign(tokens, overrides.tokens);
  return {
    service: new AuthService(
      users as never,
      repository as never,
      telegram as never,
      tokens as never,
    ),
    users,
    repository,
    tokens,
  };
}

describe('AuthService', () => {
  it('returns registrationRequired when the customer does not exist', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue(null);
    await expect(
      service.authenticateCustomer('init-data'),
    ).resolves.toMatchObject({
      body: { registered: false, registrationRequired: true },
    });
  });

  it('returns registrationRequired when the user has no phone', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue({
      ...activeUser,
      phone: null,
      phoneVerifiedAt: null,
    });

    await expect(
      service.authenticateCustomer('init-data'),
    ).resolves.toEqual({
      body: { registered: false, registrationRequired: true },
    });
  });

  it('returns registrationRequired when the phone is not verified', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue({
      ...activeUser,
      phoneVerifiedAt: null,
    });

    await expect(
      service.authenticateCustomer('init-data'),
    ).resolves.toEqual({
      body: { registered: false, registrationRequired: true },
    });
  });

  it('authenticates only a user with a verified phone', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue(activeUser);

    await expect(
      service.authenticateCustomer('init-data'),
    ).resolves.toMatchObject({
      body: { registered: true, accessToken: 'access-token' },
    });
  });

  it('rejects blocked customers', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue({
      ...activeUser,
      isBlocked: true,
    });
    await expect(
      service.authenticateCustomer('init-data'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a non-admin from the admin login', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue(activeUser);
    await expect(service.authenticateAdmin('init-data')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('includes the database role in the JWT payload', async () => {
    const { service, users, tokens } = createService();
    users.findByTelegramId.mockResolvedValue({
      ...activeUser,
      role: UserRole.ADMIN,
    });

    await service.authenticateCustomer('init-data');

    expect(tokens.signAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: activeUser.id,
        telegramId: '123',
        role: UserRole.ADMIN,
      }),
    );
  });

  it('rotates a valid refresh session', async () => {
    const { service, users, repository, tokens } = createService();
    const token = 'valid-refresh-token';
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      tokenHash: await argon2.hash(token),
      userId: activeUser.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    users.findById.mockResolvedValue(activeUser);

    await expect(service.refresh(token)).resolves.toMatchObject({
      body: { accessToken: 'access-token' },
    });
    expect(repository.revokeRefreshSession).toHaveBeenCalledWith('session-id');
    expect(repository.createRefreshSession).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'revoked',
      { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) },
    ],
    ['expired', { revokedAt: null, expiresAt: new Date(Date.now() - 60_000) }],
  ])('rejects a %s refresh session', async (_label, state) => {
    const { service, repository, tokens } = createService();
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      tokenHash: await argon2.hash('refresh-token'),
      userId: activeUser.id,
      ...state,
    });
    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

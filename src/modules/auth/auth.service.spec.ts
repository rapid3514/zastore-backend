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
    rotateRefreshSession: vi.fn().mockResolvedValue(true),
    revokeRefreshFamily: vi.fn(),
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

    await expect(service.authenticateCustomer('init-data')).resolves.toEqual({
      body: { registered: false, registrationRequired: true },
    });
  });

  it('returns registrationRequired when the phone is not verified', async () => {
    const { service, users } = createService();
    users.findByTelegramId.mockResolvedValue({
      ...activeUser,
      phoneVerifiedAt: null,
    });

    await expect(service.authenticateCustomer('init-data')).resolves.toEqual({
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
      fid: 'family-id',
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      tokenHash: await argon2.hash(token),
      userId: activeUser.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    users.findById.mockResolvedValue(activeUser);

    await expect(service.refresh(token)).resolves.toMatchObject({
      body: { accessToken: 'access-token' },
    });
    expect(repository.rotateRefreshSession).toHaveBeenCalledWith(
      'session-id',
      expect.objectContaining({
        familyId: 'family-id',
        parentId: 'session-id',
        userId: activeUser.id,
      }),
    );
    expect(repository.createRefreshSession).not.toHaveBeenCalled();
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
      fid: 'family-id',
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      tokenHash: await argon2.hash('refresh-token'),
      userId: activeUser.id,
      ...state,
    });
    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokes a matching refresh session on logout', async () => {
    const { service, repository, tokens } = createService();
    const refreshToken = 'valid-refresh-token';
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      fid: 'family-id',
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      tokenHash: await argon2.hash(refreshToken),
      userId: activeUser.id,
      revokedAt: null,
    });

    await service.logout(refreshToken);

    expect(repository.revokeRefreshFamily).toHaveBeenCalledWith('family-id', activeUser.id);
  });

  it('revokes the replacement when logout races with refresh rotation', async () => {
    const { service, repository, tokens } = createService();
    const refreshToken = 'consumed-refresh-token';
    tokens.verifyRefresh.mockResolvedValue({ sid: 'session-id', fid: 'family-id', sub: activeUser.id });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id', familyId: 'family-id', userId: activeUser.id,
      tokenHash: await argon2.hash(refreshToken), revokedAt: new Date(),
    });

    await service.logout(refreshToken);

    expect(repository.revokeRefreshFamily).toHaveBeenCalledWith('family-id', activeUser.id);
  });

  it('revokes every active family session when a previously consumed token is replayed', async () => {
    const { service, repository, tokens } = createService();
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      fid: 'family-id',
      sub: activeUser.id,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      userId: activeUser.id,
      tokenHash: await argon2.hash('refresh-token'),
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.revokeRefreshFamily).toHaveBeenCalledWith(
      'family-id',
      activeUser.id,
    );
    expect(repository.rotateRefreshSession).not.toHaveBeenCalled();
  });

  it('allows exactly one parallel consume and preserves its replacement when the loser observed an active token', async () => {
    const { service, users, repository, tokens } = createService();
    const tokenHash = await argon2.hash('refresh-token');
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      fid: 'family-id',
      sub: activeUser.id,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      userId: activeUser.id,
      tokenHash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    users.findById.mockResolvedValue(activeUser);
    let consumed = false;
    repository.rotateRefreshSession.mockImplementation(() => {
      if (consumed) return Promise.resolve(false);
      consumed = true;
      return Promise.resolve(true);
    });
    const results = await Promise.allSettled([
      service.refresh('refresh-token'),
      service.refresh('refresh-token'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.revokeRefreshFamily).not.toHaveBeenCalled();
  });

  it('does not revoke a family when an attacker supplies a mismatching token hash', async () => {
    const { service, repository, tokens } = createService();
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      fid: 'family-id',
      sub: activeUser.id,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      userId: activeUser.id,
      tokenHash: await argon2.hash('real-refresh-token'),
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      service.refresh('different-refresh-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.revokeRefreshFamily).not.toHaveBeenCalled();
  });

  it('rejects access and refresh for a user blocked after login', async () => {
    const { service, users, repository, tokens } = createService();
    users.findById.mockResolvedValue({ ...activeUser, isBlocked: true });
    await expect(
      service.me({
        sub: activeUser.id,
        telegramId: '123',
        role: UserRole.CUSTOMER,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    tokens.verifyRefresh.mockResolvedValue({
      sid: 'session-id',
      fid: 'family-id',
      sub: activeUser.id,
    });
    repository.findRefreshSession.mockResolvedValue({
      id: 'session-id',
      familyId: 'family-id',
      userId: activeUser.id,
      tokenHash: await argon2.hash('refresh-token'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.refresh('refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repository.revokeRefreshFamily).toHaveBeenCalledWith(
      'family-id',
      activeUser.id,
    );
    expect(repository.rotateRefreshSession).not.toHaveBeenCalled();
  });

  it('returns the current safe user and rejects a missing user', async () => {
    const { service, users } = createService();
    users.findById.mockResolvedValue(activeUser);

    const result = await service.me({
      sub: activeUser.id,
      telegramId: '123',
      role: UserRole.CUSTOMER,
    });
    expect(result.user).toMatchObject({
      id: activeUser.id,
      role: UserRole.CUSTOMER,
    });
    expect(result.user).not.toHaveProperty('tokenHash');

    users.findById.mockResolvedValue(null);
    await expect(
      service.me({
        sub: activeUser.id,
        telegramId: '123',
        role: UserRole.CUSTOMER,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

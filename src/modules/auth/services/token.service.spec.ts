import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import {
  createConfigService,
  testConfiguration,
} from '../../../../test/helpers/config.js';
import { UserRole } from '../../../generated/prisma/client.js';
import { readAccessClaims, TokenService } from './token.service.js';

const payload = {
  sub: '11111111-1111-4111-8111-111111111111',
  telegramId: '123',
  role: UserRole.CUSTOMER,
  sid: '22222222-2222-4222-8222-222222222222',
  fid: '22222222-2222-4222-8222-222222222222',
};

describe('JWT purpose, integrity, expiration and audience', () => {
  const jwt = new JwtService();
  const config = testConfiguration().auth;
  const service = new TokenService(jwt, createConfigService());

  it('issues explicitly scoped access and refresh claims', async () => {
    const access = await service.signAccess(payload);
    const refresh = await service.signRefresh(payload);
    expect(jwt.verify(access, { secret: config.accessSecret })).toMatchObject({
      type: 'access',
      iss: config.issuer,
      aud: config.audience,
    });
    expect(await service.verifyRefresh(refresh)).toMatchObject({
      ...payload,
      type: 'refresh',
    });
    expect(
      readAccessClaims(jwt.verify(access, { secret: config.accessSecret })),
    ).toEqual({ sub: payload.sub, telegramId: '123', role: UserRole.CUSTOMER });
  });

  it('rejects access tokens on refresh and refresh tokens on access', async () => {
    await expect(
      service.verifyRefresh(await service.signAccess(payload)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(() =>
      readAccessClaims(
        jwt.decode(
          jwt.sign(
            { ...payload, type: 'refresh' },
            { secret: config.accessSecret, expiresIn: '1m' },
          ),
        ),
      ),
    ).toThrow(UnauthorizedException);
    // Even a token signed using the correct refresh key cannot cross purpose.
    const wrongPurpose = jwt.sign(
      { ...payload, type: 'access' },
      {
        secret: config.refreshSecret,
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: '1m',
      },
    );
    await expect(service.verifyRefresh(wrongPurpose)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['wrong algorithm', { algorithm: 'HS384' as const }],
    ['wrong issuer', { issuer: 'untrusted-issuer' }],
    ['wrong audience', { audience: 'untrusted-audience' }],
    ['expired token', { expiresIn: -1 }],
  ])('rejects %s', async (_label, overrides) => {
    const token = jwt.sign(
      { ...payload, type: 'refresh' },
      {
        secret: config.refreshSecret,
        algorithm: 'HS256',
        issuer: config.issuer,
        audience: config.audience,
        expiresIn: '1m',
        ...overrides,
      },
    );
    await expect(service.verifyRefresh(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('requires expiration on every token', async () => {
    const refresh = jwt.sign(
      { ...payload, type: 'refresh' },
      {
        secret: config.refreshSecret,
        issuer: config.issuer,
        audience: config.audience,
      },
    );
    await expect(service.verifyRefresh(refresh)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(() =>
      readAccessClaims({
        ...payload,
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a modified signature', async () => {
    const token = await service.signRefresh(payload);
    const [header, body, signature] = token.split('.');
    const modified = `${header}.${body}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(service.verifyRefresh(modified)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

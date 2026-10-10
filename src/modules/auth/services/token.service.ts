import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { getConfiguration } from '../../../config/configuration.js';
import { UserRole } from '../../../generated/prisma/client.js';

export interface AccessTokenPayload {
  sub: string;
  telegramId: string;
  role: UserRole;
}

export interface RefreshTokenPayload extends AccessTokenPayload {
  sid: string;
  fid: string;
}

const tokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  telegramId: z.string().regex(/^\d+$/),
  role: z.enum(UserRole),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
});
const accessClaimsSchema = tokenClaimsSchema.extend({
  type: z.literal('access'),
});
const refreshClaimsSchema = tokenClaimsSchema.extend({
  type: z.literal('refresh'),
  sid: z.string().uuid(),
  fid: z.string().uuid(),
});

export type AccessTokenClaims = z.infer<typeof accessClaimsSchema>;
export type RefreshTokenClaims = z.infer<typeof refreshClaimsSchema>;

export function readAccessClaims(value: unknown): AccessTokenPayload {
  const result = accessClaimsSchema.safeParse(value);
  if (!result.success || result.data.exp <= Math.floor(Date.now() / 1000)) {
    throw new UnauthorizedException('Invalid access token');
  }
  return {
    sub: result.data.sub,
    telegramId: result.data.telegramId,
    role: result.data.role,
  };
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccess(payload: AccessTokenPayload): Promise<string> {
    const config = getConfiguration(this.configService).auth;
    return this.jwtService.signAsync(
      { ...payload, type: 'access' },
      {
        secret: config.accessSecret,
        expiresIn: config.accessExpiresIn as SignOptions['expiresIn'],
        algorithm: 'HS256',
        issuer: config.issuer,
        audience: config.audience,
      },
    );
  }

  signRefresh(payload: RefreshTokenPayload): Promise<string> {
    const config = getConfiguration(this.configService).auth;
    return this.jwtService.signAsync(
      { ...payload, type: 'refresh' },
      {
        secret: config.refreshSecret,
        expiresIn: config.refreshExpiresIn as SignOptions['expiresIn'],
        algorithm: 'HS256',
        issuer: config.issuer,
        audience: config.audience,
      },
    );
  }

  async verifyRefresh(token: string): Promise<RefreshTokenClaims> {
    try {
      const config = getConfiguration(this.configService).auth;
      const verified: unknown = await this.jwtService.verifyAsync(token, {
        secret: config.refreshSecret,
        algorithms: ['HS256'],
        issuer: config.issuer,
        audience: config.audience,
        ignoreExpiration: false,
      });
      const payload = refreshClaimsSchema.parse(verified);
      if (payload.exp <= Math.floor(Date.now() / 1000))
        throw new Error('Expired refresh session');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh session');
    }
  }

  refreshExpiresAt(): Date {
    const value = getConfiguration(this.configService).auth.refreshExpiresIn;
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error('Invalid refresh token expiration');
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + Number(match[1]) * multipliers[match[2]]);
  }
}

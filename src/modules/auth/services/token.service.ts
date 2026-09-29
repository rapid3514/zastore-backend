import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { SignOptions } from 'jsonwebtoken';
import type { UserRole } from '../../../generated/prisma/client.js';

export interface AccessTokenPayload {
  sub: string;
  telegramId: string;
  role: UserRole;
}

export interface RefreshTokenPayload extends AccessTokenPayload {
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccess(payload: AccessTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.getOrThrow<string>(
        'JWT_ACCESS_EXPIRES_IN',
      ) as SignOptions['expiresIn'],
    });
  }

  signRefresh(payload: RefreshTokenPayload): Promise<string> {
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.getOrThrow<string>(
        'JWT_REFRESH_EXPIRES_IN',
      ) as SignOptions['expiresIn'],
    });
  }

  async verifyRefresh(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh session');
    }
  }

  refreshExpiresAt(): Date {
    const value = this.configService.getOrThrow<string>(
      'JWT_REFRESH_EXPIRES_IN',
    );
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error('Invalid JWT_REFRESH_EXPIRES_IN');
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(Date.now() + Number(match[1]) * multipliers[match[2]]);
  }
}

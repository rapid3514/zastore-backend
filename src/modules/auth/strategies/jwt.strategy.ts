import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '../../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../../common/types/auth-user.type.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: AuthenticatedUser): AuthenticatedUser {
    if (
      !payload?.sub ||
      !payload.telegramId ||
      !Object.values(UserRole).includes(payload.role)
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    return {
      sub: payload.sub,
      telegramId: payload.telegramId,
      role: payload.role,
    };
  }
}

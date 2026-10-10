import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getConfiguration } from '../../../config/configuration.js';
import { readAccessClaims } from '../services/token.service.js';
import type { AuthenticatedUser } from '../../../common/types/auth-user.type.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const config = getConfiguration(configService).auth;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
    });
  }

  validate(payload: unknown): AuthenticatedUser {
    return readAccessClaims(payload);
  }
}

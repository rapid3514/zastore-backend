import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { UsersModule } from '../users/users.module.js';

import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

import { TelegramInitDataService } from './services/telegram-init-data.service.js';
import { TokenService } from './services/token.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),

    JwtModule.register({}),
  ],

  controllers: [AuthController],

  providers: [
    AuthRepository,
    AuthService,
    TelegramInitDataService,
    TokenService,
    JwtStrategy,
  ],
})
export class AuthModule {}

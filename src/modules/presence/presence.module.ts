import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { PresenceController } from './presence.controller.js';
import { PresenceService } from './presence.service.js';

@Module({
  imports: [UsersModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [PresenceController],
  providers: [PresenceService, JwtAuthGuard, RolesGuard],
})
export class PresenceModule {}

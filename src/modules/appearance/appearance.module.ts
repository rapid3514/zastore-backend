import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { MediaModule } from '../media/media.module.js';
import { UsersModule } from '../users/users.module.js';
import { AppearanceController } from './appearance.controller.js';
import { AppearanceService } from './appearance.service.js';

@Module({
  imports: [MediaModule, UsersModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [AppearanceController],
  providers: [AppearanceService, JwtAuthGuard, RolesGuard],
})
export class AppearanceModule {}

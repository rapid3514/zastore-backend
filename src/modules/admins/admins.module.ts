import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { AdminsController } from './admins.controller.js';
import { AdminsRepository } from './admins.repository.js';
import { AdminsService } from './admins.service.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [AdminsController],
  providers: [AdminsRepository, AdminsService, JwtAuthGuard, RolesGuard],
  exports: [AdminsService],
})
export class AdminsModule {}

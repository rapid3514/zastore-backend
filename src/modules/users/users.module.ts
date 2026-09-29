import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { AdminCustomersController } from './admin-customers.controller.js';
import { SuperAdminUsersController } from './super-admin-users.controller.js';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [
    UsersController,
    AdminCustomersController,
    SuperAdminUsersController,
  ],
  providers: [UsersRepository, UsersService, JwtAuthGuard, RolesGuard],
  exports: [UsersService],
})
export class UsersModule {}

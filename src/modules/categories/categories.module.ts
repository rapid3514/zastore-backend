import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { CategoriesController } from './categories.controller.js';
import { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';

@Module({
  imports: [UsersModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [CategoriesController],
  providers: [
    CategoriesRepository,
    CategoriesService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}

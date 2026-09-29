import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [UsersModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [ProductsController],
  providers: [ProductsRepository, ProductsService, JwtAuthGuard, RolesGuard],
})
export class ProductsModule {}

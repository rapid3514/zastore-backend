import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { MediaModule } from '../media/media.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { ProductTelegramPublisherService } from './product-telegram-publisher.service.js';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    MediaModule,
    TelegramModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [ProductsController],
  providers: [
    ProductsRepository,
    ProductsService,
    ProductTelegramPublisherService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class ProductsModule {}

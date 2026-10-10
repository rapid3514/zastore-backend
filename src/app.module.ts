import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import configuration from './config/configuration.js';
import { SecurityModule } from './common/security/security.module.js';
import { RateLimitStorage } from './common/security/rate-limit.storage.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AdminsModule } from './modules/admins/admins.module.js';
import { TelegramModule } from './modules/telegram/telegram.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { ProductsModule } from './modules/products/products.module.js';
import { WorkHoursModule } from './modules/work-hours/work-hours.module.js';
import { PresenceModule } from './modules/presence/presence.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { MediaModule } from './modules/media/media.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
    }),
    SecurityModule,
    ThrottlerModule.forRootAsync({
      imports: [SecurityModule],
      inject: [RateLimitStorage],
      useFactory: (storage: RateLimitStorage) => ({
        storage,
        throttlers: [{
          ttl: 60_000,
          limit: (context) => {
            const request = context.switchToHttp().getRequest<Request>();
            if (request.path.endsWith('/telegram/webhook')) return 600;
            if (request.path.includes('/auth/refresh')) return 20;
            if (request.path.includes('/auth/')) return 10;
            if (request.method !== 'GET' && /\/(orders|payments)(\/|$)/.test(request.path)) return 30;
            return 120;
          },
          skipIf: (context) => context.switchToHttp().getRequest<Request>().path === '/health',
        }],
      }),
    }),
    DatabaseModule,
    UsersModule,
    AdminsModule,
    AuthModule,
    TelegramModule,
    CategoriesModule,
    ProductsModule,
    OrdersModule,
    WorkHoursModule,
    PresenceModule,
    NotificationsModule,
    PaymentsModule,
    MediaModule,
    AuditModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

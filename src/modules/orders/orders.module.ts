import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { WorkHoursModule } from '../work-hours/work-hours.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';
import { OrdersExpirationWorker } from './orders-expiration.worker.js';

@Module({
  imports: [
    UsersModule,
    WorkHoursModule,
    AuditModule,
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [OrdersController],
  providers: [
    OrdersRepository,
    OrdersService,
    OrdersExpirationWorker,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class OrdersModule {}

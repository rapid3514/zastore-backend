import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { WorkHoursModule } from '../work-hours/work-hours.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [
    UsersModule,
    WorkHoursModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
  ],
  controllers: [OrdersController],
  providers: [OrdersRepository, OrdersService, JwtAuthGuard, RolesGuard],
})
export class OrdersModule {}

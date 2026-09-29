import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UsersModule } from '../users/users.module.js';
import { WorkHoursController } from './work-hours.controller.js';
import { WorkHoursRepository } from './work-hours.repository.js';
import { WorkHoursService } from './work-hours.service.js';

@Module({
  imports: [UsersModule, PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [WorkHoursController],
  providers: [WorkHoursRepository, WorkHoursService, JwtAuthGuard, RolesGuard],
  exports: [WorkHoursService],
})
export class WorkHoursModule {}

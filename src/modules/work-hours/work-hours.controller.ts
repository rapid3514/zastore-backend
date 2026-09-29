import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { WorkHoursService } from './work-hours.service.js';

@Controller('work-hours')
export class WorkHoursController {
  constructor(private readonly workHoursService: WorkHoursService) {}

  @Get('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getManageSchedule() {
    return this.workHoursService.getSchedule();
  }

  @Put('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateManageSchedule(@Body() body: Array<{ dayOfWeek: string; isOpen: boolean; openTime?: string | null; closeTime?: string | null }>) {
    const entries = body.map((entry) => ({
      dayOfWeek: entry.dayOfWeek as any,
      isOpen: entry.isOpen,
      openTime: entry.openTime ?? null,
      closeTime: entry.closeTime ?? null,
    }));
    return this.workHoursService.updateSchedule(entries);
  }

  @Patch('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  patchManageSchedule(@Body() body: Array<{ dayOfWeek: string; isOpen: boolean; openTime?: string | null; closeTime?: string | null }>) {
    return this.updateManageSchedule(body);
  }

  @Get('status')
  getStatus() {
    return this.workHoursService.getCurrentStatus();
  }
}

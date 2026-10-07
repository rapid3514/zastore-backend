import {
  Body,
  Controller,
  Get,
  ParseArrayPipe,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { WorkHoursService } from './work-hours.service.js';
import { WorkHourEntryDto } from './dto/work-hour-entry.dto.js';

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
  updateManageSchedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ParseArrayPipe({ items: WorkHourEntryDto }))
    body: WorkHourEntryDto[],
  ) {
    return this.workHoursService.updateSchedule(body, actor.sub);
  }

  @Patch('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  patchManageSchedule(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ParseArrayPipe({ items: WorkHourEntryDto }))
    body: WorkHourEntryDto[],
  ) {
    return this.workHoursService.updateSchedule(body, actor.sub);
  }

  @Get('status')
  getStatus() {
    return this.workHoursService.getCurrentStatus();
  }
}

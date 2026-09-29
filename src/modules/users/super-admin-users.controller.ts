import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import { QueryUsersDto } from './dto/query-users.dto.js';
import { UsersService } from './users.service.js';

@Controller('super-admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('dashboard/stats')
  stats() {
    return this.usersService.superAdminStats();
  }

  @Get('users')
  list(@Query() query: QueryUsersDto) {
    return this.usersService.listForSuperAdmin(query);
  }
}

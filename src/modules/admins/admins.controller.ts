import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { AdminsService } from './admins.service.js';
import { UpdateAdminDto } from './dto/update-admin.dto.js';

@Controller('admins')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get('me')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.adminsService.me(actor.sub);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.adminsService.list(actor.sub);
  }

  @Get(':userId')
  @Roles(UserRole.SUPER_ADMIN)
  getById(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminsService.getById(actor.sub, userId);
  }

  @Patch(':userId/promote')
  @Roles(UserRole.SUPER_ADMIN)
  promote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminsService.promote(actor.sub, userId);
  }

  @Patch(':userId/demote')
  @Roles(UserRole.SUPER_ADMIN)
  demote(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminsService.demote(actor.sub, userId);
  }

  @Patch(':userId/block')
  @Roles(UserRole.SUPER_ADMIN)
  block(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminsService.block(actor.sub, userId);
  }

  @Patch(':userId/unblock')
  @Roles(UserRole.SUPER_ADMIN)
  unblock(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminsService.unblock(actor.sub, userId);
  }

  @Patch(':userId')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() input: UpdateAdminDto,
  ) {
    return this.adminsService.update(actor.sub, userId, input);
  }
}

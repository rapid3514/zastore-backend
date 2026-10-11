import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { UserRole } from '../../generated/prisma/client.js';
import { AppearanceService } from './appearance.service.js';
import { UpdateAppearanceDto } from './dto/update-appearance.dto.js';

@Controller('appearance')
export class AppearanceController {
  constructor(private readonly appearance: AppearanceService) {}

  @Get()
  findPublic() {
    return this.appearance.findPublic();
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Body() input: UpdateAppearanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.appearance.update(input, actor.sub);
  }

  @Get('super-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  findSuperAdmin() {
    return this.appearance.findSuperAdmin();
  }

  @Patch('super-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  updateSuperAdmin(@Body() input: UpdateAppearanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.appearance.update(input, actor.sub, 'super-admin');
  }
}

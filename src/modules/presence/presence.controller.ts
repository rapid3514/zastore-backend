import { Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { UserRole } from '../../generated/prisma/client.js';
import { PresenceService } from './presence.service.js';

@Controller('presence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Post('ping')
  ping(@CurrentUser() user: AuthenticatedUser) {
    return this.presenceService.ping(user.sub);
  }
}

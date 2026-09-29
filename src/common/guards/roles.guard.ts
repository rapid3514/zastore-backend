import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/client.js';
import { UsersService } from '../../modules/users/users.service.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../types/auth-user.type.js';

@Injectable()
export class RolesGuard implements CanActivate {
  /**
   * Permission matrix uses exact roles, never hierarchy:
   * CUSTOMER = customer features; ADMIN = store operations only;
   * SUPER_ADMIN = admin management only.
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) throw new UnauthorizedException('Authentication is required');
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Admin role is required');
    }

    const currentUser = await this.usersService.findById(user.sub);
    if (
      !currentUser ||
      currentUser.isBlocked ||
      !requiredRoles.includes(currentUser.role)
    ) {
      throw new ForbiddenException('Admin access is not available');
    }
    return true;
  }
}

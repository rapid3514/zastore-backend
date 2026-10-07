import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { UserRole } from '../../generated/prisma/client.js';
import { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders/:orderId/payment')
  @Roles(UserRole.CUSTOMER)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.paymentsService.createForOrder(actor.sub, orderId);
  }

  @Get('orders/:orderId/payment')
  @Roles(UserRole.CUSTOMER)
  getForOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.paymentsService.getForOrder(actor.sub, orderId);
  }

  @Get('payments/manage')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  list(@Query() query: QueryPaymentsDto) {
    return this.paymentsService.list(query);
  }

  @Get('payments/manage/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getById(id);
  }
}

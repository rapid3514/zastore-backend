import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedUser } from '../../common/types/auth-user.type.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderReasonDto } from './dto/order-reason.dto.js';
import { QueryOrdersDto } from './dto/query-orders.dto.js';
import { UpdateOrderPhoneDto } from './dto/update-order-phone.dto.js';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() input: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (
      !idempotencyKey ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        idempotencyKey,
      )
    ) {
      throw new BadRequestException({
        error: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key UUID header is required',
      });
    }
    return this.ordersService.createOrder(
      actor,
      input,
      idempotencyKey.toLowerCase(),
    );
  }

  @Get('my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  myOrders(
    @CurrentUser() actor: AuthenticatedUser,
    @Query() query: QueryOrdersDto,
  ) {
    return this.ordersService.getMyOrders(actor, query);
  }

  @Get('my/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  myOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getMyOrder(actor, id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  cancelMyOrder(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: OrderReasonDto,
  ) {
    return this.ordersService.cancelMyOrder(actor, id, input.reason);
  }

  @Patch(':id/phone')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN, UserRole.SUPER_ADMIN)
  updatePhone(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateOrderPhoneDto,
  ) {
    return this.ordersService.updateOrderPhone(actor, id, input.phone);
  }

  @Get('manage')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  manageList(@Query() query: QueryOrdersDto) {
    return this.ordersService.getManageOrders(query);
  }

  @Get('manage/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  manageSummary() {
    return this.ordersService.getManageSummary();
  }

  @Get('manage/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  manageOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.getManageOrder(id);
  }

  @Post(':id/customer-chat')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  openCustomerChat(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.openCustomerChat(id, actor);
  }

  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.confirmOrder(id, actor.sub);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: OrderReasonDto,
  ) {
    return this.ordersService.rejectOrder(id, input.reason, actor.sub);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  status(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(id, input.status, actor.sub);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  getById(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ordersService.getMyOrder(actor, id);
  }
}

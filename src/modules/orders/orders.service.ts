import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '../../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { WorkHoursService } from '../work-hours/work-hours.service.js';
import { ORDER_STATUS_TRANSITIONS } from './constants/order-status-transitions.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type { QueryOrdersDto } from './dto/query-orders.dto.js';
import { OrdersRepository } from './orders.repository.js';

const orderNotFound = () =>
  new NotFoundException({
    error: 'ORDER_NOT_FOUND',
    message: 'Buyurtma topilmadi',
  });

const productMissing = () =>
  new NotFoundException({
    error: 'PRODUCT_NOT_FOUND',
    message: 'Mahsulot topilmadi',
  });

const productInactive = () =>
  new BadRequestException({
    error: 'PRODUCT_INACTIVE',
    message: 'Mahsulot faol emas',
  });

const productUnavailable = () =>
  new BadRequestException({
    error: 'PRODUCT_UNAVAILABLE',
    message: 'Mahsulot mavjud emas',
  });

const blockedUser = () =>
  new ForbiddenException({
    error: 'USER_BLOCKED',
    message: 'Foydalanuvchi bloklangan',
  });

const orderStatusChanged = () =>
  new BadRequestException({
    error: 'ORDER_STATUS_CHANGED',
    message: 'Buyurtma holati boshqa so‘rov tomonidan o‘zgartirilgan',
  });

export const ORDER_CONFIRMATION_MINUTES = 240;

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly usersService: UsersService,
    private readonly workHoursService: WorkHoursService,
  ) {}

  async createOrder(actor: { sub: string }, dto: CreateOrderDto) {
    const user = await this.usersService.findById(actor.sub);
    if (!user) throw orderNotFound();
    if (user.isBlocked) throw blockedUser();

    const merged = this.mergeDuplicateItems(dto.items);
    const products = await this.ordersRepository.findProductsForOrder(
      merged.map((item) => item.productId),
    );

    if (products.length !== merged.length) {
      throw productMissing();
    }

    const productMap = new Map(
      products.map((product) => [product.id, product]),
    );
    const validated = merged.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) throw productMissing();
      if (!product.isActive || !product.category.isActive) {
        throw productInactive();
      }
      if (!product.isAvailable) throw productUnavailable();
      return {
        productId: item.productId,
        productName: product.name,
        unitPrice: product.price,
        quantity: item.quantity,
        lineTotal: new Prisma.Decimal(product.price.toString()).mul(
          item.quantity,
        ),
      };
    });

    const subtotal = validated.reduce(
      (sum, item) => sum.add(new Prisma.Decimal(item.lineTotal.toString())),
      new Prisma.Decimal('0.00'),
    );
    const total = subtotal;
    const phone = dto.phone ?? user.phone ?? null;
    const order = await this.ordersRepository.createOrder({
      userId: actor.sub,
      status: OrderStatus.PENDING_CONFIRMATION,
      phone,
      deliveryAddress: dto.deliveryAddress ?? null,
      latitude:
        dto.latitude !== undefined
          ? new Prisma.Decimal(dto.latitude.toString())
          : null,
      longitude:
        dto.longitude !== undefined
          ? new Prisma.Decimal(dto.longitude.toString())
          : null,
      note: dto.note ?? null,
      subtotal: new Prisma.Decimal(subtotal.toString()),
      total: new Prisma.Decimal(total.toString()),
      confirmationDeadline: await this.calculateConfirmationDeadline(
        new Date(),
      ),
      items: validated.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitPrice: new Prisma.Decimal(item.unitPrice.toString()),
        quantity: item.quantity,
        lineTotal: new Prisma.Decimal(item.lineTotal.toString()),
      })),
    });

    return this.toResponse(order);
  }

  async getMyOrders(actor: { sub: string }, query: QueryOrdersDto) {
    this.ensureValidDateRange(query);
    const { data, total } = await this.ordersRepository.findUserOrders(
      actor.sub,
      query,
    );
    return this.paginate(
      data.map((order) => this.toResponse(order)),
      total,
      query,
    );
  }

  async getMyOrder(actor: { sub: string }, id: string) {
    const order = await this.ordersRepository.findUserOrderById(actor.sub, id);
    if (!order) throw orderNotFound();
    return this.toResponse(order);
  }

  async getManageOrders(query: QueryOrdersDto) {
    this.ensureValidDateRange(query);
    const { data, total } = await this.ordersRepository.findManageOrders(query);
    return this.paginate(
      data.map((order) => this.toResponse(order)),
      total,
      query,
    );
  }

  async getManageSummary() {
    const summary = await this.ordersRepository.getManageSummary();
    const counts = new Map(
      summary.ordersByStatus.map((item) => [item.status, item._count._all]),
    );

    return {
      orders: {
        total: summary.totalOrders,
        pendingConfirmation: counts.get(OrderStatus.PENDING_CONFIRMATION) ?? 0,
        confirmed: counts.get(OrderStatus.CONFIRMED) ?? 0,
        processing: counts.get(OrderStatus.PROCESSING) ?? 0,
        completed: counts.get(OrderStatus.COMPLETED) ?? 0,
        cancelled: counts.get(OrderStatus.CANCELLED) ?? 0,
        expired: counts.get(OrderStatus.EXPIRED) ?? 0,
        completedRevenue: new Prisma.Decimal(
          summary.completedRevenue?.toString() ?? '0',
        ).toFixed(2),
      },
      catalog: {
        productsTotal: summary.productsTotal,
        productsActive: summary.productsActive,
        productsAvailable: summary.productsAvailable,
        categoriesTotal: summary.categoriesTotal,
        categoriesActive: summary.categoriesActive,
      },
      customersWithOrders: summary.customersWithOrders,
      recentOrders: summary.recentOrders.map((order) => this.toResponse(order)),
    };
  }

  async getManageOrder(id: string) {
    const order = await this.ordersRepository.findById(id);
    if (!order) throw orderNotFound();
    return this.toResponse(order);
  }

  async confirmOrder(id: string) {
    const current = await this.ordersRepository.findById(id);
    if (!current) throw orderNotFound();
    this.ensureStatusTransition(current.status, OrderStatus.CONFIRMED);

    const now = new Date();
    if (current.confirmationDeadline <= now) {
      await this.updateStatusAtomically(id, current.status, {
        status: OrderStatus.EXPIRED,
        expiredAt: now,
      });
      throw new BadRequestException({
        error: 'ORDER_CONFIRMATION_EXPIRED',
        message: 'Buyurtmani tasdiqlash muddati tugagan',
      });
    }

    await this.ensureCurrentProductsAvailable(current.items);

    if (!(await this.workHoursService.isOpenAt(now))) {
      throw new BadRequestException({
        error: 'OUTSIDE_WORK_HOURS',
        message: 'Buyurtmani faqat ish vaqtida tasdiqlash mumkin',
        nextOpenAt: await this.workHoursService.getNextOpenAt(now),
      });
    }

    return this.toResponse(
      await this.updateStatusAtomically(id, current.status, {
        status: OrderStatus.CONFIRMED,
        confirmedAt: now,
      }),
    );
  }

  async rejectOrder(id: string, reason?: string) {
    const current = await this.ordersRepository.findById(id);
    if (!current) throw orderNotFound();
    if (current.status !== OrderStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException({
        error: 'ORDER_CANNOT_BE_REJECTED',
        message:
          'Faqat tasdiqlanishi kutilayotgan buyurtma rad etilishi mumkin',
      });
    }

    return this.toResponse(
      await this.updateStatusAtomically(id, current.status, {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
      }),
    );
  }

  async updateOrderStatus(id: string, status: OrderStatus) {
    if (status === OrderStatus.CONFIRMED) return this.confirmOrder(id);

    const current = await this.ordersRepository.findById(id);
    if (!current) throw orderNotFound();
    this.ensureStatusTransition(current.status, status);

    const update: Prisma.OrderUpdateInput = { status };
    if (status === OrderStatus.CANCELLED) update.cancelledAt = new Date();
    if (status === OrderStatus.COMPLETED) update.completedAt = new Date();
    if (status === OrderStatus.EXPIRED) update.expiredAt = new Date();

    return this.toResponse(
      await this.updateStatusAtomically(id, current.status, update),
    );
  }

  async cancelMyOrder(actor: { sub: string }, id: string, reason?: string) {
    const order = await this.ordersRepository.findUserOrderById(actor.sub, id);
    if (!order) throw orderNotFound();
    if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException({
        error: 'ORDER_CANNOT_BE_CANCELLED',
        message: 'Bu holatdagi buyurtmani bekor qilish mumkin emas',
      });
    }

    return this.toResponse(
      await this.updateStatusAtomically(id, order.status, {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
      }),
    );
  }

  async expirePendingOrders() {
    await this.ordersRepository.expirePendingOrders(new Date());
  }

  async calculateConfirmationDeadline(createdAt: Date) {
    return this.workHoursService.calculateBusinessDeadline(
      createdAt,
      ORDER_CONFIRMATION_MINUTES,
    );
  }

  private mergeDuplicateItems(
    items: { productId: string; quantity: number }[],
  ) {
    const map = new Map<string, { productId: string; quantity: number }>();
    for (const item of items) {
      const existing = map.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        map.set(item.productId, { ...item });
      }
    }
    return [...map.values()];
  }

  private async ensureCurrentProductsAvailable(
    items: Array<{ productId: string | null }>,
  ): Promise<void> {
    const productIds = items.map((item) => item.productId);
    if (productIds.some((productId) => productId === null)) {
      throw productUnavailable();
    }

    const uniqueProductIds = [...new Set(productIds as string[])];
    const products =
      await this.ordersRepository.findProductsForOrder(uniqueProductIds);
    if (products.length !== uniqueProductIds.length) throw productMissing();
    if (
      products.some(
        (product) => !product.isActive || !product.category.isActive,
      )
    ) {
      throw productInactive();
    }
    if (products.some((product) => !product.isAvailable)) {
      throw productUnavailable();
    }
  }

  private ensureValidDateRange(query: QueryOrdersDto): void {
    if (
      query.createdFrom &&
      query.createdTo &&
      new Date(query.createdFrom) > new Date(query.createdTo)
    ) {
      throw new BadRequestException({
        error: 'INVALID_DATE_RANGE',
        message: "createdFrom createdTo dan keyin bo'lishi mumkin emas",
      });
    }
  }

  private paginate<T>(data: T[], total: number, query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private ensureStatusTransition(current: OrderStatus, next: OrderStatus) {
    const allowed = ORDER_STATUS_TRANSITIONS[current] ?? [];
    if (!allowed.includes(next)) {
      throw new BadRequestException({
        error: 'INVALID_ORDER_STATUS_TRANSITION',
        message: `Noto'g'ri status o'zgarishi: ${current} -> ${next}`,
      });
    }
  }

  private async updateStatusAtomically(
    id: string,
    currentStatus: OrderStatus,
    data: Prisma.OrderUpdateInput,
  ) {
    try {
      return await this.ordersRepository.updateStatus(id, currentStatus, data);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) throw orderStatusChanged();
      throw error;
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }

  private toResponse(order: {
    id: string;
    status: OrderStatus;
    user: {
      id: string;
      firstName: string;
      lastName?: string | null;
      username?: string | null;
      phone?: string | null;
      telegramId: bigint;
    };
    items: Array<{
      id: string;
      productId: string | null;
      productName: string;
      unitPrice: Prisma.Decimal | string | number;
      quantity: number;
      lineTotal: Prisma.Decimal | string | number;
    }>;
    subtotal: Prisma.Decimal | string | number;
    total: Prisma.Decimal | string | number;
    phone: string | null;
    deliveryAddress: string | null;
    latitude: Prisma.Decimal | string | number | null;
    longitude: Prisma.Decimal | string | number | null;
    note: string | null;
    confirmationDeadline: Date;
    confirmedAt: Date | null;
    cancelledAt: Date | null;
    completedAt: Date | null;
    expiredAt: Date | null;
    cancelReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: order.id,
      status: order.status,
      customer: {
        id: order.user.id,
        firstName: order.user.firstName,
        lastName: order.user.lastName,
        username: order.user.username,
        phone: order.user.phone,
      },
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        unitPrice: new Prisma.Decimal(item.unitPrice.toString()).toFixed(2),
        quantity: item.quantity,
        lineTotal: new Prisma.Decimal(item.lineTotal.toString()).toFixed(2),
      })),
      subtotal: new Prisma.Decimal(order.subtotal.toString()).toFixed(2),
      total: new Prisma.Decimal(order.total.toString()).toFixed(2),
      phone: order.phone,
      deliveryAddress: order.deliveryAddress,
      latitude: order.latitude
        ? new Prisma.Decimal(order.latitude.toString()).toFixed(6)
        : null,
      longitude: order.longitude
        ? new Prisma.Decimal(order.longitude.toString()).toFixed(6)
        : null,
      note: order.note,
      confirmationDeadline: order.confirmationDeadline,
      confirmedAt: order.confirmedAt,
      cancelledAt: order.cancelledAt,
      completedAt: order.completedAt,
      expiredAt: order.expiredAt,
      cancelReason: order.cancelReason,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

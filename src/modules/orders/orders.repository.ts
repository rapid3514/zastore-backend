import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrderStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryOrdersDto } from './dto/query-orders.dto.js';

const orderInclude = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      phone: true,
      telegramId: true,
    },
  },
  items: {
    orderBy: { createdAt: 'asc' },
  },
} as const;

const createdAtFilter = (
  query: QueryOrdersDto,
): Prisma.DateTimeFilter | undefined => {
  if (!query.createdFrom && !query.createdTo) return undefined;
  return {
    ...(query.createdFrom ? { gte: new Date(query.createdFrom) } : {}),
    ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
  };
};

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
  }

  findUserOrderById(userId: string, id: string) {
    return this.prisma.order.findFirst({
      where: { id, userId },
      include: orderInclude,
    });
  }

  async findUserOrders(userId: string, query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(createdAtFilter(query) ? { createdAt: createdAtFilter(query) } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total };
  }

  async findManageOrders(query: QueryOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const searchTelegramId =
      search && /^\d+$/.test(search) ? BigInt(search) : null;

    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { userId: query.customerId } : {}),
      ...(createdAtFilter(query) ? { createdAt: createdAtFilter(query) } : {}),
      ...(search
        ? {
            OR: [
              ...(search && /^[0-9a-fA-F-]{36}$/.test(search)
                ? [{ id: { equals: search } }]
                : []),
              { phone: { contains: search, mode: 'insensitive' } },
              {
                user: { firstName: { contains: search, mode: 'insensitive' } },
              },
              { user: { lastName: { contains: search, mode: 'insensitive' } } },
              { user: { username: { contains: search, mode: 'insensitive' } } },
              ...(searchTelegramId !== null
                ? [{ user: { telegramId: searchTelegramId } }]
                : []),
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data, total };
  }

  async getManageSummary() {
    const [
      totalOrders,
      ordersByStatus,
      completedRevenue,
      customersWithOrders,
      productsTotal,
      productsActive,
      productsAvailable,
      categoriesTotal,
      categoriesActive,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { status: OrderStatus.COMPLETED },
        _sum: { total: true },
      }),
      this.prisma.user.count({ where: { orders: { some: {} } } }),
      this.prisma.product.count(),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.product.count({
        where: { isActive: true, isAvailable: true },
      }),
      this.prisma.category.count(),
      this.prisma.category.count({ where: { isActive: true } }),
      this.prisma.order.findMany({
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5,
      }),
    ]);

    return {
      totalOrders,
      ordersByStatus,
      completedRevenue: completedRevenue._sum.total,
      customersWithOrders,
      productsTotal,
      productsActive,
      productsAvailable,
      categoriesTotal,
      categoriesActive,
      recentOrders,
    };
  }

  countUserOrders(userId: string) {
    return this.prisma.order.count({ where: { userId } });
  }

  countManageOrders() {
    return this.prisma.order.count();
  }

  findProductsForOrder(productIds: string[]) {
    return this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        category: { select: { isActive: true } },
      },
    });
  }

  createOrder(data: {
    userId: string;
    status: OrderStatus;
    phone: string | null;
    deliveryAddress: string | null;
    btcPostBranchNumber: string | null;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    note: string | null;
    subtotal: Prisma.Decimal;
    total: Prisma.Decimal;
    confirmationDeadline: Date;
    cancelReason?: string | null;
    items: Array<{
      productId: string | null;
      productName: string;
      unitPrice: Prisma.Decimal;
      quantity: number;
      lineTotal: Prisma.Decimal;
    }>;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId: data.userId,
          status: data.status,
          phone: data.phone,
          deliveryAddress: data.deliveryAddress,
          btcPostBranchNumber: data.btcPostBranchNumber,
          latitude: data.latitude,
          longitude: data.longitude,
          note: data.note,
          subtotal: data.subtotal,
          total: data.total,
          confirmationDeadline: data.confirmationDeadline,
          cancelReason: data.cancelReason ?? null,
          items: {
            createMany: {
              data: data.items.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                unitPrice: item.unitPrice,
                quantity: item.quantity,
                lineTotal: item.lineTotal,
              })),
            },
          },
        },
        include: orderInclude,
      });

      return order;
    });
  }

  updateStatus(
    id: string,
    currentStatus: OrderStatus,
    data: Prisma.OrderUpdateInput,
  ) {
    return this.prisma.order.update({
      where: { id, status: currentStatus },
      data,
      include: orderInclude,
    });
  }

  expirePendingOrders(now: Date) {
    return this.prisma.order.updateMany({
      where: {
        status: OrderStatus.PENDING_CONFIRMATION,
        confirmationDeadline: { lte: now },
      },
      data: {
        status: OrderStatus.EXPIRED,
        expiredAt: now,
      },
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  OrderStatus,
  NotificationKind,
  PaymentStatus,
  Prisma,
  ProductAvailabilityStatus,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryOrdersDto } from './dto/query-orders.dto.js';
import { enqueueOrderNotifications } from '../notifications/outbox.factory.js';

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
    include: {
      product: {
        select: {
          imageUrl: true,
          media: {
            where: { type: 'IMAGE' },
            orderBy: { position: 'asc' },
            take: 1,
            select: { url: true },
          },
        },
      },
    },
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

  findByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: orderInclude,
    });
  }

  findUserOrderById(userId: string, id: string) {
    return this.prisma.order.findFirst({
      where: { id, userId },
      include: orderInclude,
    });
  }

  updatePhone(id: string, phone: string) {
    return this.prisma.order.update({
      where: { id },
      data: { phone },
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
      search && /^\d+$/.test(search) && BigInt(search) <= 9223372036854775807n
        ? BigInt(search)
        : null;

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
      this.prisma.product.count({
        where: {
          availabilityStatus: {
            not: ProductAvailabilityStatus.OUT_OF_STOCK,
          },
        },
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
    idempotencyKey: string;
    requestHash: string;
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
      // A transaction-scoped lock serializes retries before the unique insert.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${data.userId}:${data.idempotencyKey}`}, 0::bigint))::text AS locked`;
      const existing = await tx.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: data.userId,
            idempotencyKey: data.idempotencyKey,
          },
        },
        include: orderInclude,
      });
      if (existing) {
        if (existing.requestHash !== data.requestHash)
          throw new ConflictException({
            error: 'IDEMPOTENCY_KEY_CONFLICT',
            message: 'Idempotency key payload mismatch',
          });
        return existing;
      }
      const productIds = data.items.flatMap((item) =>
        item.productId ? [item.productId] : [],
      );
      await this.lockAvailableProducts(tx, productIds);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, price: true },
      });
      if (
        data.items.some(
          (item) =>
            !products.some(
              (product) =>
                product.id === item.productId &&
                product.price.equals(item.unitPrice),
            ),
        )
      ) {
        throw new ConflictException({
          error: 'PRODUCT_PRICE_CHANGED',
          message: 'Mahsulot narxi o‘zgardi, buyurtmani qayta tekshiring',
        });
      }
      const order = await tx.order.create({
        data: {
          userId: data.userId,
          idempotencyKey: data.idempotencyKey,
          requestHash: data.requestHash,
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

      await enqueueOrderNotifications(tx, order, NotificationKind.NEW_ORDER);
      return order;
    });
  }

  updateStatus(
    id: string,
    currentStatus: OrderStatus,
    data: Prisma.OrderUpdateInput,
    rejected = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (data.status === OrderStatus.CONFIRMED) {
        const items = await tx.orderItem.findMany({
          where: { orderId: id },
          select: { productId: true },
        });
        if (items.some((item) => item.productId === null))
          throw new BadRequestException({
            error: 'PRODUCT_UNAVAILABLE',
            message: 'Mahsulot mavjud emas',
          });
        await this.lockAvailableProducts(
          tx,
          items.flatMap((item) => (item.productId ? [item.productId] : [])),
        );
      }
      const order = await tx.order.update({
        where: {
          id,
          status: currentStatus,
          ...(data.status === OrderStatus.CONFIRMED
            ? { confirmationDeadline: { gt: new Date() } }
            : {}),
        },
        data,
        include: orderInclude,
      });
      if (
        order.status === OrderStatus.CANCELLED ||
        order.status === OrderStatus.EXPIRED
      ) {
        await tx.payment.updateMany({
          where: { orderId: id, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.CANCELLED },
        });
      }
      await enqueueOrderNotifications(
        tx,
        order,
        rejected
          ? NotificationKind.ORDER_REJECTED
          : NotificationKind.ORDER_STATUS,
      );
      return order;
    });
  }

  expirePendingOrders(now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Order" WHERE "status" = 'PENDING_CONFIRMATION'::"OrderStatus" AND "confirmationDeadline" <= ${now}
        ORDER BY "confirmationDeadline", "id" LIMIT 100 FOR UPDATE SKIP LOCKED`;
      for (const row of due) {
        const order = await tx.order.update({
          where: { id: row.id, status: OrderStatus.PENDING_CONFIRMATION },
          data: { status: OrderStatus.EXPIRED, expiredAt: now },
          include: orderInclude,
        });
        await tx.payment.updateMany({
          where: { orderId: row.id, status: PaymentStatus.PENDING },
          data: { status: PaymentStatus.CANCELLED },
        });
        await enqueueOrderNotifications(
          tx,
          order,
          NotificationKind.ORDER_STATUS,
        );
      }
      return { count: due.length };
    });
  }

  private async lockAvailableProducts(
    tx: Prisma.TransactionClient,
    productIds: string[],
  ): Promise<void> {
    if (!productIds.length)
      throw new BadRequestException({
        error: 'PRODUCT_UNAVAILABLE',
        message: 'Mahsulot mavjud emas',
      });
    const products = await tx.$queryRaw<
      Array<{
        id: string;
        categoryActive: boolean;
        availabilityStatus: ProductAvailabilityStatus;
      }>
    >(Prisma.sql`
      SELECT p."id", p."availabilityStatus", c."isActive" AS "categoryActive"
      FROM "Product" p JOIN "Category" c ON c."id" = p."categoryId"
      WHERE p."id" IN (${Prisma.join([...new Set(productIds)].sort().map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY p."id" FOR SHARE OF p, c`);
    if (
      products.length !== new Set(productIds).size ||
      products.some(
        (product) =>
          !product.categoryActive ||
          product.availabilityStatus === ProductAvailabilityStatus.OUT_OF_STOCK,
      )
    ) {
      throw new BadRequestException({
        error: 'PRODUCT_UNAVAILABLE',
        message: 'Mahsulot mavjud emas',
      });
    }
  }
}

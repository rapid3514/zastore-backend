import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  type Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { QueryPaymentsDto } from './dto/query-payments.dto.js';

const paymentInclude = {
  order: {
    select: {
      id: true,
      userId: true,
      status: true,
      total: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOwnedOrder(orderId: string, userId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, total: true, status: true },
    });
  }

  findByOrderId(orderId: string) {
    return this.prisma.payment.findUnique({
      where: { orderId },
      include: paymentInclude,
    });
  }

  findOwnedByOrderId(orderId: string, userId: string) {
    return this.prisma.payment.findFirst({
      where: { orderId, order: { userId } },
      include: paymentInclude,
    });
  }

  create(orderId: string, amount: Prisma.Decimal) {
    return this.prisma.payment.create({
      data: { orderId, amount },
      include: paymentInclude,
    });
  }

  createForOwnedOrder(orderId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      // All payment creation and order transitions serialize on this order row.
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
      const order = await tx.order.findFirst({
        where: { id: orderId, userId },
        select: { id: true, status: true, total: true },
      });
      if (!order) return null;
      const allowed: readonly OrderStatus[] = [
        OrderStatus.PENDING_CONFIRMATION,
        OrderStatus.CONFIRMED,
        OrderStatus.PROCESSING,
      ];
      if (!allowed.includes(order.status))
        throw new BadRequestException({
          error: 'ORDER_NOT_PAYABLE',
          message: 'Bu holatdagi buyurtma uchun to‘lov yaratib bo‘lmaydi',
        });
      const existing = await tx.payment.findUnique({
        where: { orderId },
        include: paymentInclude,
      });
      if (existing) {
        if (existing.status !== PaymentStatus.PENDING)
          throw new BadRequestException({
            error: 'PAYMENT_NOT_PENDING',
            message: 'Bu buyurtma uchun yangi to‘lovga ruxsat yo‘q',
          });
        return existing;
      }
      return tx.payment.create({
        data: { orderId, amount: order.total },
        include: paymentInclude,
      });
    });
  }

  findById(id: string) {
    return this.prisma.payment.findUnique({
      where: { id },
      include: paymentInclude,
    });
  }

  async list(query: QueryPaymentsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider
        ? { provider: { equals: query.provider, mode: 'insensitive' } }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total, page, limit };
  }
}

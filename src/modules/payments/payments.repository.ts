import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
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
      select: { id: true, total: true },
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

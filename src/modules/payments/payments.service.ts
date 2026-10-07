import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { QueryPaymentsDto } from './dto/query-payments.dto.js';
import { PaymentsRepository } from './payments.repository.js';

type PaymentRecord = NonNullable<
  Awaited<ReturnType<PaymentsRepository['findById']>>
>;

const orderNotFound = () =>
  new NotFoundException({
    error: 'ORDER_NOT_FOUND',
    message: 'Buyurtma topilmadi',
  });

const paymentNotFound = () =>
  new NotFoundException({
    error: 'PAYMENT_NOT_FOUND',
    message: "To'lov topilmadi",
  });

@Injectable()
export class PaymentsService {
  constructor(private readonly paymentsRepository: PaymentsRepository) {}

  async createForOrder(userId: string, orderId: string) {
    const order = await this.paymentsRepository.findOwnedOrder(orderId, userId);
    if (!order) throw orderNotFound();

    const existing = await this.paymentsRepository.findByOrderId(orderId);
    if (existing) return this.present(existing);

    try {
      const payment = await this.paymentsRepository.create(
        order.id,
        new Prisma.Decimal(order.total.toString()),
      );
      return this.present(payment);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        const payment = await this.paymentsRepository.findOwnedByOrderId(
          orderId,
          userId,
        );
        if (payment) return this.present(payment);
      }
      throw error;
    }
  }

  async getForOrder(userId: string, orderId: string) {
    const order = await this.paymentsRepository.findOwnedOrder(orderId, userId);
    if (!order) throw orderNotFound();
    const payment = await this.paymentsRepository.findOwnedByOrderId(
      orderId,
      userId,
    );
    if (!payment) throw paymentNotFound();
    return this.present(payment);
  }

  async list(query: QueryPaymentsDto) {
    this.ensureDateRange(query);
    const result = await this.paymentsRepository.list(query);
    return {
      data: result.data.map((payment) => this.present(payment)),
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  async getById(id: string) {
    const payment = await this.paymentsRepository.findById(id);
    if (!payment) throw paymentNotFound();
    return this.present(payment);
  }

  private ensureDateRange(query: QueryPaymentsDto) {
    if (
      query.dateFrom &&
      query.dateTo &&
      new Date(query.dateFrom) > new Date(query.dateTo)
    ) {
      throw new BadRequestException({
        error: 'INVALID_DATE_RANGE',
        message: "dateFrom dateTo dan keyin bo'lishi mumkin emas",
      });
    }
  }

  private present(payment: PaymentRecord) {
    return {
      id: payment.id,
      orderId: payment.orderId,
      amount: payment.amount.toFixed(2),
      status: payment.status,
      provider: payment.provider,
      externalId: payment.externalId,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      order: payment.order,
      providerConfigured: payment.provider !== null,
      providerMessage:
        payment.provider === null
          ? 'External payment provider not configured'
          : null,
    };
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === code
    );
  }
}

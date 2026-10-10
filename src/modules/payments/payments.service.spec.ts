import { NotFoundException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service.js';

const userId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const paymentRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  orderId,
  amount: new Prisma.Decimal('75.50'),
  status: PaymentStatus.PENDING,
  provider: null,
  externalId: null,
  paidAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  order: {
    id: orderId,
    userId,
    status: OrderStatus.PENDING_CONFIRMATION,
    total: new Prisma.Decimal('75.50'),
    createdAt: new Date(),
    user: {
      id: userId,
      firstName: 'Ali',
      lastName: null,
      username: null,
    },
  },
};

describe('PaymentsService', () => {
  const repository = {
    findOwnedOrder: vi.fn(),
    createForOwnedOrder: vi.fn(),
    findByOrderId: vi.fn(),
    findOwnedByOrderId: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
  };
  let service: PaymentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PaymentsService(repository as never);
  });

  it('creates a payment using the trusted order total', async () => {
    repository.createForOwnedOrder.mockResolvedValue(paymentRecord);

    const result = await service.createForOrder(userId, orderId);

    expect(repository.createForOwnedOrder).toHaveBeenCalledWith(
      orderId,
      userId,
    );
    expect(result).toMatchObject({
      amount: '75.50',
      status: PaymentStatus.PENDING,
      providerConfigured: false,
      providerMessage: 'External payment provider not configured',
    });
  });

  it('does not expose another customer order as a valid payment target', async () => {
    repository.createForOwnedOrder.mockResolvedValue(null);

    await expect(
      service.createForOrder(userId, orderId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid order', async () => {
    repository.findOwnedOrder.mockResolvedValue(null);

    await expect(service.getForOrder(userId, orderId)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'ORDER_NOT_FOUND' }),
    });
  });

  it('returns the existing payment instead of creating a duplicate', async () => {
    repository.createForOwnedOrder.mockResolvedValue(paymentRecord);

    await expect(
      service.createForOrder(userId, orderId),
    ).resolves.toMatchObject({
      id: paymentRecord.id,
      status: PaymentStatus.PENDING,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('preserves payment status and paidAt in responses', async () => {
    const paidAt = new Date('2026-10-02T10:00:00.000Z');
    repository.findById.mockResolvedValue({
      ...paymentRecord,
      status: PaymentStatus.PAID,
      provider: 'configured-provider',
      paidAt,
    });

    await expect(service.getById(paymentRecord.id)).resolves.toMatchObject({
      status: PaymentStatus.PAID,
      paidAt,
      providerConfigured: true,
    });
  });

  it('paginates the management list', async () => {
    repository.list.mockResolvedValue({
      data: [paymentRecord],
      total: 21,
      page: 2,
      limit: 10,
    });

    await expect(
      service.list({ page: 2, limit: 10, status: PaymentStatus.PENDING }),
    ).resolves.toMatchObject({
      meta: { page: 2, limit: 10, total: 21, totalPages: 3 },
    });
  });
});

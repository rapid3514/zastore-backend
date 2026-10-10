import { describe, expect, it, vi } from 'vitest';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { PaymentsRepository } from './payments.repository.js';

function fixture(
  status: OrderStatus,
  payment: { status: PaymentStatus } | null = null,
  owned = true,
) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    order: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          owned
            ? { id: 'order-1', status, total: new Prisma.Decimal('75.50') }
            : null,
        ),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      create: vi.fn().mockResolvedValue({ id: 'payment-1' }),
    },
  };
  const transaction = vi.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
  );
  return {
    tx,
    transaction,
    repository: new PaymentsRepository({ $transaction: transaction } as never),
  };
}

describe('PaymentsRepository transaction safeguards', () => {
  it.each([OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.COMPLETED])(
    'rejects non-payable %s without creating a payment',
    async (status) => {
      const { repository, tx } = fixture(status);
      await expect(
        repository.createForOwnedOrder('order-1', 'user-1'),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'ORDER_NOT_PAYABLE' },
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
    },
  );

  it.each([PaymentStatus.PAID, PaymentStatus.CANCELLED, PaymentStatus.FAILED])(
    'rejects a %s payment instead of reopening payment',
    async (status) => {
      const { repository, tx } = fixture(OrderStatus.CONFIRMED, { status });
      await expect(
        repository.createForOwnedOrder('order-1', 'user-1'),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'PAYMENT_NOT_PENDING' },
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
    },
  );

  it('locks the owned order and uses its DB total within the same transaction', async () => {
    const { repository, tx, transaction } = fixture(
      OrderStatus.PENDING_CONFIRMATION,
    );
    await repository.createForOwnedOrder('order-1', 'user-1');
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { orderId: 'order-1', amount: new Prisma.Decimal('75.50') },
      }),
    );
  });

  it('returns a pending payment idempotently and conceals another user order', async () => {
    const existing = { status: PaymentStatus.PENDING };
    const pending = fixture(OrderStatus.CONFIRMED, existing);
    await expect(
      pending.repository.createForOwnedOrder('order-1', 'user-1'),
    ).resolves.toEqual(existing);
    expect(pending.tx.payment.create).not.toHaveBeenCalled();
    const other = fixture(OrderStatus.CONFIRMED, null, false);
    await expect(
      other.repository.createForOwnedOrder('order-1', 'user-1'),
    ).resolves.toBeNull();
    expect(other.tx.payment.create).not.toHaveBeenCalled();
  });
});

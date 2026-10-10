import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  NotificationDeliveryStatus,
  OrderStatus,
  Prisma,
  UserRole,
} from '../src/generated/prisma/client.js';
import { NotificationsRepository } from '../src/modules/notifications/notifications.repository.js';
import { OrdersRepository } from '../src/modules/orders/orders.repository.js';
import { PaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { createConfigService } from './helpers/config.js';

describe('checkout concurrency with real PostgreSQL', () => {
  let prisma: PrismaService;
  let orders: OrdersRepository;
  let payments: PaymentsRepository;
  let notifications: NotificationsRepository;
  let categoryId: string;
  let productId: string;
  let customerId: string;
  let secondCustomerId: string;
  let adminId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (
      !databaseUrl ||
      !/(?:^|_)(?:test|audit|security)(?:_|$)/i.test(
        decodeURIComponent(new URL(databaseUrl).pathname.slice(1)),
      )
    ) {
      throw new Error('TEST_DATABASE_URL must name an isolated test database');
    }
    const config: ConfigService = createConfigService({ DATABASE_URL: databaseUrl });
    prisma = new PrismaService(config);
    await prisma.$connect();
    orders = new OrdersRepository(prisma);
    payments = new PaymentsRepository(prisma);
    notifications = new NotificationsRepository(prisma);
  });

  afterEach(async () => {
    if (!categoryId) return;
    await prisma.notificationOutbox.deleteMany({ where: { order: { userId: { in: [customerId, secondCustomerId] } } } });
    await prisma.payment.deleteMany({ where: { order: { userId: { in: [customerId, secondCustomerId] } } } });
    await prisma.order.deleteMany({ where: { userId: { in: [customerId, secondCustomerId] } } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({ where: { id: { in: [customerId, secondCustomerId, adminId] } } });
    categoryId = '';
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function seed(): Promise<void> {
    categoryId = randomUUID();
    productId = randomUUID();
    customerId = randomUUID();
    secondCustomerId = randomUUID();
    adminId = randomUUID();
    await prisma.category.create({ data: { id: categoryId, name: 'Checkout security', slug: `security-${categoryId}` } });
    await prisma.product.create({ data: { id: productId, categoryId, name: 'Checkout product', price: '100.00' } });
    const telegramBase = BigInt(Date.now()) * 1000n;
    await prisma.user.createMany({ data: [
      { id: customerId, telegramId: telegramBase + 1n, firstName: 'Customer', role: UserRole.CUSTOMER },
      { id: secondCustomerId, telegramId: telegramBase + 2n, firstName: 'Second', role: UserRole.CUSTOMER },
      { id: adminId, telegramId: telegramBase + 3n, firstName: 'Admin', role: UserRole.ADMIN },
    ] });
  }

  function checkout(userId = customerId, idempotencyKey = randomUUID(), requestHash = createHash('sha256').update('same payload').digest('hex')) {
    return orders.createOrder({
      userId,
      idempotencyKey,
      requestHash,
      status: OrderStatus.PENDING_CONFIRMATION,
      phone: null,
      deliveryAddress: null,
      btcPostBranchNumber: null,
      latitude: null,
      longitude: null,
      note: null,
      subtotal: new Prisma.Decimal('100.00'),
      total: new Prisma.Decimal('100.00'),
      confirmationDeadline: new Date(Date.now() + 3_600_000),
      items: [{ productId, productName: 'Checkout product', unitPrice: new Prisma.Decimal('100.00'), quantity: 1, lineTotal: new Prisma.Decimal('100.00') }],
    });
  }

  it('serializes identical checkout retries and persists one outbox event', async () => {
    await seed();
    const key = randomUUID();
    const [first, second] = await Promise.all([checkout(customerId, key), checkout(customerId, key)]);
    expect(first.id).toBe(second.id);
    expect(await prisma.order.count({ where: { userId: customerId } })).toBe(1);
    expect(await prisma.notificationOutbox.count({ where: { orderId: first.id } })).toBe(1);
    await expect(checkout(customerId, key, 'a'.repeat(64))).rejects.toMatchObject({ status: 409 });
    const otherUser = await checkout(secondCustomerId, key);
    expect(otherUser.id).not.toBe(first.id);
  });

  it('rejects cancelled and expired payments and serializes concurrent payment creation', async () => {
    await seed();
    const active = await checkout();
    const [first, second] = await Promise.all([
      payments.createForOwnedOrder(active.id, customerId),
      payments.createForOwnedOrder(active.id, customerId),
    ]);
    expect(first?.id).toBe(second?.id);
    expect(await prisma.payment.count({ where: { orderId: active.id } })).toBe(1);

    const cancelled = await checkout();
    await prisma.order.update({ where: { id: cancelled.id }, data: { status: OrderStatus.CANCELLED } });
    await expect(payments.createForOwnedOrder(cancelled.id, customerId)).rejects.toMatchObject({ status: 400 });
    const expired = await checkout();
    await prisma.order.update({ where: { id: expired.id }, data: { status: OrderStatus.EXPIRED } });
    await expect(payments.createForOwnedOrder(expired.id, customerId)).rejects.toMatchObject({ status: 400 });
    expect(await prisma.payment.count({ where: { orderId: { in: [cancelled.id, expired.id] } } })).toBe(0);
  });

  it('expires an overdue order only once across concurrent workers', async () => {
    await seed();
    const order = await checkout();
    await prisma.order.update({ where: { id: order.id }, data: { confirmationDeadline: new Date(Date.now() - 1000) } });
    const results = await Promise.all([orders.expirePendingOrders(new Date()), orders.expirePendingOrders(new Date())]);
    expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(OrderStatus.EXPIRED);
    expect(await prisma.notificationOutbox.count({ where: { orderId: order.id } })).toBe(2);
  });

  it('claims an outbox event once across concurrent workers', async () => {
    await seed();
    const order = await checkout();
    const claimed = await Promise.all([
      notifications.claimNext(new Date(), randomUUID()),
      notifications.claimNext(new Date(), randomUUID()),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(claimed.find(Boolean)?.orderId).toBe(order.id);
    expect(await prisma.notificationOutbox.count({ where: { orderId: order.id, status: NotificationDeliveryStatus.PROCESSING } })).toBe(1);
  });
});

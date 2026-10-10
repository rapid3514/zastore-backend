import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { ProductAvailabilityStatus, UserRole } from '../src/generated/prisma/client.js';
import { ProductsRepository } from '../src/modules/products/products.repository.js';
import { createConfigService } from './helpers/config.js';

describe('product concurrency with real PostgreSQL', () => {
  let prisma: PrismaService;
  let repository: ProductsRepository;
  let categoryId: string | undefined;
  let productId: string | undefined;
  let userId: string | undefined;
  let orderId: string | undefined;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl || !/(?:^|_)(?:test|audit|security)(?:_|$)/i.test(decodeURIComponent(new URL(databaseUrl).pathname.slice(1)))) {
      throw new Error('TEST_DATABASE_URL must name an isolated test database');
    }
    const config: ConfigService = createConfigService({ DATABASE_URL: databaseUrl });
    prisma = new PrismaService(config);
    await prisma.$connect();
    repository = new ProductsRepository(prisma);
  });

  afterEach(async () => {
    if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
    if (productId) await prisma.product.deleteMany({ where: { id: productId } });
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    categoryId = productId = userId = orderId = undefined;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createProduct() {
    categoryId = randomUUID();
    productId = randomUUID();
    await prisma.category.create({ data: { id: categoryId, name: 'Security category', slug: `security-${categoryId}` } });
    return prisma.product.create({ data: {
      id: productId, categoryId, name: 'Security product', price: '100.00',
    } });
  }

  it('accepts only one editor using the same product version', async () => {
    const product = await createProduct();
    const results = await Promise.allSettled([
      repository.update(product.id, { price: 101 }, product.version),
      repository.update(product.id, { price: 102 }, product.version),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).version).toBe(1);
  });

  it('marks a product referenced by an order as out of stock instead of deleting it', async () => {
    const product = await createProduct();
    userId = randomUUID();
    orderId = randomUUID();
    await prisma.user.create({ data: {
      id: userId, telegramId: BigInt(`8${Date.now()}123`), firstName: 'Customer', role: UserRole.CUSTOMER,
    } });
    await prisma.order.create({ data: {
      id: orderId, userId, subtotal: '100.00', total: '100.00',
      confirmationDeadline: new Date(Date.now() + 3_600_000),
      items: { create: { productId: product.id, productName: product.name, unitPrice: '100.00', quantity: 1, lineTotal: '100.00' } },
    } });
    const removal = await repository.removeOrDeactivate(product.id, product.version);
    expect(removal?.softDeleted).toBe(true);
    const persisted = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(persisted.availabilityStatus).toBe(ProductAvailabilityStatus.OUT_OF_STOCK);
    expect(persisted.version).toBe(1);
    expect(await prisma.orderItem.count({ where: { productId: product.id } })).toBe(1);
  });
});

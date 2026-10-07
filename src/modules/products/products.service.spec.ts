import {
  AuditAction,
  AuditEntityType,
  Prisma,
} from '../../generated/prisma/client.js';
import { describe, expect, it, vi } from 'vitest';
import { ProductsService } from './products.service.js';

const productId = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const product = {
  id: productId,
  name: 'Burger',
  description: null,
  price: new Prisma.Decimal('12000.00'),
  imageUrl: null,
  categoryId,
  category: { id: categoryId, name: 'Food', slug: 'food' },
  isAvailable: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProductsService audit integration', () => {
  it('writes a product update audit event', async () => {
    const repository = {
      findById: vi.fn().mockResolvedValue(product),
      findCategoryById: vi.fn(),
      update: vi.fn().mockResolvedValue({
        ...product,
        price: new Prisma.Decimal('15000.00'),
      }),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new ProductsService(repository as never, audit as never);

    await service.update(productId, { price: 15000 }, 'actor-id');

    expect(audit.log).toHaveBeenCalledWith({
      actorUserId: 'actor-id',
      action: AuditAction.PRODUCT_UPDATE,
      entityType: AuditEntityType.PRODUCT,
      entityId: productId,
      metadata: { fields: ['price'] },
    });
  });
});

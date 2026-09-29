import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { Prisma, UserRole } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { ProductsController } from '../src/modules/products/products.controller.js';
import { ProductsRepository } from '../src/modules/products/products.repository.js';
import { ProductsService } from '../src/modules/products/products.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const categoryId = '33333333-3333-4333-8333-333333333333';

const product = {
  id: productId,
  name: 'Burger',
  description: null,
  price: new Prisma.Decimal('12000.00'),
  imageUrl: null,
  categoryId,
  category: { id: categoryId, name: 'Burgerlar', slug: 'burgerlar' },
  isAvailable: true,
  isActive: true,
  createdAt: new Date('2026-09-24T00:00:00.000Z'),
  updatedAt: new Date('2026-09-24T00:00:00.000Z'),
};

describe('ProductsController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const repository = {
    findCategoryById: vi.fn(),
    countOrderItems: vi.fn(),
    list: vi.fn(),
    findPublicById: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [ProductsController],
      providers: [
        ProductsService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ProductsRepository, useValue: repository },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
      ],
    }).compile();
    jwtService = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.ADMIN,
      isBlocked: false,
    });
    repository.findCategoryById.mockResolvedValue({
      id: categoryId,
      isActive: true,
    });
    repository.countOrderItems.mockResolvedValue(0);
    repository.list.mockResolvedValue({ data: [product], total: 1 });
    repository.findPublicById.mockResolvedValue(product);
    repository.findById.mockResolvedValue(product);
    repository.create.mockResolvedValue(product);
    repository.update.mockResolvedValue({ ...product, isAvailable: false });
    repository.delete.mockResolvedValue(product);
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: userId, telegramId: '123456789', role },
      { secret, expiresIn: '5m' },
    );
  }

  const createInput = { name: 'Burger', price: 12000, categoryId };

  it('lets a guest and a customer view the public list and product', async () => {
    const guest = await request(app.getHttpServer())
      .get('/api/v1/products?page=1&limit=20')
      .expect(200);
    expect(guest.body.data[0]).toMatchObject({
      id: productId,
      price: '12000.00',
    });
    expect(guest.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(repository.list).toHaveBeenCalledWith({ page: 1, limit: 20 }, false);

    await request(app.getHttpServer())
      .get('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/products/${productId}`)
      .expect(200);
  });

  it('never exposes inactive products through the public list', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/products?isActive=false')
      .expect(200);
    expect(response.body).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('rejects customer create and allows ADMIN and SUPER_ADMIN create', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .send(createInput)
      .expect(403);

    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      usersService.findById.mockResolvedValue({
        id: userId,
        role,
        isBlocked: false,
      });
      await request(app.getHttpServer())
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token(role)}`)
        .send(createInput)
        .expect(201);
    }
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Burger',
        price: 12000,
        categoryId,
        isAvailable: true,
        isActive: true,
      }),
    );
  });

  it('returns 404 for an unknown category and 400 for invalid price', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    repository.findCategoryById.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send(createInput)
      .expect(404);
    expect(repository.create).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, price: -1 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send({ ...createInput, price: 0 })
      .expect(400);
  });

  it('rejects create and category changes targeting an inactive category', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    repository.findCategoryById.mockResolvedValue({
      id: categoryId,
      isActive: false,
    });

    await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', authorization)
      .send(createInput)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .send({ categoryId })
      .expect(400);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('lets ADMIN update availability and delete a product', async () => {
    const authorization = `Bearer ${token(UserRole.ADMIN)}`;
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .send({ isAvailable: false })
      .expect(200);
    expect(response.body.isAvailable).toBe(false);
    expect(repository.update).toHaveBeenCalledWith(productId, {
      isAvailable: false,
    });

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', authorization)
      .expect(204);
    expect(repository.delete).toHaveBeenCalledWith(productId);
  });

  it('soft-deletes a product referenced by historical orders', async () => {
    repository.countOrderItems.mockResolvedValue(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(204);

    expect(repository.update).toHaveBeenCalledWith(productId, {
      isActive: false,
      isAvailable: false,
    });
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('lets ADMIN list inactive products through manage', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/products/manage?isActive=false')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200);
    expect(repository.list).toHaveBeenCalledWith({ isActive: false }, true);
  });
});

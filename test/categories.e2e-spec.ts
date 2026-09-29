import {
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { CategoriesController } from '../src/modules/categories/categories.controller.js';
import { CategoriesService } from '../src/modules/categories/categories.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const adminId = '11111111-1111-4111-8111-111111111111';
const superAdminId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const activeCategoryId = '44444444-4444-4444-8444-444444444444';
const inactiveCategoryId = '55555555-5555-4555-8555-555555555555';

const publicCategory = {
  id: activeCategoryId,
  name: 'Burgerlar',
  slug: 'burgerlar',
  description: null,
  imageUrl: null,
  isActive: true,
  sortOrder: 1,
};

describe('CategoriesController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const categoriesService = {
    findPublic: vi.fn(),
    findOnePublic: vi.fn(),
    findAllForAdmin: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
    remove: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [CategoriesController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: UsersService, useValue: usersService },
        { provide: CategoriesService, useValue: categoriesService },
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
    usersService.findById.mockImplementation((id: string) => {
      const role =
        id === adminId
          ? UserRole.ADMIN
          : id === superAdminId
            ? UserRole.SUPER_ADMIN
            : UserRole.CUSTOMER;
      return Promise.resolve({ id, role, isBlocked: false });
    });
    categoriesService.findPublic.mockResolvedValue([publicCategory]);
    categoriesService.findOnePublic.mockImplementation((id: string) => {
      if (id === inactiveCategoryId) {
        throw new NotFoundException({
          error: 'CATEGORY_NOT_FOUND',
          message: 'Kategoriya topilmadi',
        });
      }
      return publicCategory;
    });
    categoriesService.findAllForAdmin.mockResolvedValue([
      publicCategory,
      { ...publicCategory, id: inactiveCategoryId, isActive: false },
    ]);
    categoriesService.create.mockImplementation((input) => ({
      ...publicCategory,
      ...input,
    }));
    categoriesService.update.mockImplementation((_id: string, input) => ({
      ...publicCategory,
      ...input,
    }));
    categoriesService.activate.mockResolvedValue({
      ...publicCategory,
      isActive: true,
    });
    categoriesService.deactivate.mockResolvedValue({
      ...publicCategory,
      isActive: false,
    });
    categoriesService.remove.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  function token(id: string, role: UserRole): string {
    return jwtService.sign(
      { sub: id, telegramId: '123456789', role },
      { secret, expiresIn: '5m' },
    );
  }

  function authorization(id: string, role: UserRole): string {
    return `Bearer ${token(id, role)}`;
  }

  it('serves the public category list without authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/categories')
      .expect(200, [publicCategory]);
  });

  it('serves an active public category', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/categories/${activeCategoryId}`)
      .expect(200, publicCategory);
  });

  it('returns 404 for an inactive public category', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/categories/${inactiveCategoryId}`)
      .expect(404);
  });

  it('allows ADMIN to manage categories', async () => {
    const auth = authorization(adminId, UserRole.ADMIN);
    await request(app.getHttpServer())
      .get('/api/v1/categories/manage')
      .set('Authorization', auth)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', auth)
      .send({ name: 'Burgerlar', sortOrder: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/categories/${activeCategoryId}`)
      .set('Authorization', auth)
      .send({ name: 'Burger va Sendvichlar' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/categories/${activeCategoryId}/deactivate`)
      .set('Authorization', auth)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/categories/${activeCategoryId}/activate`)
      .set('Authorization', auth)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/categories/${activeCategoryId}`)
      .set('Authorization', auth)
      .expect(204);
  });

  it.each([
    ['POST', '/api/v1/categories'],
    ['PATCH', `/api/v1/categories/${activeCategoryId}`],
    ['DELETE', `/api/v1/categories/${activeCategoryId}`],
    ['GET', '/api/v1/categories/manage'],
  ])('allows SUPER_ADMIN: %s %s', async (method, path) => {
    await request(app.getHttpServer())
      [method.toLowerCase() as 'get'](path)
      .set('Authorization', authorization(superAdminId, UserRole.SUPER_ADMIN))
      .send(method === 'POST' ? { name: 'Burgerlar' } : {})
      .expect(method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200);
  });

  it('denies CUSTOMER category management but allows public list', async () => {
    const auth = authorization(customerId, UserRole.CUSTOMER);
    await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', auth)
      .send({ name: 'Burgerlar' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/categories/manage')
      .set('Authorization', auth)
      .expect(403);
    await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
  });

  it('returns 401 for an unauthenticated create request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/categories')
      .send({ name: 'Burgerlar' })
      .expect(401);
  });

  it('rejects protected category fields from the request body', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/categories')
      .set('Authorization', authorization(adminId, UserRole.ADMIN))
      .send({ name: 'Burgerlar', slug: 'frontend-slug', isActive: false })
      .expect(400);
  });
});

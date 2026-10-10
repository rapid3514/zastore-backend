import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConfigService } from './helpers/config.js';
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
import { UserRole } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { ProductsController } from '../src/modules/products/products.controller.js';
import { ProductsService } from '../src/modules/products/products.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';

describe('Product Telegram sync endpoint (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const productsService = { syncTelegram: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [ProductsController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ProductsService, useValue: productsService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: createConfigService() },
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
    productsService.syncTelegram.mockResolvedValue({ id: productId });
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: userId, telegramId: '123', role, type: 'access' },
      { secret, expiresIn: '5m', issuer: 'zastore-shop', audience: 'zastore-mini-app', algorithm: 'HS256' },
    );
  }

  it('allows ADMIN force republish', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/telegram/sync`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ forceRepublish: true })
      .expect(200);
    expect(response.body).toEqual({ id: productId });
    expect(productsService.syncTelegram).toHaveBeenCalledWith(
      productId,
      true,
      userId,
    );
  });

  it('allows SUPER_ADMIN normal sync', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.SUPER_ADMIN,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/telegram/sync`)
      .set('Authorization', `Bearer ${token(UserRole.SUPER_ADMIN)}`)
      .send({})
      .expect(200);
    expect(productsService.syncTelegram).toHaveBeenCalledWith(
      productId,
      false,
      userId,
    );
  });

  it('rejects CUSTOMER manual sync', async () => {
    usersService.findById.mockResolvedValue({
      id: userId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/telegram/sync`)
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .send({})
      .expect(403);
    expect(productsService.syncTelegram).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated manual sync', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/products/${productId}/telegram/sync`)
      .send({})
      .expect(401);
    expect(productsService.syncTelegram).not.toHaveBeenCalled();
  });
});

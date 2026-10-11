import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma, ProductAvailabilityStatus, UserRole, WeekDay } from '../src/generated/prisma/client.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { HealthController } from '../src/modules/health/health.controller.js';
import { HealthService } from '../src/modules/health/health.service.js';
import { OrdersController } from '../src/modules/orders/orders.controller.js';
import { OrdersRepository } from '../src/modules/orders/orders.repository.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { WorkHoursRepository } from '../src/modules/work-hours/work-hours.repository.js';
import { WorkHoursService } from '../src/modules/work-hours/work-hours.service.js';
import { createConfigService, testConfiguration } from './helpers/config.js';

const userId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';

describe('Closed-store order DoS regression (real order/work-hours services)', () => {
  let app: INestApplication;
  let token: string;
  const createOrder = vi.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
      controllers: [OrdersController, HealthController],
      providers: [
        OrdersService, WorkHoursService, HealthService, JwtStrategy, JwtAuthGuard, RolesGuard,
        { provide: ConfigService, useValue: createConfigService() },
        { provide: PrismaService, useValue: { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]) } },
        { provide: UsersService, useValue: { findById: vi.fn().mockResolvedValue({ id: userId, telegramId: 123n, role: UserRole.CUSTOMER, isBlocked: false }) } },
        { provide: OrdersRepository, useValue: { findByIdempotencyKey: vi.fn().mockResolvedValue(null), findProductsForOrder: vi.fn().mockResolvedValue([{ id: productId, name: 'Product', price: new Prisma.Decimal('10.00'), isActive: true, availabilityStatus: ProductAvailabilityStatus.IN_STOCK, category: { isActive: true } }]), createOrder } },
        { provide: WorkHoursRepository, useValue: { findSchedule: vi.fn().mockResolvedValue(Object.values(WeekDay).map((dayOfWeek) => ({ dayOfWeek, isOpen: false, openTime: null, closeTime: null }))) } },
        { provide: AuditService, useValue: { log: vi.fn() } },
      ],
    }).compile();
    const auth = testConfiguration().auth;
    token = moduleRef.get(JwtService).sign({ sub: userId, telegramId: '123', role: UserRole.CUSTOMER, type: 'access' }, { secret: auth.accessSecret, issuer: auth.issuer, audience: auth.audience, algorithm: 'HS256', expiresIn: '5m' });
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => app.close());

  it('returns STORE_CLOSED 400 promptly while parallel health requests and a timer complete', async () => {
    const started = performance.now();
    const timer = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 10));
    const [order, ...health] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/orders').set('Authorization', `Bearer ${token}`).set('Idempotency-Key', '33333333-3333-4333-8333-333333333333').send({ deliveryAddress: 'Address', btcPostBranchNumber: '012', items: [{ productId, quantity: 1 }] }),
      ...Array.from({ length: 5 }, () => request(app.getHttpServer()).get('/api/v1/health')),
    ]);
    expect(order.status).toBe(400);
    expect(order.body.error).toBe('STORE_CLOSED');
    for (const response of health) expect(response.status).toBe(200);
    await expect(timer).resolves.toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

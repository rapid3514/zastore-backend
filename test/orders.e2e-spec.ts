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
import { OrdersController } from '../src/modules/orders/orders.controller.js';
import { OrdersService } from '../src/modules/orders/orders.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const customerId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const delivery = { deliveryAddress: 'Address', btcPostBranchNumber: '012' };

describe('OrdersController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const usersService = { findById: vi.fn() };
  const ordersService = {
    createOrder: vi.fn(),
    getMyOrders: vi.fn(),
    getManageOrders: vi.fn(),
    getManageSummary: vi.fn(),
    confirmOrder: vi.fn(),
    rejectOrder: vi.fn(),
    updateOrderStatus: vi.fn(),
    cancelMyOrder: vi.fn(),
    getMyOrder: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [OrdersController],
      providers: [
        OrdersService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ConfigService, useValue: createConfigService() },
        { provide: OrdersService, useValue: ordersService },
        { provide: UsersService, useValue: usersService },
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
      id: customerId,
      role: UserRole.CUSTOMER,
      isBlocked: false,
    });
    ordersService.createOrder.mockResolvedValue({
      id: 'order-1',
      status: 'PENDING_CONFIRMATION',
      subtotal: '12000.00',
      total: '12000.00',
      items: [],
    });
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: customerId, telegramId: '123456789', role, type: 'access' },
      {
        secret,
        expiresIn: '5m',
        issuer: 'zastore-shop',
        audience: 'zastore-mini-app',
        algorithm: 'HS256',
      },
    );
  }

  it('rejects guest order creation with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        ...delivery,
        items: [{ productId, quantity: 1 }],
        phone: '+998901234567',
        deliveryAddress: 'Address',
      })
      .expect(401);
  });

  it('creates a valid customer order with 201', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .set('Idempotency-Key', '66666666-6666-4666-8666-666666666666')
      .send({
        ...delivery,
        items: [{ productId, quantity: 2 }],
        phone: '+998901234567',
        deliveryAddress: 'Address',
      })
      .expect(201);

    expect(ordersService.createOrder).toHaveBeenCalled();
  });

  it('requires a valid checkout Idempotency-Key UUID header', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .send({ ...delivery, items: [{ productId, quantity: 1 }] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .set('Idempotency-Key', 'invalid')
      .send({ ...delivery, items: [{ productId, quantity: 1 }] })
      .expect(400);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it.each([
    { deliveryAddress: undefined },
    { deliveryAddress: null },
    { deliveryAddress: ' \t\n ' },
    { deliveryAddress: 123 },
    { deliveryAddress: 'a'.repeat(256) },
    { btcPostBranchNumber: undefined },
    { btcPostBranchNumber: null },
    { btcPostBranchNumber: ' \t\n ' },
    { btcPostBranchNumber: 123 },
    { btcPostBranchNumber: 'a'.repeat(51) },
  ])(
    'requires valid delivery details at customer submission: %j',
    async (invalid) => {
      await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
        .set('Idempotency-Key', '66666666-6666-4666-8666-666666666666')
        .send({ items: [{ productId, quantity: 1 }], ...delivery, ...invalid })
        .expect(400);
      expect(ordersService.createOrder).not.toHaveBeenCalled();
    },
  );

  it('normalizes delivery details and preserves postal branch leading zeros', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .set('Idempotency-Key', '66666666-6666-4666-8666-666666666666')
      .send({
        items: [{ productId, quantity: 1 }],
        deliveryAddress: '  Toshkent,   Chilonzor  ',
        btcPostBranchNumber: '  012  ',
      })
      .expect(201);
    expect(ordersService.createOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deliveryAddress: 'Toshkent, Chilonzor',
        btcPostBranchNumber: '012',
      }),
      '66666666-6666-4666-8666-666666666666',
    );
  });

  it.each([
    { items: [{ productId, quantity: 2147483648 }] },
    { items: [{ productId, quantity: 1001 }] },
    { items: [{ productId, quantity: 1.5 }] },
    { items: Array.from({ length: 101 }, () => ({ productId, quantity: 1 })) },
  ])(
    'rejects oversized checkout input before the service: %j',
    async (payload) => {
      await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
        .set('Idempotency-Key', '66666666-6666-4666-8666-666666666666')
        .send({ ...delivery, ...payload })
        .expect(400);
      expect(ordersService.createOrder).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid quantity with 400', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .send({
        ...delivery,
        items: [{ productId, quantity: 0 }],
        phone: '+998901234567',
        deliveryAddress: 'Address',
      })
      .expect(400);
  });

  it('rejects an empty cart, negative quantity, and client-supplied prices', async () => {
    const authorization = `Bearer ${token(UserRole.CUSTOMER)}`;
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', authorization)
      .send({ ...delivery, items: [] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', authorization)
      .send({ ...delivery, items: [{ productId, quantity: -1 }] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Authorization', authorization)
      .send({
        ...delivery,
        items: [{ productId, quantity: 1, price: 1 }],
        totalAmount: 1,
      })
      .expect(400);
    expect(ordersService.createOrder).not.toHaveBeenCalled();
  });

  it('rejects customer access to admin manage endpoints', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/orders/manage')
      .set('Authorization', `Bearer ${token(UserRole.CUSTOMER)}`)
      .expect(403);
  });

  it('returns the backend summary to admins', async () => {
    usersService.findById.mockResolvedValue({
      id: customerId,
      role: UserRole.ADMIN,
      isBlocked: false,
    });
    ordersService.getManageSummary.mockResolvedValue({
      orders: { total: 4, completedRevenue: '125000.00' },
      catalog: { productsTotal: 8 },
      customersWithOrders: 3,
      recentOrders: [],
    });

    await request(app.getHttpServer())
      .get('/api/v1/orders/manage/summary')
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.orders.total).toBe(4);
        expect(body.orders.completedRevenue).toBe('125000.00');
      });

    expect(ordersService.getManageSummary).toHaveBeenCalledOnce();
  });

  it('allows an admin to reject a pending order with a validated reason', async () => {
    usersService.findById.mockResolvedValue({
      id: customerId,
      role: UserRole.ADMIN,
      isBlocked: false,
    });
    ordersService.rejectOrder.mockResolvedValue({
      id: orderId,
      status: 'CANCELLED',
      cancelReason: 'Mahsulot qolmagan',
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/reject`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ reason: '  Mahsulot   qolmagan  ' })
      .expect(200);

    expect(ordersService.rejectOrder).toHaveBeenCalledWith(
      orderId,
      'Mahsulot qolmagan',
      customerId,
    );
  });

  it('rejects an invalid admin status before calling the service', async () => {
    usersService.findById.mockResolvedValue({
      id: customerId,
      role: UserRole.ADMIN,
      isBlocked: false,
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${token(UserRole.ADMIN)}`)
      .send({ status: 'NOT_A_STATUS' })
      .expect(400);

    expect(ordersService.updateOrderStatus).not.toHaveBeenCalled();
  });
});

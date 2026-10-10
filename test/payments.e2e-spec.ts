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
import { PaymentStatus, UserRole } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { PaymentsController } from '../src/modules/payments/payments.controller.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';

describe('PaymentsController (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let databaseRole: UserRole = UserRole.CUSTOMER;
  const users = {
    findById: vi.fn(() =>
      Promise.resolve({ id: userId, role: databaseRole, isBlocked: false }),
    ),
  };
  const payments = {
    createForOrder: vi.fn(),
    getForOrder: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [PaymentsController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: UsersService, useValue: users },
        { provide: PaymentsService, useValue: payments },
        { provide: ConfigService, useValue: createConfigService() },
      ],
    }).compile();
    jwt = moduleRef.get(JwtService);
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
    databaseRole = UserRole.CUSTOMER;
    payments.createForOrder.mockResolvedValue({ id: paymentId, orderId });
    payments.list.mockResolvedValue({ data: [], meta: {} });
  });

  afterAll(async () => app.close());

  function authorization(role: UserRole) {
    return `Bearer ${jwt.sign(
      { sub: userId, telegramId: '123', role, type: 'access' },
      { secret, expiresIn: '5m', issuer: 'zastore-shop', audience: 'zastore-mini-app', algorithm: 'HS256' },
    )}`;
  }

  it('lets CUSTOMER create a payment only through the authenticated identity', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${orderId}/payment`)
      .set('Authorization', authorization(UserRole.CUSTOMER))
      .send({ amount: 1, paid: true })
      .expect(201);
    expect(payments.createForOrder).toHaveBeenCalledWith(userId, orderId);
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'lets %s access payment management',
    async (role) => {
      databaseRole = role;
      await request(app.getHttpServer())
        .get(
          `/api/v1/payments/manage?status=${PaymentStatus.PENDING}&page=2&limit=10`,
        )
        .set('Authorization', authorization(role))
        .expect(200);
      expect(payments.list).toHaveBeenCalledWith({
        status: PaymentStatus.PENDING,
        page: 2,
        limit: 10,
      });
    },
  );

  it('denies CUSTOMER payment management and invalid pagination', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/payments/manage')
      .set('Authorization', authorization(UserRole.CUSTOMER))
      .expect(403);

    databaseRole = UserRole.ADMIN;
    await request(app.getHttpServer())
      .get('/api/v1/payments/manage?limit=101')
      .set('Authorization', authorization(UserRole.ADMIN))
      .expect(400);
  });
});

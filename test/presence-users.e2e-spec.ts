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
import { UserRole } from '../src/generated/prisma/client.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { PresenceController } from '../src/modules/presence/presence.controller.js';
import { PresenceService } from '../src/modules/presence/presence.service.js';
import { AdminCustomersController } from '../src/modules/users/admin-customers.controller.js';
import { SuperAdminUsersController } from '../src/modules/users/super-admin-users.controller.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('presence and role-scoped user management (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let databaseRole = UserRole.CUSTOMER;
  let databaseBlocked = false;
  const lastSeenAt = new Date(Date.now() - 30_000);
  const repository = {
    findById: vi.fn(() =>
      Promise.resolve({
        id: userId,
        role: databaseRole,
        isBlocked: databaseBlocked,
      }),
    ),
    updateLastSeen: vi.fn(() => Promise.resolve({ id: userId })),
    list: vi.fn(() =>
      Promise.resolve({
        data: [
          {
            id: userId,
            telegramId: 123456789n,
            firstName: 'Ali',
            lastName: 'Valiyev',
            username: 'ali',
            phone: '+998901234567',
            avatarUrl: null,
            role: UserRole.CUSTOMER,
            isBlocked: false,
            lastSeenAt,
          },
        ],
        total: 1,
      }),
    ),
    getDashboardStats: vi.fn(() =>
      Promise.resolve({
        totalUsers: 3,
        onlineUsers: 2,
        totalCustomers: 1,
        onlineCustomers: 1,
        totalAdmins: 1,
        onlineAdmins: 1,
      }),
    ),
    getCustomerStats: vi.fn(() =>
      Promise.resolve({ totalCustomers: 1, onlineCustomers: 1 }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [
        PresenceController,
        AdminCustomersController,
        SuperAdminUsersController,
      ],
      providers: [
        UsersService,
        PresenceService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: UsersRepository, useValue: repository },
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
    databaseRole = UserRole.CUSTOMER;
    databaseBlocked = false;
  });

  afterAll(async () => app.close());

  function authorization(role: UserRole) {
    const token = jwtService.sign(
      { sub: userId, telegramId: '123456789', role },
      { secret, expiresIn: '5m' },
    );
    return `Bearer ${token}`;
  }

  it.each([UserRole.CUSTOMER, UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'allows %s to update only its authenticated presence',
    async (role) => {
      await request(app.getHttpServer())
        .post('/api/v1/presence/ping')
        .send({})
        .set('Authorization', authorization(role))
        .expect(201, { success: true });

      expect(repository.updateLastSeen).toHaveBeenCalledWith(
        userId,
        expect.any(Date),
      );
    },
  );

  it('returns 401 for an unauthenticated presence ping', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/presence/ping')
      .expect(401);
    expect(repository.updateLastSeen).not.toHaveBeenCalled();
  });

  it('rejects GUEST and blocked-user presence updates', async () => {
    databaseRole = UserRole.GUEST;
    await request(app.getHttpServer())
      .post('/api/v1/presence/ping')
      .set('Authorization', authorization(UserRole.GUEST))
      .expect(403);

    databaseRole = UserRole.CUSTOMER;
    databaseBlocked = true;
    await request(app.getHttpServer())
      .post('/api/v1/presence/ping')
      .set('Authorization', authorization(UserRole.CUSTOMER))
      .expect(403);

    expect(repository.updateLastSeen).not.toHaveBeenCalled();
  });

  it('lets SUPER_ADMIN list all users with computed presence', async () => {
    databaseRole = UserRole.SUPER_ADMIN;
    const response = await request(app.getHttpServer())
      .get('/api/v1/super-admin/users?online=true')
      .set('Authorization', authorization(UserRole.SUPER_ADMIN))
      .expect(200);

    expect(repository.list).toHaveBeenCalledWith(
      { online: true },
      { onlineSince: expect.any(Date) },
    );
    expect(response.body.items[0]).toMatchObject({
      role: UserRole.CUSTOMER,
      telegramId: '123456789',
      isOnline: true,
    });
  });

  it('forces ADMIN customer lists to CUSTOMER even when role=ADMIN is sent', async () => {
    databaseRole = UserRole.ADMIN;
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/customers?role=ADMIN')
      .set('Authorization', authorization(UserRole.ADMIN))
      .expect(200);

    expect(repository.list).toHaveBeenCalledWith(
      { role: UserRole.ADMIN },
      {
        forcedRole: UserRole.CUSTOMER,
        onlineSince: expect.any(Date),
      },
    );
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].role).toBe(UserRole.CUSTOMER);
  });

  it('never lets ADMIN access SUPER_ADMIN user routes', async () => {
    databaseRole = UserRole.ADMIN;
    await request(app.getHttpServer())
      .get('/api/v1/super-admin/users')
      .set('Authorization', authorization(UserRole.ADMIN))
      .expect(403);
  });

  it('returns role-scoped dashboard stats', async () => {
    databaseRole = UserRole.SUPER_ADMIN;
    await request(app.getHttpServer())
      .get('/api/v1/super-admin/dashboard/stats')
      .set('Authorization', authorization(UserRole.SUPER_ADMIN))
      .expect(200, {
        totalUsers: 3,
        onlineUsers: 2,
        totalCustomers: 1,
        onlineCustomers: 1,
        totalAdmins: 1,
        onlineAdmins: 1,
      });
    expect(repository.getDashboardStats).toHaveBeenCalledWith(expect.any(Date));

    databaseRole = UserRole.ADMIN;
    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/stats')
      .set('Authorization', authorization(UserRole.ADMIN))
      .expect(200, { totalCustomers: 1, onlineCustomers: 1 });
    expect(repository.getCustomerStats).toHaveBeenCalledWith(expect.any(Date));
  });
});

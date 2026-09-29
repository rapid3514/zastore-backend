import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { AdminsController } from '../src/modules/admins/admins.controller.js';
import { AdminsService } from '../src/modules/admins/admins.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const adminId = '22222222-2222-4222-8222-222222222222';
const superAdminId = '11111111-1111-4111-8111-111111111111';
const customerId = '33333333-3333-4333-8333-333333333333';

describe('AdminsController access (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const usersService = { findById: vi.fn() };
  const adminsService = {
    me: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    promote: vi.fn(),
    demote: vi.fn(),
    block: vi.fn(),
    unblock: vi.fn(),
    update: vi.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
      controllers: [AdminsController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: UsersService, useValue: usersService },
        { provide: AdminsService, useValue: adminsService },
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
        id === superAdminId
          ? UserRole.SUPER_ADMIN
          : id === adminId
            ? UserRole.ADMIN
            : UserRole.CUSTOMER;
      return Promise.resolve({ id, role, isBlocked: false });
    });
    adminsService.me.mockImplementation((id: string) => ({ id }));
    adminsService.list.mockReturnValue([
      { id: adminId, role: UserRole.ADMIN },
    ]);
    adminsService.getById.mockImplementation((_actorId: string, id: string) => ({
      id,
      role: UserRole.ADMIN,
    }));
    adminsService.promote.mockImplementation((_actorId: string, id: string) => ({
      id,
      role: UserRole.ADMIN,
    }));
    adminsService.demote.mockImplementation((_actorId: string, id: string) => ({
      id,
      role: UserRole.CUSTOMER,
    }));
    adminsService.block.mockImplementation((_actorId: string, id: string) => ({
      id,
      isBlocked: true,
    }));
    adminsService.unblock.mockImplementation((_actorId: string, id: string) => ({
      id,
      isBlocked: false,
    }));
    adminsService.update.mockImplementation(
      (_actorId: string, id: string, input: Record<string, unknown>) => ({
        id,
        ...input,
      }),
    );
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

  it.each([
    ['ADMIN', adminId, UserRole.ADMIN],
    ['SUPER_ADMIN', superAdminId, UserRole.SUPER_ADMIN],
  ])('%s can GET /admins/me', async (_label, id, role) => {
    await request(app.getHttpServer())
      .get('/api/v1/admins/me')
      .set('Authorization', `Bearer ${token(id, role)}`)
      .expect(200, { id });
  });

  it('CUSTOMER gets 403 from GET /admins/me', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admins/me')
      .set('Authorization', `Bearer ${token(customerId, UserRole.CUSTOMER)}`)
      .expect(403);
  });

  it('unauthenticated request gets 401 from GET /admins/me', async () => {
    await request(app.getHttpServer()).get('/api/v1/admins/me').expect(401);
  });

  it('SUPER_ADMIN can list ADMIN users', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admins')
      .set(
        'Authorization',
        `Bearer ${token(superAdminId, UserRole.SUPER_ADMIN)}`,
      )
      .expect(200, [{ id: adminId, role: UserRole.ADMIN }]);
  });

  it.each([
    ['ADMIN', adminId, UserRole.ADMIN],
    ['CUSTOMER', customerId, UserRole.CUSTOMER],
  ])('%s gets 403 from GET /admins', async (_label, id, role) => {
    await request(app.getHttpServer())
      .get('/api/v1/admins')
      .set('Authorization', `Bearer ${token(id, role)}`)
      .expect(403);
  });

  it('SUPER_ADMIN can promote a customer', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${customerId}/promote`)
      .set(
        'Authorization',
        `Bearer ${token(superAdminId, UserRole.SUPER_ADMIN)}`,
      )
      .expect(200, { id: customerId, role: UserRole.ADMIN });
    expect(adminsService.promote).toHaveBeenCalledWith(
      superAdminId,
      customerId,
    );
  });

  it.each([
    ['ADMIN', adminId, UserRole.ADMIN],
    ['CUSTOMER', customerId, UserRole.CUSTOMER],
  ])('%s gets 403 from promote', async (_label, id, role) => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${customerId}/promote`)
      .set('Authorization', `Bearer ${token(id, role)}`)
      .expect(403);
  });

  it('SUPER_ADMIN can demote an ADMIN', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}/demote`)
      .set(
        'Authorization',
        `Bearer ${token(superAdminId, UserRole.SUPER_ADMIN)}`,
      )
      .expect(200, { id: adminId, role: UserRole.CUSTOMER });
  });

  it('ADMIN cannot demote another ADMIN', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}/demote`)
      .set('Authorization', `Bearer ${token(adminId, UserRole.ADMIN)}`)
      .expect(403);
  });

  it('SUPER_ADMIN can block and unblock an ADMIN', async () => {
    const authorization = `Bearer ${token(
      superAdminId,
      UserRole.SUPER_ADMIN,
    )}`;
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}/block`)
      .set('Authorization', authorization)
      .expect(200, { id: adminId, isBlocked: true });
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}/unblock`)
      .set('Authorization', authorization)
      .expect(200, { id: adminId, isBlocked: false });
  });

  it('ADMIN cannot block another ADMIN', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}/block`)
      .set('Authorization', `Bearer ${token(adminId, UserRole.ADMIN)}`)
      .expect(403);
  });

  it('SUPER_ADMIN can view and edit an ADMIN profile', async () => {
    const authorization = `Bearer ${token(
      superAdminId,
      UserRole.SUPER_ADMIN,
    )}`;
    await request(app.getHttpServer())
      .get(`/api/v1/admins/${adminId}`)
      .set('Authorization', authorization)
      .expect(200, { id: adminId, role: UserRole.ADMIN });
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}`)
      .set('Authorization', authorization)
      .send({ firstName: 'Updated Admin' })
      .expect(200, { id: adminId, firstName: 'Updated Admin' });
  });

  it('admin profile edit rejects protected fields', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/admins/${adminId}`)
      .set(
        'Authorization',
        `Bearer ${token(superAdminId, UserRole.SUPER_ADMIN)}`,
      )
      .send({ role: UserRole.SUPER_ADMIN })
      .expect(400);
  });

  it('blocked ADMIN gets 403 from admin routes', async () => {
    usersService.findById.mockResolvedValue({
      id: adminId,
      role: UserRole.ADMIN,
      isBlocked: true,
    });
    await request(app.getHttpServer())
      .get('/api/v1/admins/me')
      .set('Authorization', `Bearer ${token(adminId, UserRole.ADMIN)}`)
      .expect(403);
  });
});

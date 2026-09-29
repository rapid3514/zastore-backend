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
import { UsersController } from '../src/modules/users/users.controller.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('GET /api/v1/users (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  const repository = { findById: vi.fn(), list: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [UsersController],
      providers: [
        UsersService,
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
    repository.findById.mockResolvedValue({
      id: userId,
      role: UserRole.SUPER_ADMIN,
      isBlocked: false,
    });
    repository.list.mockResolvedValue({
      data: [
        {
          id: userId,
          telegramId: 123456789n,
          firstName: 'Ali',
          lastName: null,
          username: 'ali',
          phone: '+998901234567',
          phoneVerifiedAt: new Date('2026-09-24T00:00:00.000Z'),
          avatarUrl: null,
          role: UserRole.CUSTOMER,
          isBlocked: false,
          createdAt: new Date('2026-09-24T00:00:00.000Z'),
          updatedAt: new Date('2026-09-24T00:00:00.000Z'),
          password: 'must-not-leak',
          secret: 'must-not-leak',
        },
      ],
      total: 21,
    });
  });

  afterAll(async () => app.close());

  function token(role: UserRole) {
    return jwtService.sign(
      { sub: userId, telegramId: '123456789', role },
      { secret, expiresIn: '5m' },
    );
  }

  it('returns a paginated, safe response to SUPER_ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users?page=2&limit=10&role=CUSTOMER&search=ali')
      .set('Authorization', `Bearer ${token(UserRole.SUPER_ADMIN)}`)
      .expect(200);

    expect(repository.list).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      role: UserRole.CUSTOMER,
      search: 'ali',
    });
    expect(response.body.meta).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(response.body.data[0]).toMatchObject({
      telegramId: '123456789',
      role: UserRole.CUSTOMER,
      phone: '+998901234567',
    });
    expect(response.body.data[0]).not.toHaveProperty('password');
    expect(response.body.data[0]).not.toHaveProperty('secret');
  });

  it('defaults to page 1 and limit 20', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token(UserRole.SUPER_ADMIN)}`)
      .expect(200);
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 20,
      total: 21,
      totalPages: 2,
    });
  });

  it.each([UserRole.ADMIN, UserRole.CUSTOMER, UserRole.GUEST])(
    'denies %s',
    async (role) => {
      repository.findById.mockResolvedValue({
        id: userId,
        role,
        isBlocked: false,
      });
      await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token(role)}`)
        .expect(403);
      expect(repository.list).not.toHaveBeenCalled();
    },
  );

  it('denies a request without a token', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  it('rejects a limit above 100 or an invalid role', async () => {
    const authorization = `Bearer ${token(UserRole.SUPER_ADMIN)}`;
    await request(app.getHttpServer())
      .get('/api/v1/users?limit=101')
      .set('Authorization', authorization)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/users?role=INVALID')
      .set('Authorization', authorization)
      .expect(400);
  });
});

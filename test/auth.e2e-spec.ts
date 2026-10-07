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
import { UserRole } from '../src/generated/prisma/client.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';

const secret = 'test-access-secret-with-at-least-32-characters';
const userId = '11111111-1111-4111-8111-111111111111';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const auth = {
    authenticateCustomer: vi.fn(),
    authenticateAdmin: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    refreshCookieMaxAge: vi.fn().mockReturnValue(60_000),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        { provide: AuthService, useValue: auth },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              key === 'NODE_ENV'
                ? 'test'
                : key === 'API_PREFIX'
                  ? 'api/v1'
                  : secret,
          },
        },
      ],
    }).compile();
    jwt = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    auth.me.mockImplementation((user) => Promise.resolve({ user }));
  });

  afterAll(async () => app.close());

  function authorization(role: UserRole, expiresIn: string | number = '5m') {
    return `Bearer ${jwt.sign(
      { sub: userId, telegramId: '123', role },
      { secret, expiresIn },
    )}`;
  }

  it('returns 401 without an access token or with an invalid token', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it.each([UserRole.CUSTOMER, UserRole.ADMIN, UserRole.SUPER_ADMIN])(
    'accepts a valid %s access token',
    async (role) => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', authorization(role))
        .expect(200);
      expect(response.body.user).toMatchObject({ sub: userId, role });
    },
  );

  it('rejects an expired access token', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', authorization(UserRole.CUSTOMER, -1))
      .expect(401);
  });

  it('logs out the refresh session and clears the cookie', async () => {
    auth.logout.mockResolvedValue(undefined);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', 'refresh_token=refresh-value')
      .expect(204);

    expect(auth.logout).toHaveBeenCalledWith('refresh-value');
    expect(response.headers['set-cookie']?.[0]).toContain('refresh_token=;');
  });
});

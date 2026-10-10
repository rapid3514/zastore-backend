import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { SignOptions } from 'jsonwebtoken';
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
import { createConfigService, testConfiguration } from './helpers/config.js';

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
          useValue: createConfigService(),
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

  function authorization(
    role: UserRole,
    expiresIn: SignOptions['expiresIn'] = '5m',
  ) {
    return `Bearer ${jwt.sign(
      { sub: userId, telegramId: '123', role, type: 'access' },
      {
        secret,
        expiresIn,
        issuer: 'zastore-shop',
        audience: 'zastore-mini-app',
        algorithm: 'HS256',
      },
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

  it('rejects a refresh-purpose token presented as an access token', async () => {
    const token = jwt.sign(
      {
        sub: userId,
        telegramId: '123',
        role: UserRole.CUSTOMER,
        type: 'refresh',
      },
      {
        secret,
        issuer: 'zastore-shop',
        audience: 'zastore-mini-app',
        algorithm: 'HS256',
        expiresIn: '1m',
      },
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('rejects malformed percent-encoding in refresh cookies with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'refresh_token=%E0%A4%A')
      .expect(401);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('does not accept an access token without exp', async () => {
    const token = jwt.sign(
      {
        sub: userId,
        telegramId: '123',
        role: UserRole.CUSTOMER,
        type: 'access',
      },
      {
        secret,
        issuer: 'zastore-shop',
        audience: 'zastore-mini-app',
        algorithm: 'HS256',
      },
    );
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});

describe('production refresh cookie security (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const runtime = testConfiguration();
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            authenticateCustomer: () =>
              Promise.resolve({
                body: { registered: true },
                refreshToken: 'opaque-refresh-value',
              }),
            refreshCookieMaxAge: () => 60_000,
          },
        },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            runtime: {
              ...runtime,
              app: {
                ...runtime.app,
                isProduction: true,
                environment: 'production',
              },
            },
          }),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => app.close());

  it('sets HttpOnly, Secure, SameSite=Lax and a scoped auth path', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/telegram')
      .send({ initData: 'verified-by-auth-service' })
      .expect(201);
    const cookie = response.headers['set-cookie']?.[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).not.toContain('Domain=');
  });
});

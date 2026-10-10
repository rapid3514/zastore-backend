import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthRepository } from '../src/modules/auth/auth.repository.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TelegramInitDataService } from '../src/modules/auth/services/telegram-init-data.service.js';
import { TokenService } from '../src/modules/auth/services/token.service.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { createConfigService } from './helpers/config.js';

/** Opt-in: migrate a disposable database, then set TEST_DATABASE_URL. */
describe('refresh rotation with real PostgreSQL transactions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: AuthRepository;
  let tokens: TokenService;
  let userId: string;
  let rootId: string;
  let rootToken: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl)
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    const databaseName = decodeURIComponent(
      new URL(databaseUrl).pathname.slice(1),
    );
    if (!/(?:^|_)(?:test|audit|security)(?:_|$)/i.test(databaseName)) {
      throw new Error(
        'Refusing integration writes: database name must contain a test, audit or security segment',
      );
    }
    const config = createConfigService({ DATABASE_URL: databaseUrl });
    prisma = new PrismaService(config);
    await prisma.$connect();
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [AuthController],
      providers: [
        AuthService,
        AuthRepository,
        UsersService,
        UsersRepository,
        TokenService,
        TelegramInitDataService,
        JwtService,
        JwtStrategy,
        JwtAuthGuard,
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    repository = moduleRef.get(AuthRepository);
    tokens = moduleRef.get(TokenService);
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

  beforeEach(async () => {
    userId = randomUUID();
    rootId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        telegramId: BigInt(`8${Date.now()}${Math.floor(Math.random() * 1000)}`),
        firstName: 'Security integration',
        role: UserRole.CUSTOMER,
        phone: `+998${Date.now()}`,
        phoneVerifiedAt: new Date(),
      },
    });
    rootToken = await tokens.signRefresh({
      sub: userId,
      telegramId: '123',
      role: UserRole.CUSTOMER,
      sid: rootId,
      fid: rootId,
    });
    await repository.createRefreshSession({
      id: rootId,
      familyId: rootId,
      userId,
      tokenHash: await argon2.hash(rootToken),
      expiresAt: tokens.refreshExpiresAt(),
    });
  });

  afterEach(async () => {
    if (userId && prisma)
      await prisma.user.deleteMany({ where: { id: userId } });
  });

  afterAll(async () => {
    if (app) await app.close();
    else if (prisma) await prisma.$disconnect();
  });

  it('atomically consumes a root once and creates exactly one active replacement', async () => {
    const replacementHash = await argon2.hash(randomUUID());
    const replacement = () => ({
      id: randomUUID(),
      familyId: rootId,
      parentId: rootId,
      userId,
      tokenHash: replacementHash,
      expiresAt: tokens.refreshExpiresAt(),
    });
    const results = await Promise.all([
      repository.rotateRefreshSession(rootId, replacement()),
      repository.rotateRefreshSession(rootId, replacement()),
    ]);
    expect(results.sort((left, right) => Number(left) - Number(right))).toEqual(
      [false, true],
    );
    expect(
      await prisma.refreshSession.count({
        where: { familyId: rootId, revokedAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.refreshSession.count({ where: { parentId: rootId } }),
    ).toBe(1);
    expect(
      (await repository.findRefreshSession(rootId))?.revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('returns one success and one 401 for simultaneous HTTP refresh requests', async () => {
    const results = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${rootToken}`),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `refresh_token=${rootToken}`),
    ]);
    expect(
      results
        .map((result) => result.status)
        .sort((left, right) => left - right),
    ).toEqual([201, 401]);
    expect(
      await prisma.refreshSession.count({
        where: { familyId: rootId, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('revokes the entire family when a consumed token is replayed later', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${rootToken}`)
      .expect(201);
    expect(
      await prisma.refreshSession.count({
        where: { familyId: rootId, revokedAt: null },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${rootToken}`)
      .expect(401);
    expect(
      await prisma.refreshSession.count({
        where: { familyId: rootId, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('revokes a replacement if logout arrives with the just-consumed root token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${rootToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `refresh_token=${rootToken}`)
      .expect(204);
    expect(await prisma.refreshSession.count({
      where: { familyId: rootId, revokedAt: null },
    })).toBe(0);
  });

  it('rejects a blocked user and revokes its refresh family', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { isBlocked: true },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `refresh_token=${rootToken}`)
      .expect(401);
    expect(
      await prisma.refreshSession.count({
        where: { familyId: rootId, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('returns only the authenticated profile even when another user ID is supplied', async () => {
    const victim = await prisma.user.create({
      data: {
        telegramId: BigInt(`7${Date.now()}`),
        firstName: 'Other customer',
        role: UserRole.CUSTOMER,
      },
    });
    try {
      const access = await tokens.signAccess({
        sub: userId,
        telegramId: '123',
        role: UserRole.CUSTOMER,
      });
      const response = await request(app.getHttpServer())
        .get(`/api/v1/auth/me?userId=${victim.id}`)
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
      expect(response.body.user.id).toBe(userId);
      expect(response.body.user.id).not.toBe(victim.id);
      expect(response.body.user).not.toHaveProperty('refreshSessions');
      expect(response.body.user).not.toHaveProperty('tokenHash');
      await prisma.user.update({
        where: { id: userId },
        data: { isBlocked: true },
      });
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${access}`)
        .expect(401);
    } finally {
      await prisma.user.delete({ where: { id: victim.id } });
    }
  });
});

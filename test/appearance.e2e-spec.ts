import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy.js';
import { AppearanceController } from '../src/modules/appearance/appearance.controller.js';
import { AppearanceService } from '../src/modules/appearance/appearance.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { createConfigService } from './helpers/config.js';

describe('Bot appearance access and validation (e2e)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const users = { findById: vi.fn() };
  const appearance = { findPublic: vi.fn(), findSuperAdmin: vi.fn(), update: vi.fn() };
  const image = { fileId: 'background-1', url: 'https://ik.imagekit.io/shop/products/background.webp' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
      controllers: [AppearanceController],
      providers: [JwtStrategy, JwtAuthGuard, RolesGuard,
        { provide: ConfigService, useValue: createConfigService() },
        { provide: UsersService, useValue: users },
        { provide: AppearanceService, useValue: appearance }],
    }).compile();
    jwt = moduleRef.get(JwtService);
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    vi.resetAllMocks();
    users.findById.mockResolvedValue({ role: 'ADMIN', isBlocked: false });
    appearance.findPublic.mockResolvedValue({ backgroundUrl: null, updatedAt: null });
    appearance.findSuperAdmin.mockResolvedValue({ backgroundUrl: image.url, updatedAt: null });
    appearance.update.mockResolvedValue({ backgroundUrl: image.url, updatedAt: new Date().toISOString() });
  });

  const authorization = (role = 'ADMIN') => `Bearer ${jwt.sign(
    { sub: '11111111-1111-4111-8111-111111111111', telegramId: '123456789', role, type: 'access' },
    { secret: 'test-access-secret-with-at-least-32-characters', expiresIn: '5m', issuer: 'zastore-shop', audience: 'zastore-mini-app', algorithm: 'HS256' },
  )}`;

  it('allows everyone to read the public background', async () => {
    await request(app.getHttpServer()).get('/api/v1/appearance').expect(200, { backgroundUrl: null, updatedAt: null });
  });
  it('requires authentication for changes', async () => {
    await request(app.getHttpServer()).patch('/api/v1/appearance').send({ background: image }).expect(401);
    expect(appearance.update).not.toHaveBeenCalled();
  });
  it('rejects customers and blocked administrators', async () => {
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization('CUSTOMER')).send({ background: image }).expect(403);
    users.findById.mockResolvedValueOnce({ role: 'ADMIN', isBlocked: true });
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization()).send({ background: image }).expect(403);
    expect(appearance.update).not.toHaveBeenCalled();
  });
  it.each(['ADMIN'])('allows %s to save the store background', async (role) => {
    users.findById.mockResolvedValue({ role, isBlocked: false });
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization(role)).send({ background: image }).expect(200);
    expect(appearance.update).toHaveBeenCalledWith({ background: image }, '11111111-1111-4111-8111-111111111111');
  });

  it('allows super admins to read, save, and reset their separate background', async () => {
    users.findById.mockResolvedValue({ role: 'SUPER_ADMIN', isBlocked: false });
    const token = authorization('SUPER_ADMIN');
    await request(app.getHttpServer()).get('/api/v1/appearance/super-admin').set('Authorization', token)
      .expect(200, { backgroundUrl: image.url, updatedAt: null });
    await request(app.getHttpServer()).patch('/api/v1/appearance/super-admin').set('Authorization', token)
      .send({ background: image }).expect(200);
    expect(appearance.update).toHaveBeenLastCalledWith({ background: image }, '11111111-1111-4111-8111-111111111111', 'super-admin');
    await request(app.getHttpServer()).patch('/api/v1/appearance/super-admin').set('Authorization', token)
      .send({ background: null }).expect(200);
    expect(appearance.update).toHaveBeenLastCalledWith({ background: null }, '11111111-1111-4111-8111-111111111111', 'super-admin');
    expect(appearance.findPublic).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'CUSTOMER', 'GUEST'])('prevents %s from reading or changing the super admin background', async (role) => {
    users.findById.mockResolvedValue({ role, isBlocked: false });
    const token = authorization(role);
    await request(app.getHttpServer()).get('/api/v1/appearance/super-admin').set('Authorization', token).expect(403);
    await request(app.getHttpServer()).patch('/api/v1/appearance/super-admin').set('Authorization', token)
      .send({ background: image }).expect(403);
    expect(appearance.findSuperAdmin).not.toHaveBeenCalled();
    expect(appearance.update).not.toHaveBeenCalled();
  });

  it('requires authentication and rejects blocked super admins for the separate background', async () => {
    await request(app.getHttpServer()).get('/api/v1/appearance/super-admin').expect(401);
    await request(app.getHttpServer()).patch('/api/v1/appearance/super-admin').send({ background: null }).expect(401);
    users.findById.mockResolvedValue({ role: 'SUPER_ADMIN', isBlocked: true });
    await request(app.getHttpServer()).patch('/api/v1/appearance/super-admin').set('Authorization', authorization('SUPER_ADMIN'))
      .send({ background: null }).expect(403);
    expect(appearance.update).not.toHaveBeenCalled();
  });

  it('does not let a super admin overwrite the store background through the old endpoint', async () => {
    users.findById.mockResolvedValue({ role: 'SUPER_ADMIN', isBlocked: false });
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization('SUPER_ADMIN'))
      .send({ background: image }).expect(403);
    expect(appearance.update).not.toHaveBeenCalled();
  });
  it('supports resetting to the default', async () => {
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization()).send({ background: null }).expect(200);
    expect(appearance.update).toHaveBeenCalledWith({ background: null }, expect.any(String));
  });
  it.each([{}, { background: {} }, { background: 'url' }, { background: { fileId: '', url: image.url } }, { background: { fileId: 'file', url: 'http://insecure.example/image.jpg' } }, { background: image, role: 'ADMIN' }])('rejects invalid input %j', async (input) => {
    await request(app.getHttpServer()).patch('/api/v1/appearance').set('Authorization', authorization()).send(input).expect(400);
    expect(appearance.update).not.toHaveBeenCalled();
  });
});

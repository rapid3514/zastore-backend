import { Body, Controller, Get, InternalServerErrorException, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureHttpSecurity } from '../src/common/security/http-security.js';
import { productionEnvironment, testConfiguration } from './helpers/config.js';

@Controller()
class SecurityTestController {
  @Get('health') health() { return { status: 'ok' }; }
  @Get('products') products() { return []; }
  @Get('profile') profile() { return { id: 'private' }; }
  @Get('error') error() { throw new InternalServerErrorException('postgresql://user:password@db secret-token stacktrace'); }
  @Post('echo') echo(@Body() body: unknown) { return body; }
  @Get('protocol') protocol() { return { ok: true }; }
}

describe('production HTTP security (e2e)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [SecurityTestController] }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    const config = testConfiguration({ ...productionEnvironment, TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128,::ffff:127.0.0.1/128', REQUEST_BODY_LIMIT_BYTES: 1024 });
    configureHttpSecurity(app, config);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('allows trusted origin and adds production security headers', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/products').set('X-Forwarded-Proto', 'https').set('Origin', 'https://shop.zastore.uz').expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://shop.zastore.uz');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['cache-control']).toContain('public');
  });
  it.each(['https://attacker.com', 'https://shop.zastore.uz.attacker.com'])('rejects untrusted origin %s without CORS reflection', async (origin) => {
    const response = await request(app.getHttpServer()).get('/api/v1/products').set('X-Forwarded-Proto', 'https').set('Origin', origin).expect(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects insecure production requests before handlers and emits no auth cookie', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/protocol').expect(400);
    expect(response.body.error).toBe('HTTPS_REQUIRED');
    expect(response.headers['set-cookie']).toBeUndefined();
    const catalog = await request(app.getHttpServer()).get('/api/v1/products').expect(400);
    expect(catalog.headers['cache-control']).toBe('private, no-store');
  });
  it('allows server-to-server requests without Origin and keeps private responses uncacheable', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/profile').set('X-Forwarded-Proto', 'https').expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('returns a controlled 413 for oversized bodies and 400 for malformed JSON', async () => {
    const oversized = await request(app.getHttpServer()).post('/api/v1/echo').set('X-Forwarded-Proto', 'https').send({ data: 'x'.repeat(2048) }).expect(413);
    expect(oversized.body.message).toBe('Request body is too large');
    await request(app.getHttpServer()).post('/api/v1/echo').set('X-Forwarded-Proto', 'https').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
  it('never exposes internal error details and prevents caching errors', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/error').set('X-Forwarded-Proto', 'https').expect(500);
    expect(response.body).toEqual({ statusCode: 500, error: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' });
    expect(JSON.stringify(response.body)).not.toMatch(/password|secret|postgresql|stacktrace/);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
  it('ignores spoofed protocol headers from an untrusted network peer', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [SecurityTestController] }).compile();
    const isolated = moduleRef.createNestApplication({ bodyParser: false });
    configureHttpSecurity(isolated, testConfiguration({ ...productionEnvironment, TRUST_PROXY_CIDRS: '192.0.2.10/32' }));
    await isolated.init();
    try {
      const response = await request(isolated.getHttpServer()).get('/api/v1/protocol').set('X-Forwarded-Proto', 'https').set('X-Forwarded-For', '192.0.2.10').expect(400);
      expect(response.body.error).toBe('HTTPS_REQUIRED');
    } finally { await isolated.close(); }
  });
});

import { describe, expect, it } from 'vitest';
import { productionEnvironment, testEnvironment } from '../../test/helpers/config.js';
import { createConfiguration, telegramWebhookUrl } from './configuration.js';
import { validateEnvironment } from './env.schema.js';

describe('canonical environment validation', () => {
  it('validates a complete production environment and bounded media defaults', () => {
    expect(validateEnvironment(productionEnvironment)).toMatchObject({ NODE_ENV: 'production', MEDIA_MAX_IMAGE_BYTES: 5 * 1024 * 1024, MEDIA_MAX_VIDEO_BYTES: 150 * 1024 * 1024 });
  });
  it.each(['APP_PUBLIC_URL', 'MINI_APP_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_PUBLIC_KEY', 'IMAGEKIT_URL_ENDPOINT', 'TELEGRAM_CHANNEL_ID', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_MINI_APP_SHORT_NAME'] as const)('requires %s in production', (key) => {
    expect(() => validateEnvironment({ ...productionEnvironment, [key]: undefined })).toThrow(key);
  });
  it('allows missing provider settings in tests', () => {
    expect(validateEnvironment(testEnvironment)).toMatchObject({ NODE_ENV: 'test', IMAGEKIT_PRODUCT_FOLDER: '/products' });
  });
  it.each([undefined, '', 'prod', 'staging'])('fails fast for invalid NODE_ENV=%s', (value) => {
    expect(() => validateEnvironment({ ...testEnvironment, NODE_ENV: value })).toThrow('NODE_ENV');
  });
  it.each(['1', 'secret', '123456', 'a'.repeat(48), 'replace_with_a_long_random_secret_123456'])('rejects weak production secrets', (value) => {
    expect(() => validateEnvironment({ ...productionEnvironment, JWT_ACCESS_SECRET: value })).toThrow('JWT_ACCESS_SECRET');
    expect(() => validateEnvironment({ ...productionEnvironment, TELEGRAM_WEBHOOK_SECRET: value })).toThrow('TELEGRAM_WEBHOOK_SECRET');
  });
  it('rejects equal access and refresh secrets', () => {
    expect(() => validateEnvironment({ ...productionEnvironment, JWT_REFRESH_SECRET: productionEnvironment.JWT_ACCESS_SECRET })).toThrow('must differ');
  });
  it.each(['http://api.zastore.uz', 'https://localhost', 'https://example.com', 'https://your-api.invalid', 'https://staging.test', 'https://legacy.trycloudflare.com'])('rejects accidental production public URL %s', (value) => {
    expect(() => validateEnvironment({ ...productionEnvironment, APP_PUBLIC_URL: value })).toThrow('APP_PUBLIC_URL');
  });
  it('rejects unknown application configuration names without echoing their values', () => {
    expect(() => validateEnvironment({ ...testEnvironment, APP_UNRECOGNIZED: 'sensitive-do-not-echo' })).toThrow('APP_UNRECOGNIZED');
    expect(() => validateEnvironment({ ...testEnvironment, APP_UNRECOGNIZED: 'sensitive-do-not-echo' })).not.toThrow('sensitive-do-not-echo');
  });
  it.each(['*', 'https://trusted.zastore.uz/path', 'invalid'])('rejects non-origin CORS entries %s', (value) => {
    expect(() => validateEnvironment({ ...testEnvironment, CORS_ALLOWED_ORIGINS: value })).toThrow('CORS_ALLOWED_ORIGINS');
  });
  it('derives Mini App and admin origins and normalizes URLs once', () => {
    const config = createConfiguration(validateEnvironment({ ...testEnvironment, ADMIN_APP_URL: 'https://admin.zastore.uz/console/', CORS_ALLOWED_ORIGINS: 'https://partner.zastore.uz', APP_PUBLIC_URL: 'https://backend.example/' }));
    expect(config.app.corsOrigins).toEqual(['https://mini-app.example', 'https://admin.zastore.uz', 'https://partner.zastore.uz']);
    expect(config.app.publicUrl).toBe('https://backend.example');
    expect(config.telegram.webhookUrl).toBe('https://backend.example/api/v1/telegram/webhook');
  });
  it('rejects duplicated derived CORS configuration', () => {
    expect(() => validateEnvironment({ ...testEnvironment, CORS_ALLOWED_ORIGINS: 'https://mini-app.example' })).toThrow('must not duplicate');
  });
  it.each(['true', '0.0.0.0/0', '::/0', '127.0.0.1/33'])('rejects unsafe proxy trust %s', (value) => {
    expect(() => validateEnvironment({ ...testEnvironment, TRUST_PROXY_CIDRS: value })).toThrow('TRUST_PROXY_CIDRS');
  });
  it('derives the public URL from Render and trusts exactly one documented proxy hop', () => {
    const environment = validateEnvironment({ ...productionEnvironment, APP_PUBLIC_URL: undefined, RENDER_EXTERNAL_HOSTNAME: 'zastore-backend.onrender.com', TRUST_PROXY_HOPS: '1' });
    expect(environment.APP_PUBLIC_URL).toBe('https://zastore-backend.onrender.com');
    expect(createConfiguration(environment).app.trustProxy).toBe(1);
  });
  it('rejects mixed proxy trust strategies', () => {
    expect(() => validateEnvironment({ ...testEnvironment, TRUST_PROXY_CIDRS: '172.30.0.0/24', TRUST_PROXY_HOPS: '1' })).toThrow('cannot be combined');
  });
  it('uses exact boolean semantics', () => {
    expect(validateEnvironment({ ...testEnvironment, TELEGRAM_MINI_APP_USE_MAIN: 'false' }).TELEGRAM_MINI_APP_USE_MAIN).toBe(false);
  });
  it.each([0, 20 * 1024 * 1024, Number.POSITIVE_INFINITY])('rejects unsafe image byte limit %s', (value) => {
    expect(() => validateEnvironment({ ...testEnvironment, MEDIA_MAX_IMAGE_BYTES: value })).toThrow('MEDIA_MAX_IMAGE_BYTES');
  });
});

describe('canonical Telegram webhook URL', () => {
  it('always keeps the configured origin and canonical path', () => {
    expect(telegramWebhookUrl('https://api.zastore.uz')).toBe('https://api.zastore.uz/api/v1/telegram/webhook');
  });
  it.each(['http://api.zastore.uz', 'https://api.zastore.uz/other', 'https://user:password@api.zastore.uz', 'invalid'])('rejects unsafe backend URL %s', (value) => {
    expect(() => telegramWebhookUrl(value)).toThrow();
  });
});

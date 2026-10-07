import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './env.schema.js';

const productionEnvironment = {
  NODE_ENV: 'production',
  PORT: '3000',
  API_PREFIX: 'api/v1',
  TZ: 'Asia/Tashkent',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_EXPIRES_IN: '30d',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '300',
  CORS_ORIGINS: 'https://admin.example',
  IMAGEKIT_PRIVATE_KEY: 'private_test',
  IMAGEKIT_PUBLIC_KEY: 'public_test',
  IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
  TELEGRAM_CHANNEL_ID: '@shop_channel',
  TELEGRAM_BOT_USERNAME: 'lumiera_bot',
  TELEGRAM_MINI_APP_SHORT_NAME: 'shop',
};

describe('media environment validation', () => {
  it.each([
    'IMAGEKIT_PRIVATE_KEY',
    'IMAGEKIT_PUBLIC_KEY',
    'IMAGEKIT_URL_ENDPOINT',
    'TELEGRAM_CHANNEL_ID',
    'TELEGRAM_BOT_USERNAME',
    'TELEGRAM_MINI_APP_SHORT_NAME',
  ] as const)('requires %s in production', (key) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment, [key]: undefined }),
    ).toThrow(key);
  });

  it('allows missing provider configuration in tests', () => {
    expect(
      validateEnvironment({
        ...productionEnvironment,
        NODE_ENV: 'test',
        IMAGEKIT_PRIVATE_KEY: '',
        IMAGEKIT_PUBLIC_KEY: '',
        IMAGEKIT_URL_ENDPOINT: '',
        TELEGRAM_CHANNEL_ID: '',
      }),
    ).toMatchObject({ NODE_ENV: 'test', IMAGEKIT_PRODUCT_FOLDER: '/products' });
  });

  it('keeps shop URL optional and applies media defaults', () => {
    const environment = validateEnvironment(productionEnvironment);
    expect(environment).toMatchObject({
      IMAGEKIT_PRODUCT_FOLDER: '/products',
      IMAGEKIT_MAX_IMAGE_BYTES: 0,
    });
    expect(environment).not.toHaveProperty('TELEGRAM_SHOP_URL');
  });

  it.each(['not-a-number', '-1'])(
    'rejects invalid IMAGEKIT_MAX_IMAGE_BYTES=%s',
    (value) => {
      expect(() =>
        validateEnvironment({
          ...productionEnvironment,
          IMAGEKIT_MAX_IMAGE_BYTES: value,
        }),
      ).toThrow('IMAGEKIT_MAX_IMAGE_BYTES');
    },
  );

  it.each(['0', String(100 * 1024 * 1024)])(
    'accepts deprecated no-enforcement IMAGEKIT_MAX_IMAGE_BYTES=%s',
    (value) => {
      expect(
        validateEnvironment({
          ...productionEnvironment,
          IMAGEKIT_MAX_IMAGE_BYTES: value,
        }).IMAGEKIT_MAX_IMAGE_BYTES,
      ).toBe(Number(value));
    },
  );

  it.each(['@public_channel', '-1001234567890'])(
    'preserves Telegram channel ID string %s',
    (channelId) => {
      expect(
        validateEnvironment({
          ...productionEnvironment,
          TELEGRAM_CHANNEL_ID: channelId,
        }).TELEGRAM_CHANNEL_ID,
      ).toBe(channelId);
    },
  );
});

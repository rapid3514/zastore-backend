import { ConfigService } from '@nestjs/config';
import { createConfiguration, type RuntimeConfig } from '../../src/config/configuration.js';
import { validateEnvironment } from '../../src/config/env.schema.js';

export const testEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_ACCESS_SECRET: 'test-access-secret-with-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
  MINI_APP_URL: 'https://mini-app.example/app',
  APP_PUBLIC_URL: 'https://backend.example',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
};

export const productionEnvironment = {
  ...testEnvironment,
  NODE_ENV: 'production',
  APP_PUBLIC_URL: 'https://api.zastore.uz',
  MINI_APP_URL: 'https://shop.zastore.uz/app',
  DATABASE_URL: 'postgresql://test:TestDbPassword_7H9K2m4Q@postgres:5432/test',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'x8Fh2Qn7pR4vA9sM6kD1uG5bJ0cL3eT8wY2zN9oP4rV7',
  JWT_REFRESH_SECRET: 'r4S9vB1nX6pM3kF8tA5wD2hJ7qG0cL9eY4uN6zR8oP1bV',
  TELEGRAM_WEBHOOK_SECRET: 'w7H2nQ8pR4vA9sM6kD1uG5bJ0cL3eT8yZ2xN9oP4rV7',
  IMAGEKIT_PRIVATE_KEY: 'private_test',
  IMAGEKIT_PUBLIC_KEY: 'public_test',
  IMAGEKIT_URL_ENDPOINT: 'https://ik.imagekit.io/account',
  TELEGRAM_CHANNEL_ID: '@shop_channel',
  TELEGRAM_BOT_USERNAME: 'lumiera_bot',
  TELEGRAM_MINI_APP_SHORT_NAME: 'shop',
};

export function testConfiguration(overrides: Record<string, unknown> = {}): RuntimeConfig {
  return createConfiguration(validateEnvironment({ ...testEnvironment, ...overrides }));
}

export function createConfigService(overrides: Record<string, unknown> = {}): ConfigService {
  return new ConfigService({ runtime: testConfiguration(overrides) });
}

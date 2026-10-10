import {
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramInitDataService } from './telegram-init-data.service.js';
import { createConfigService } from '../../../../test/helpers/config.js';

const botToken = 'test-bot-token';
const now = 1_800_000_000_000;

function signedInitData(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    auth_date: String(now / 1000),
    user: JSON.stringify({
      id: 123456789,
      first_name: 'Aziz',
      username: 'aziz',
    }),
    ...overrides,
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set(
    'hash',
    createHmac('sha256', secret).update(dataCheckString).digest('hex'),
  );
  return params.toString();
}

function service(token = botToken) {
  return new TelegramInitDataService(
    createConfigService({ TELEGRAM_BOT_TOKEN: token || undefined }),
  );
}

describe('TelegramInitDataService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts valid Telegram Mini App initData', () => {
    expect(service().verify(signedInitData())).toMatchObject({
      id: 123456789n,
      firstName: 'Aziz',
    });
  });

  it('rejects an invalid hash', () => {
    expect(() => service().verify(`${signedInitData()}x`)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects expired initData', () => {
    expect(() =>
      service().verify(signedInitData({ auth_date: String(now / 1000 - 301) })),
    ).toThrow(UnauthorizedException);
  });

  it('rejects initData without a user', () => {
    const params = new URLSearchParams(signedInitData());
    params.delete('user');
    expect(() => service().verify(params.toString())).toThrow(
      UnauthorizedException,
    );
  });

  it('reports a configuration error when no bot token is set', () => {
    expect(() => service('').verify(signedInitData())).toThrow(
      InternalServerErrorException,
    );
  });
});

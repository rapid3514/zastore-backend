import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TelegramInitDataUser {
  id: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

@Injectable()
export class TelegramInitDataService {
  constructor(
    private readonly configService: ConfigService,
  ) {}

  verify(initData: string): TelegramInitDataUser {
    const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      throw new InternalServerErrorException(
        'Telegram authentication is not configured',
      );
    }
    if (!initData || typeof initData !== 'string') {
      throw new UnauthorizedException('Invalid Telegram initData');
    }

    let values: URLSearchParams;
    try {
      values = new URLSearchParams(initData);
    } catch {
      throw new UnauthorizedException('Invalid Telegram initData');
    }

    const receivedHash = values.get('hash');
    const authDate = values.get('auth_date');
    const userJson = values.get('user');
    if (
      !receivedHash ||
      !/^[a-fA-F0-9]{64}$/.test(receivedHash) ||
      !authDate ||
      !userJson
    ) {
      throw new UnauthorizedException('Invalid Telegram initData');
    }

    values.delete('hash');
    const dataCheckString = [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();
    const expectedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest();
    const receivedHashBuffer = Buffer.from(receivedHash, 'hex');
    if (
      receivedHashBuffer.length !== expectedHash.length ||
      !timingSafeEqual(receivedHashBuffer, expectedHash)
    ) {
      throw new UnauthorizedException('Invalid Telegram initData');
    }

    if (!/^\d+$/.test(authDate))
      throw new UnauthorizedException('Invalid Telegram initData');
const ageSeconds = Math.floor(Date.now() / 1000) - Number(authDate);
    const maximumAge = this.configService.getOrThrow<number>(
      'TELEGRAM_INIT_DATA_MAX_AGE_SECONDS',
    );
    if (ageSeconds < 0 || ageSeconds > maximumAge) {
      throw new UnauthorizedException('Telegram initData has expired');
    }

    try {
      const parsed: unknown = JSON.parse(userJson);
      if (!parsed || typeof parsed !== 'object')
        throw new Error('Invalid user');
      const user = parsed as Record<string, unknown>;
      const rawId = user.id;
      const id =
        typeof rawId === 'string'
          ? rawId
          : typeof rawId === 'number' && Number.isSafeInteger(rawId)
            ? String(rawId)
            : '';
      if (
        !/^\d+$/.test(id) ||
        typeof user.first_name !== 'string' ||
        !user.first_name
      ) {
        throw new Error('Invalid user');
      }
      return {
        id: BigInt(id),
        firstName: user.first_name,
        lastName:
          typeof user.last_name === 'string' ? user.last_name : undefined,
        username: typeof user.username === 'string' ? user.username : undefined,
        photoUrl:
          typeof user.photo_url === 'string' ? user.photo_url : undefined,
      };
    } catch {
      throw new UnauthorizedException('Invalid Telegram user data');
    }
  }
}

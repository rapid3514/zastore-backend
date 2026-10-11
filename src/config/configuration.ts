import type { ConfigService } from '@nestjs/config';
import { validateEnvironment, type Environment } from './env.schema.js';

export const TELEGRAM_WEBHOOK_PATH = '/api/v1/telegram/webhook';

export function telegramWebhookUrl(publicUrl: string): string {
  const base = new URL(publicUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('APP_PUBLIC_URL must be an HTTPS origin');
  const webhook = new URL(TELEGRAM_WEBHOOK_PATH, base);
  if (webhook.origin !== base.origin) throw new Error('Webhook origin must match APP_PUBLIC_URL');
  return webhook.toString();
}

const normalizeUrl = (value: string | undefined): string | undefined => value ? new URL(value).toString().replace(/\/$/, '') : undefined;

export function createConfiguration(environment: Environment) {
  const publicUrl = normalizeUrl(environment.APP_PUBLIC_URL);
  const miniAppUrl = normalizeUrl(environment.MINI_APP_URL);
  const adminAppUrl = normalizeUrl(environment.ADMIN_APP_URL);
  const corsOrigins = [...new Set([
    ...[miniAppUrl, adminAppUrl].filter((value): value is string => Boolean(value)).map((value) => new URL(value).origin),
    ...(environment.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin),
  ])];
  const trustedCidrs = environment.TRUST_PROXY_CIDRS.split(',').map((value) => value.trim()).filter(Boolean);
  const trustProxy = trustedCidrs.length ? trustedCidrs : environment.TRUST_PROXY_HOPS || false;
  return {
    app: { environment: environment.NODE_ENV, isProduction: environment.NODE_ENV === 'production', port: environment.PORT, apiPrefix: environment.API_PREFIX, timeZone: environment.TZ, publicUrl, miniAppUrl, adminAppUrl, corsOrigins, trustProxy, bodyLimitBytes: environment.REQUEST_BODY_LIMIT_BYTES },
    auth: { accessSecret: environment.JWT_ACCESS_SECRET, refreshSecret: environment.JWT_REFRESH_SECRET, accessExpiresIn: environment.JWT_ACCESS_EXPIRES_IN, refreshExpiresIn: environment.JWT_REFRESH_EXPIRES_IN, issuer: environment.JWT_ISSUER, audience: environment.JWT_AUDIENCE },
    database: { url: environment.DATABASE_URL },
    redis: { url: environment.REDIS_URL },
    telegram: { botToken: environment.TELEGRAM_BOT_TOKEN, webhookSecret: environment.TELEGRAM_WEBHOOK_SECRET, initDataMaxAgeSeconds: environment.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS, superAdminTelegramId: environment.SUPER_ADMIN_TELEGRAM_ID, channelId: environment.TELEGRAM_CHANNEL_ID, botUsername: environment.TELEGRAM_BOT_USERNAME, miniAppShortName: environment.TELEGRAM_MINI_APP_SHORT_NAME, miniAppUseMain: environment.TELEGRAM_MINI_APP_USE_MAIN, miniAppUrl, webhookUrl: publicUrl?.startsWith('https:') ? telegramWebhookUrl(publicUrl) : undefined },
    media: { privateKey: environment.IMAGEKIT_PRIVATE_KEY, publicKey: environment.IMAGEKIT_PUBLIC_KEY, urlEndpoint: normalizeUrl(environment.IMAGEKIT_URL_ENDPOINT), productFolder: environment.IMAGEKIT_PRODUCT_FOLDER, maxImageBytes: environment.MEDIA_MAX_IMAGE_BYTES, maxImageWidth: environment.MEDIA_MAX_IMAGE_WIDTH, maxImageHeight: environment.MEDIA_MAX_IMAGE_HEIGHT, maxVideoBytes: environment.MEDIA_MAX_VIDEO_BYTES, maxVideoDurationSeconds: environment.MEDIA_MAX_VIDEO_DURATION_SECONDS },
    orders: { expirationIntervalMs: environment.ORDER_EXPIRATION_INTERVAL_MS },
    outbox: { pollIntervalMs: environment.OUTBOX_POLL_INTERVAL_MS, maxAttempts: environment.OUTBOX_MAX_ATTEMPTS },
  };
}

export type RuntimeConfig = ReturnType<typeof createConfiguration>;

export function getConfiguration(configService: ConfigService): RuntimeConfig {
  return configService.getOrThrow<RuntimeConfig>('runtime');
}

export default () => ({ runtime: createConfiguration(validateEnvironment(process.env)) });

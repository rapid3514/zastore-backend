import { isIP } from 'node:net';
import { z } from 'zod';

const optionalString = z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional());
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.url().optional());
const duration = z.string().regex(/^[1-9]\d*[smhd]$/);
const boolean = z.preprocess((value) => value === undefined || value === '' ? false : value, z.union([z.boolean(), z.enum(['true', 'false'])]).transform((value) => value === true || value === 'true'));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.literal('api/v1').default('api/v1'),
  TZ: z.string().default('Asia/Tashkent').refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'must be an IANA timezone'),
  APP_PUBLIC_URL: optionalUrl,
  MINI_APP_URL: optionalUrl,
  ADMIN_APP_URL: optionalUrl,
  CORS_ALLOWED_ORIGINS: optionalString,
  TRUST_PROXY_CIDRS: z.string().default(''),
  REQUEST_BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(1024 * 1024).default(65_536),
  DATABASE_URL: z.url().startsWith('postgresql://'),
  REDIS_URL: z.preprocess((value) => value === '' ? undefined : value, z.url().regex(/^rediss?:\/\//).optional()),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: duration.default('15m'),
  JWT_REFRESH_EXPIRES_IN: duration.default('30d'),
  JWT_ISSUER: z.string().min(3).default('zastore-shop'),
  JWT_AUDIENCE: z.string().min(3).default('zastore-mini-app'),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  SUPER_ADMIN_TELEGRAM_ID: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^\d+$/).optional()),
  TELEGRAM_CHANNEL_ID: optionalString,
  TELEGRAM_BOT_USERNAME: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^[A-Za-z0-9_]{5,32}$/).optional()),
  TELEGRAM_MINI_APP_SHORT_NAME: z.preprocess((value) => value === '' ? undefined : value, z.string().regex(/^[A-Za-z0-9_]{3,64}$/).optional()),
  TELEGRAM_MINI_APP_USE_MAIN: boolean,
  IMAGEKIT_PRIVATE_KEY: optionalString,
  IMAGEKIT_PUBLIC_KEY: optionalString,
  IMAGEKIT_URL_ENDPOINT: optionalUrl,
  IMAGEKIT_PRODUCT_FOLDER: z.string().regex(/^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/).default('/products'),
  MEDIA_MAX_IMAGE_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(5 * 1024 * 1024),
  MEDIA_MAX_IMAGE_WIDTH: z.coerce.number().int().min(64).max(8192).default(6000),
  MEDIA_MAX_IMAGE_HEIGHT: z.coerce.number().int().min(64).max(8192).default(6000),
  MEDIA_MAX_VIDEO_BYTES: z.coerce.number().int().min(1024).max(200 * 1024 * 1024).default(150 * 1024 * 1024),
  MEDIA_MAX_VIDEO_DURATION_SECONDS: z.coerce.number().int().min(1).max(180).default(60),
  ORDER_EXPIRATION_INTERVAL_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(8),
}).superRefine((environment, context) => {
  const issue = (key: string, message: string) => context.addIssue({ code: 'custom', path: [key], message });
  if (environment.JWT_ACCESS_SECRET === environment.JWT_REFRESH_SECRET) issue('JWT_REFRESH_SECRET', 'must differ from the access secret');
  for (const value of environment.TRUST_PROXY_CIDRS.split(',').map((item) => item.trim()).filter(Boolean)) {
    const [address, prefix, ...rest] = value.split('/');
    const family = isIP(address);
    if (!family || rest.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) issue('TRUST_PROXY_CIDRS', 'must contain explicit IP addresses or CIDR networks');
    if (prefix === '0') issue('TRUST_PROXY_CIDRS', 'cannot trust every address');
  }
  for (const key of ['APP_PUBLIC_URL', 'MINI_APP_URL', 'ADMIN_APP_URL', 'IMAGEKIT_URL_ENDPOINT'] as const) {
    const value = environment[key];
    if (!value) continue;
    if (!URL.canParse(value)) continue;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) issue(key, 'must be an HTTP(S) URL without credentials, query or fragment');
    if (key === 'APP_PUBLIC_URL' && url.pathname !== '/') issue(key, 'must be a base origin without a path');
    if ((environment.NODE_ENV === 'production' || key === 'IMAGEKIT_URL_ENDPOINT') && url.protocol !== 'https:') issue(key, 'must use HTTPS');
    if (environment.NODE_ENV === 'production' && isUntrustedProductionHost(url.hostname)) issue(key, 'must use a real production hostname');
  }
  const extras = (environment.CORS_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const derived = [environment.MINI_APP_URL, environment.ADMIN_APP_URL].filter((value): value is string => typeof value === 'string' && URL.canParse(value)).map((value) => new URL(value).origin);
  for (const value of extras) {
    let url: URL;
    try { url = new URL(value); } catch { issue('CORS_ALLOWED_ORIGINS', 'must contain explicit origins'); continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) issue('CORS_ALLOWED_ORIGINS', 'must contain only HTTP(S) origins');
    if (derived.includes(url.origin)) issue('CORS_ALLOWED_ORIGINS', 'must not duplicate the Mini App or admin origin');
    if (environment.NODE_ENV === 'production' && (url.protocol !== 'https:' || isUntrustedProductionHost(url.hostname))) issue('CORS_ALLOWED_ORIGINS', 'must contain real HTTPS production origins');
  }
  if (environment.NODE_ENV !== 'production') return;
  for (const key of ['APP_PUBLIC_URL', 'MINI_APP_URL', 'REDIS_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'IMAGEKIT_PRIVATE_KEY', 'IMAGEKIT_PUBLIC_KEY', 'IMAGEKIT_URL_ENDPOINT', 'TELEGRAM_CHANNEL_ID', 'TELEGRAM_BOT_USERNAME'] as const) {
    if (!environment[key]) issue(key, 'is required in production');
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TELEGRAM_WEBHOOK_SECRET'] as const) {
    const secret = environment[key];
    if (!secret || !isStrongSecret(secret)) issue(key, 'must contain at least 32 random characters with sufficient diversity');
  }
  if (environment.TELEGRAM_WEBHOOK_SECRET && !/^[A-Za-z0-9_-]+$/.test(environment.TELEGRAM_WEBHOOK_SECRET)) issue('TELEGRAM_WEBHOOK_SECRET', 'must use Telegram secret-token characters');
  if (!environment.TELEGRAM_MINI_APP_USE_MAIN && !environment.TELEGRAM_MINI_APP_SHORT_NAME) issue('TELEGRAM_MINI_APP_SHORT_NAME', 'is required unless the main Mini App is enabled');
});

function isUntrustedProductionHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.trycloudflare.com') || host === 'example.com' || host.endsWith('.example.com') || host.endsWith('.example') || host.endsWith('.invalid') || /placeholder|your[-.]|replace[-_]/i.test(host) || Boolean(isIP(host));
}

function isStrongSecret(value: string): boolean {
  return value.length >= 32 && new Set(value).size >= 16 && !/(replace|example|password|secret|123456|placeholder)/i.test(value);
}

export type Environment = z.infer<typeof envSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const unknown = Object.keys(config).filter((key) => /^(?:APP_|ADMIN_APP_|MINI_APP_|CORS_|BACKEND_|FRONTEND_|WEBAPP_|MINIAPP_|JWT_|TELEGRAM_|IMAGEKIT_|MEDIA_|DATABASE_|REDIS_|ORDER_EXPIRATION_|OUTBOX_|TRUST_PROXY_|REQUEST_BODY_)/.test(key) && !(key in envSchema.shape));
  if (unknown.length) throw new Error(`Unknown application configuration: ${unknown.sort().join(', ')}`);
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return parsed.data;
}

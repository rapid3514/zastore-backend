import { z } from 'zod';

const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'must use a duration such as 15m or 30d');

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const optionalHttpsUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().startsWith('https://').optional(),
);

const optionalTelegramBotUsername = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(
      /^[A-Za-z0-9_]{5,32}$/,
      'must be a 5-32 character Telegram username without @',
    )
    .optional(),
);

const optionalTelegramMiniAppShortName = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(
      /^[A-Za-z0-9_]{3,64}$/,
      'must be a 3-64 character Telegram Mini App short name',
    )
    .optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535),
    API_PREFIX: z.string().min(1).default('api/v1'),
    TZ: z.string().min(1).default('Asia/Tashkent'),
    DATABASE_URL: z.string().url().startsWith('postgresql://'),
    DATABASE_URL_DOCKER: z
      .string()
      .url()
      .startsWith('postgresql://')
      .optional(),
    REDIS_URL: z.string().url().startsWith('redis://').optional(),
    REDIS_URL_DOCKER: z.string().url().startsWith('redis://').optional(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: durationSchema,
    JWT_REFRESH_EXPIRES_IN: durationSchema,
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive(),
    SUPER_ADMIN_TELEGRAM_ID: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .or(z.literal('')),
    BACKEND_PUBLIC_URL: z.string().url().startsWith('https://').optional(),
    MINI_APP_URL: z.string().url().optional(),
    ADMIN_APP_URL: z.string().url().optional(),
    CORS_ORIGINS: z.string().min(1),
    IMAGEKIT_PRIVATE_KEY: optionalNonEmptyString,
    IMAGEKIT_PUBLIC_KEY: optionalNonEmptyString,
    IMAGEKIT_URL_ENDPOINT: optionalHttpsUrl,
    IMAGEKIT_PRODUCT_FOLDER: z
      .string()
      .regex(
        /^\/[A-Za-z0-9/_-]*[A-Za-z0-9_-]$/,
        'must be an absolute folder path',
      )
      .default('/products'),
    IMAGEKIT_MAX_IMAGE_BYTES: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .default(0),
    TELEGRAM_CHANNEL_ID: optionalNonEmptyString,
    TELEGRAM_SHOP_URL: optionalHttpsUrl,
    TELEGRAM_BOT_USERNAME: optionalTelegramBotUsername,
    TELEGRAM_MINI_APP_SHORT_NAME: optionalTelegramMiniAppShortName,
    TELEGRAM_MINI_APP_USE_MAIN: z
      .preprocess((value) => (value === '' ? undefined : value), z.coerce.boolean())
      .default(false),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV !== 'production') return;
    if (!environment.TELEGRAM_BOT_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'is required in production',
      });
    }
    if (!environment.TELEGRAM_WEBHOOK_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message: 'is required in production',
      });
    }
    for (const key of [
      'IMAGEKIT_PRIVATE_KEY',
      'IMAGEKIT_PUBLIC_KEY',
      'IMAGEKIT_URL_ENDPOINT',
      'TELEGRAM_CHANNEL_ID',
      'TELEGRAM_BOT_USERNAME',
    ] as const) {
      if (!environment[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'is required in production',
        });
      }
    }
    if (!environment.TELEGRAM_MINI_APP_USE_MAIN && !environment.TELEGRAM_MINI_APP_SHORT_NAME) {
      context.addIssue({
        code: 'custom',
        path: ['TELEGRAM_MINI_APP_SHORT_NAME'],
        message: 'is required unless TELEGRAM_MINI_APP_USE_MAIN is enabled',
      });
    }
  });

export type Environment = z.infer<typeof envSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  const origins = parsed.data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    !origins.length ||
    origins.some((origin) => origin === '*' || !URL.canParse(origin))
  ) {
    throw new Error(
      'Invalid environment configuration: CORS_ORIGINS must contain explicit valid origins',
    );
  }

  return parsed.data;
}

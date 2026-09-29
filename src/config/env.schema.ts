import { z } from 'zod';

const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'must use a duration such as 15m or 30d');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535),
  API_PREFIX: z.string().min(1).default('api/v1'),
  TZ: z.string().min(1).default('Asia/Tashkent'),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  DATABASE_URL_DOCKER: z.string().url().startsWith('postgresql://').optional(),
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

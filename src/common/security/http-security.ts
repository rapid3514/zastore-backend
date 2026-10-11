import { ForbiddenException, RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import helmet from 'helmet';
import type { RuntimeConfig } from '../../config/configuration.js';
import { HttpExceptionFilter } from '../filters/http-exception.filter.js';

export function isTrustedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return url.origin === origin && allowedOrigins.includes(origin);
  } catch { return false; }
}

export function configureHttpSecurity(app: INestApplication, config: RuntimeConfig): void {
  const server: Express = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  server.set('trust proxy', config.app.trustProxy);
  app.setGlobalPrefix(config.app.apiPrefix, { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.use(express.json({ limit: config.app.bodyLimitBytes, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: config.app.bodyLimitBytes, parameterLimit: 100 }));
  app.use(helmet({
    strictTransportSecurity: config.app.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const publicCatalog = request.method === 'GET' && !request.path.includes('/manage') && /^\/api\/v1\/(?:products(?:\/[^/]+)?|categories)\/?$/.test(request.path);
    response.setHeader('Cache-Control', publicCatalog && !request.headers.authorization && !request.headers.cookie ? 'public, max-age=15, stale-while-revalidate=30' : 'private, no-store');
    response.vary('Authorization');
    response.vary('Cookie');
    if (config.app.isProduction && request.path !== '/health' && !request.secure) {
      response.setHeader('Cache-Control', 'private, no-store');
      response.status(400).json({ statusCode: 400, error: 'HTTPS_REQUIRED', message: 'HTTPS is required' });
      return;
    }
    next();
  });
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => isTrustedOrigin(origin, config.app.corsOrigins) ? callback(null, true) : callback(new ForbiddenException('Origin is not allowed')),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
}

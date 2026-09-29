import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { TelegramService } from './modules/telegram/telegram.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const corsOrigins = configService
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.setGlobalPrefix(
    configService.getOrThrow<string>('API_PREFIX').replace(/^\/+|\/+$/g, ''),
  );
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  await app.get(TelegramService).setMyCommands();
  await app.listen(configService.getOrThrow<number>('PORT'));
}
await bootstrap();

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getConfiguration } from './config/configuration.js';
import { configureHttpSecurity } from './common/security/http-security.js';
import { RedactingLogger } from './common/security/redacting-logger.js';
import { TelegramService } from './modules/telegram/telegram.service.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: false });
  const config = getConfiguration(app.get(ConfigService));
  app.useLogger(new RedactingLogger(config));
  configureHttpSecurity(app, config);
  app.enableShutdownHooks();
  const telegram = app.get(TelegramService);
  await Promise.all([telegram.setMyCommands(), telegram.setWebhook()]);
  await app.listen(config.app.port);
}
await bootstrap();

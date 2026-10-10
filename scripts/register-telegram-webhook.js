import 'dotenv/config';
import { createConfiguration } from '../src/config/configuration.ts';
import { validateEnvironment } from '../src/config/env.schema.ts';

async function updateWebhook() {
  const config = createConfiguration(validateEnvironment(process.env));
  const { botToken, webhookSecret, webhookUrl } = config.telegram;
  if (!botToken || !webhookSecret || !webhookUrl) {
    throw new Error('Telegram webhook configuration is incomplete');
  }
  const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const result = await response.json();
  if (!response.ok || typeof result !== 'object' || result === null || result.ok !== true) {
    throw new Error('Telegram webhook registration failed');
  }
  const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
    signal: AbortSignal.timeout(8_000),
  });
  const infoResult = await infoResponse.json();
  if (
    !infoResponse.ok ||
    typeof infoResult !== 'object' ||
    infoResult === null ||
    !('ok' in infoResult) ||
    infoResult.ok !== true ||
    !('result' in infoResult) ||
    typeof infoResult.result !== 'object' ||
    infoResult.result === null ||
    !('url' in infoResult.result) ||
    infoResult.result.url !== webhookUrl
  ) {
    throw new Error('Telegram webhook URL verification failed');
  }
  console.log('Telegram webhook registered for configured application origin');
}

try {
  await updateWebhook();
} catch {
  console.error('Telegram webhook setup failed; verify application configuration and Telegram connectivity');
  process.exitCode = 1;
}

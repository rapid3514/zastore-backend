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
  const info = infoResult.result;
  console.log(JSON.stringify({
    status: 'registered',
    url: info.url,
    pendingUpdateCount: typeof info.pending_update_count === 'number'
      ? info.pending_update_count
      : null,
    lastErrorDate: typeof info.last_error_date === 'number'
      ? new Date(info.last_error_date * 1000).toISOString()
      : null,
    lastErrorMessage: typeof info.last_error_message === 'string'
      ? info.last_error_message
      : null,
  }));
}

try {
  await updateWebhook();
} catch {
  console.error('Telegram webhook setup failed; verify application configuration and Telegram connectivity');
  process.exitCode = 1;
}

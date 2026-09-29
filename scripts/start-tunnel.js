import 'dotenv/config';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const backendPublicUrl = process.env.BACKEND_PUBLIC_URL;
const webhookPath = '/api/v1/telegram/webhook';

function required(value, name) {
  if (value) return value;
  throw new Error(`${name} topilmadi`);
}

async function updateWebhook() {
  try {
    const token = required(botToken, 'TELEGRAM_BOT_TOKEN');
    const secret = required(webhookSecret, 'TELEGRAM_WEBHOOK_SECRET');
    const publicUrl = new URL(required(backendPublicUrl, 'BACKEND_PUBLIC_URL'));
    if (publicUrl.protocol !== 'https:') {
      throw new Error('BACKEND_PUBLIC_URL HTTPS bo‘lishi kerak');
    }

    const webhookUrl = new URL(webhookPath, publicUrl).toString();
    console.log(`Webhook yangilanmoqda: ${webhookUrl}`);

    const response = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: secret,
          allowed_updates: ['message'],
          drop_pending_updates: false,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.description ?? 'Telegram webhook yangilanmadi');
    }

    console.log(`✅ ${result.description}`);
  } catch (error) {
    console.error(
      `❌ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await updateWebhook();

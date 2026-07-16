// Central environment variable resolution.

export function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_API_TOKEN
}

export function getAdzunaAppId(): string | undefined {
  return process.env.ADZUNA_APP_ID
}

export function getAdzunaAppKey(): string | undefined {
  return process.env.ADZUNA_APP_KEY
}

export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET || process.env.API_KEY
}

export function getWebhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET || "2PjIaGexBGA4g10m"
}

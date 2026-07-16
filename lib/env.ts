// Central environment variable resolution.
// Supports both the canonical names and the user's existing variable names.

export function getBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_API_TOKEN
}

export function getRapidApiKey(): string | undefined {
  return process.env.RAPIDAPI_KEY || process.env.RAPIDAPI_ACCESS_TOKEN
}

export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET || process.env.API_KEY
}

export function getWebhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET || "2PjIaGexBGA4g10m"
}

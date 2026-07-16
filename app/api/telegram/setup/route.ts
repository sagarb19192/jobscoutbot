import { getBotToken, getCronSecret, getRapidApiKey, getWebhookSecret } from "@/lib/env"
import { getWebhookInfo, setWebhook } from "@/lib/telegram"

function getBaseUrl() {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return process.env.V0_RUNTIME_URL ?? null
}

export async function GET() {
  const missing: string[] = []
  if (!getBotToken()) missing.push("TELEGRAM_BOT_TOKEN")
  if (!getWebhookSecret()) missing.push("TELEGRAM_WEBHOOK_SECRET")
  if (!getRapidApiKey()) missing.push("RAPIDAPI_KEY")
  if (!getCronSecret()) missing.push("CRON_SECRET")

  let webhookInfo = null
  if (getBotToken()) {
    try {
      const info = await getWebhookInfo()
      webhookInfo = info.result ?? null
    } catch {
      // token may be invalid
    }
  }

  return Response.json({
    configured: missing.length === 0,
    missingEnvVars: missing,
    webhookUrl: webhookInfo?.url || null,
    webhookLastError: webhookInfo?.last_error_message || null,
    pendingUpdates: webhookInfo?.pending_update_count ?? 0,
  })
}

export async function POST() {
  if (!getBotToken()) {
    return Response.json({ ok: false, error: "Telegram bot token is not set" }, { status: 400 })
  }
  if (!getWebhookSecret()) {
    return Response.json({ ok: false, error: "Webhook secret is not set" }, { status: 400 })
  }

  const baseUrl = getBaseUrl()
  if (!baseUrl) {
    return Response.json({ ok: false, error: "Could not determine deployment URL" }, { status: 400 })
  }

  const webhookUrl = `${baseUrl}/api/telegram/webhook`
  const result = await setWebhook(webhookUrl, getWebhookSecret())

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.description ?? "setWebhook failed" },
      { status: 500 },
    )
  }

  return Response.json({ ok: true, webhookUrl })
}

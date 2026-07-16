import { getBotToken } from "@/lib/env"

const TELEGRAM_API = "https://api.telegram.org"

function botUrl(method: string) {
  const token = getBotToken()
  if (!token) throw new Error("Telegram bot token is not set (TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_API_TOKEN)")
  return `${TELEGRAM_API}/bot${token}/${method}`
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  options?: { parseMode?: "HTML" | "Markdown"; disablePreview?: boolean },
) {
  const res = await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options?.parseMode ?? "HTML",
      link_preview_options: { is_disabled: options?.disablePreview ?? true },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error("[telegram] sendMessage failed:", res.status, body)
  }
  return res.ok
}

export async function sendChatAction(chatId: string | number, action = "typing") {
  await fetch(botUrl("sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {})
}

export async function getFileUrl(fileId: string): Promise<string | null> {
  const res = await fetch(botUrl("getFile"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } }
  if (!data.ok || !data.result?.file_path) return null
  const token = getBotToken()
  return `${TELEGRAM_API}/file/bot${token}/${data.result.file_path}`
}

export async function setWebhook(url: string, secretToken: string) {
  const res = await fetch(botUrl("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  })
  return (await res.json()) as { ok: boolean; description?: string }
}

export async function getWebhookInfo() {
  const res = await fetch(botUrl("getWebhookInfo"))
  return (await res.json()) as {
    ok: boolean
    result?: { url?: string; last_error_message?: string; pending_update_count?: number }
  }
}

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

"use client"

import { Button } from "@/components/ui/button"
import { useState } from "react"
import useSWR from "swr"

interface SetupStatus {
  configured: boolean
  missingEnvVars: string[]
  webhookUrl: string | null
  webhookLastError: string | null
  pendingUpdates: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

const ENV_VAR_HELP: Record<string, string> = {
  TELEGRAM_BOT_TOKEN: "Get this from @BotFather on Telegram (see steps below)",
  TELEGRAM_WEBHOOK_SECRET: "Any random string (32+ chars) to secure the webhook",
  RAPIDAPI_KEY: "Free key from rapidapi.com — subscribe to the JSearch API",
  CRON_SECRET: "Any random string to secure the daily cron endpoint",
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`}
    />
  )
}

export function SetupStatus() {
  const { data, isLoading, mutate } = useSWR<SetupStatus>("/api/telegram/setup", fetcher)
  const [registering, setRegistering] = useState(false)
  const [registerResult, setRegisterResult] = useState<string | null>(null)

  async function registerWebhook() {
    setRegistering(true)
    setRegisterResult(null)
    try {
      const res = await fetch("/api/telegram/setup", { method: "POST" })
      const json = (await res.json()) as { ok: boolean; webhookUrl?: string; error?: string }
      if (json.ok) {
        setRegisterResult(`Webhook registered: ${json.webhookUrl}`)
        mutate()
      } else {
        setRegisterResult(`Failed: ${json.error}`)
      }
    } catch {
      setRegisterResult("Failed: network error")
    } finally {
      setRegistering(false)
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Checking bot configuration...</p>
      </div>
    )
  }

  const missing = data?.missingEnvVars ?? []
  const webhookSet = Boolean(data?.webhookUrl)

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <h2 className="font-semibold text-card-foreground">Bot status</h2>

      <ul className="flex flex-col gap-3">
        <li className="flex items-start gap-3">
          <StatusDot ok={missing.length === 0} />
          <div className="flex flex-col gap-1">
            <span className="text-sm text-card-foreground">
              {missing.length === 0 ? "All environment variables set" : "Missing environment variables"}
            </span>
            {missing.map((key) => (
              <span key={key} className="text-xs text-muted-foreground">
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{key}</code> — {ENV_VAR_HELP[key]}
              </span>
            ))}
          </div>
        </li>
        <li className="flex items-center gap-3">
          <StatusDot ok={webhookSet} />
          <span className="text-sm text-card-foreground">
            {webhookSet ? `Webhook active: ${data?.webhookUrl}` : "Webhook not registered yet"}
          </span>
        </li>
        {data?.webhookLastError && (
          <li className="flex items-center gap-3">
            <StatusDot ok={false} />
            <span className="text-sm text-card-foreground">Last webhook error: {data.webhookLastError}</span>
          </li>
        )}
      </ul>

      <div className="flex flex-col gap-2">
        <Button
          onClick={registerWebhook}
          disabled={registering || missing.includes("TELEGRAM_BOT_TOKEN") || missing.includes("TELEGRAM_WEBHOOK_SECRET")}
        >
          {registering ? "Registering..." : webhookSet ? "Re-register webhook" : "Register webhook"}
        </Button>
        {registerResult && <p className="break-all text-xs text-muted-foreground">{registerResult}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Registering points your Telegram bot at this deployment. Do this once after setting the env
          vars, and again after deploying to production.
        </p>
      </div>
    </div>
  )
}

import { db } from "@/lib/db"
import { getCronSecret } from "@/lib/env"
import { botUsers } from "@/lib/db/schema"
import { searchAndSendJobs } from "@/lib/jobs"
import { eq } from "drizzle-orm"

export const maxDuration = 300

export async function GET(request: Request) {
  // Vercel Cron sends an Authorization header with CRON_SECRET
  const cronSecret = getCronSecret()
  const authHeader = request.headers.get("authorization")
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const activeUsers = await db.select().from(botUsers).where(eq(botUsers.state, "active"))

  let notified = 0
  let totalJobs = 0

  for (const user of activeUsers) {
    try {
      const count = await searchAndSendJobs(user, { onlyNew: true, datePosted: "today" })
      if (count > 0) {
        notified++
        totalJobs += count
      }
    } catch (error) {
      console.error(`[cron] failed for chat ${user.chatId}:`, error)
    }
  }

  return Response.json({
    ok: true,
    usersChecked: activeUsers.length,
    usersNotified: notified,
    newJobsSent: totalJobs,
  })
}

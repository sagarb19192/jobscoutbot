import { db } from "@/lib/db"
import { getRapidApiKey } from "@/lib/env"
import { seenJobs, type BotUser } from "@/lib/db/schema"
import { escapeHtml, sendMessage } from "@/lib/telegram"
import { and, eq, inArray } from "drizzle-orm"

export interface JobResult {
  jobId: string
  title: string
  company: string
  location: string
  url: string
  source: string
  postedAt?: string
}

interface JSearchJob {
  job_id: string
  job_title: string
  employer_name: string
  job_city?: string
  job_state?: string
  job_country?: string
  job_apply_link: string
  job_publisher?: string
  job_posted_at_datetime_utc?: string
  job_is_remote?: boolean
}

export async function searchJobs(
  query: string,
  location: string,
  options?: { datePosted?: "all" | "today" | "3days" | "week" | "month" },
): Promise<JobResult[]> {
  const apiKey = getRapidApiKey()
  if (!apiKey) throw new Error("RapidAPI key is not set (RAPIDAPI_KEY or RAPIDAPI_ACCESS_TOKEN)")

  const params = new URLSearchParams({
    query: `${query} in ${location}`,
    page: "1",
    num_pages: "1",
    date_posted: options?.datePosted ?? "week",
  })

  const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": "jsearch.p.rapidapi.com",
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.error("[jobs] JSearch request failed:", res.status, body)
    throw new Error(`JSearch API error: ${res.status}`)
  }

  const data = (await res.json()) as { data?: JSearchJob[] }
  return (data.data ?? []).map((job) => ({
    jobId: job.job_id,
    title: job.job_title,
    company: job.employer_name,
    location: job.job_is_remote
      ? "Remote"
      : [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") || "N/A",
    url: job.job_apply_link,
    source: job.job_publisher ?? "Web",
    postedAt: job.job_posted_at_datetime_utc,
  }))
}

export async function filterNewJobs(chatId: string, jobs: JobResult[]): Promise<JobResult[]> {
  if (jobs.length === 0) return []
  const ids = jobs.map((j) => j.jobId)
  const seen = await db
    .select({ jobId: seenJobs.jobId })
    .from(seenJobs)
    .where(and(eq(seenJobs.chatId, chatId), inArray(seenJobs.jobId, ids)))
  const seenIds = new Set(seen.map((s) => s.jobId))
  return jobs.filter((j) => !seenIds.has(j.jobId))
}

export async function markJobsSeen(chatId: string, jobs: JobResult[]) {
  if (jobs.length === 0) return
  await db
    .insert(seenJobs)
    .values(
      jobs.map((j) => ({
        chatId,
        jobId: j.jobId,
        title: j.title,
        company: j.company,
        url: j.url,
      })),
    )
    .onConflictDoNothing()
}

export function formatJobsMessage(jobs: JobResult[], heading: string): string {
  const lines = [`<b>${escapeHtml(heading)}</b>`, ""]
  for (const job of jobs.slice(0, 10)) {
    lines.push(
      `<b>${escapeHtml(job.title)}</b>`,
      `${escapeHtml(job.company)} — ${escapeHtml(job.location)}`,
      `Source: ${escapeHtml(job.source)}`,
      `<a href="${job.url}">Apply here</a>`,
      "",
    )
  }
  return lines.join("\n")
}

export async function searchAndSendJobs(
  user: BotUser,
  options?: { onlyNew?: boolean; datePosted?: "all" | "today" | "3days" | "week" | "month" },
): Promise<number> {
  const roles = (user.roles ?? []).slice(0, 2)
  const location = user.location ?? "India"
  if (roles.length === 0) return 0

  const allJobs: JobResult[] = []
  for (const role of roles) {
    try {
      const jobs = await searchJobs(role, location, { datePosted: options?.datePosted })
      allJobs.push(...jobs)
    } catch (error) {
      console.error(`[jobs] search failed for role "${role}":`, error)
    }
  }

  // Dedupe by jobId across roles
  const unique = Array.from(new Map(allJobs.map((j) => [j.jobId, j])).values())
  const toSend = options?.onlyNew ? await filterNewJobs(user.chatId, unique) : unique

  if (toSend.length === 0) return 0

  const heading = options?.onlyNew
    ? `${toSend.length} new job posting${toSend.length > 1 ? "s" : ""} for you`
    : `Top job matches for ${roles.join(", ")} in ${location}`

  await sendMessage(user.chatId, formatJobsMessage(toSend, heading))
  await markJobsSeen(user.chatId, toSend.slice(0, 10))
  return toSend.length
}

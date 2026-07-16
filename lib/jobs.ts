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
  minSalary?: number
  maxSalary?: number
  salaryCurrency?: string
  salaryPeriod?: string
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
  job_min_salary?: number
  job_max_salary?: number
  job_salary_currency?: string
  job_salary_period?: string
}

export async function searchJobs(
  query: string,
  location: string,
  options?: { datePosted?: "all" | "today" | "3days" | "week" | "month"; numPages?: number },
): Promise<JobResult[]> {
  const apiKey = getRapidApiKey()
  if (!apiKey) throw new Error("RapidAPI key is not set (RAPIDAPI_KEY or RAPIDAPI_ACCESS_TOKEN)")

  const locationQuery = location.toLowerCase() === "remote"
    ? `${query} remote`
    : `${query} in ${location}`

  const params = new URLSearchParams({
    query: locationQuery,
    page: "1",
    num_pages: String(options?.numPages ?? 2),
    date_posted: options?.datePosted ?? "month",
    remote_jobs_only: location.toLowerCase() === "remote" ? "true" : "false",
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
    minSalary: job.job_min_salary,
    maxSalary: job.job_max_salary,
    salaryCurrency: job.job_salary_currency,
    salaryPeriod: job.job_salary_period,
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

function formatSalary(job: JobResult): string | null {
  if (!job.minSalary && !job.maxSalary) return null
  const currency = job.salaryCurrency ?? ""
  const period = job.salaryPeriod ? `/${job.salaryPeriod.toLowerCase()}` : ""
  const fmt = (n: number) =>
    n >= 100000 ? `${(n / 1000).toFixed(0)}K` : n.toLocaleString()
  if (job.minSalary && job.maxSalary) {
    return `${currency}${fmt(job.minSalary)} – ${currency}${fmt(job.maxSalary)}${period}`
  }
  if (job.maxSalary) return `Up to ${currency}${fmt(job.maxSalary)}${period}`
  if (job.minSalary) return `From ${currency}${fmt(job.minSalary)}${period}`
  return null
}

function sortBySalary(jobs: JobResult[]): JobResult[] {
  return [...jobs].sort((a, b) => {
    const salaryA = a.maxSalary ?? a.minSalary ?? 0
    const salaryB = b.maxSalary ?? b.minSalary ?? 0
    // Jobs with salary info always come before those without
    if (salaryA === 0 && salaryB > 0) return 1
    if (salaryB === 0 && salaryA > 0) return -1
    return salaryB - salaryA
  })
}

export function formatJobsMessage(jobs: JobResult[], heading: string): string {
  const sorted = sortBySalary(jobs)
  const lines = [`<b>${escapeHtml(heading)}</b>`, ""]
  for (const job of sorted.slice(0, 10)) {
    const salary = formatSalary(job)
    lines.push(
      `<b>${escapeHtml(job.title)}</b>`,
      `🏢 ${escapeHtml(job.company)} — 📍 ${escapeHtml(job.location)}`,
      salary ? `💰 ${escapeHtml(salary)}` : "",
      `🔗 <a href="${job.url}">Apply here</a> (${escapeHtml(job.source)})`,
      "",
    )
  }
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n")
}

export async function searchAndSendJobs(
  user: BotUser,
  options?: { onlyNew?: boolean; datePosted?: "all" | "today" | "3days" | "week" | "month" },
): Promise<number> {
  // Search ALL roles (up to 6), not just the first 2
  const roles = (user.roles ?? []).slice(0, 6)
  const location = user.location ?? "India"
  if (roles.length === 0) return 0

  const allJobs: JobResult[] = []
  for (const role of roles) {
    try {
      const jobs = await searchJobs(role, location, {
        datePosted: options?.datePosted ?? "month",
        numPages: 2,
      })
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
    : `Top ${Math.min(toSend.length, 10)} job matches for ${roles.join(", ")} in ${location} (last month)`

  await sendMessage(user.chatId, formatJobsMessage(toSend, heading))
  await markJobsSeen(user.chatId, toSend.slice(0, 10))
  return toSend.length
}

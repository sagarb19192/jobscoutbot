import { db } from "@/lib/db"
import { seenJobs, type BotUser } from "@/lib/db/schema"
import { escapeHtml, sendMessage } from "@/lib/telegram"
import { and, eq, inArray } from "drizzle-orm"

export interface JobResult {
  jobId: string
  title: string
  company: string
  location: string
  applyUrl: string       // direct apply link (LinkedIn, Indeed, etc.)
  via: string            // platform it was listed on
  postedAt?: string
  isRemote?: boolean
  isSenior?: boolean
}

interface SerpApiJob {
  job_id: string
  title: string
  company_name: string
  location: string
  via?: string
  description?: string
  detected_extensions?: {
    posted_at?: string
    work_from_home?: boolean
    schedule_type?: string
  }
  apply_options?: Array<{ title: string; link: string }>
}

function getSerpApiKey(): string | null {
  return process.env.SERPAPI_KEY ?? null
}

// Keywords that indicate senior / experienced roles
const SENIOR_KEYWORDS = [
  "senior", "sr.", "lead", "principal", "architect",
  "manager", "head", "3+", "4+", "5+", "experienced",
]

function isSeniorRole(title: string, description?: string): boolean {
  const combined = `${title} ${description ?? ""}`.toLowerCase()
  return SENIOR_KEYWORDS.some((kw) => combined.includes(kw))
}

function getLinkedInApplyUrl(job: SerpApiJob): string {
  // Prefer LinkedIn apply link, fall back to first available
  const options = job.apply_options ?? []
  const linkedin = options.find((o) => o.title?.toLowerCase().includes("linkedin"))
  const other = options[0]
  return linkedin?.link ?? other?.link ?? ""
}

export async function searchJobs(
  query: string,
  location: string,
  options?: { onlySenior?: boolean },
): Promise<JobResult[]> {
  const apiKey = getSerpApiKey()
  if (!apiKey) throw new Error("SERPAPI_KEY is not set")

  const isRemote = location.toLowerCase() === "remote"
  const locationQuery = isRemote ? `${query} remote` : `${query} ${location}`

  const params = new URLSearchParams({
    engine: "google_jobs",
    q: locationQuery,
    chips: "date_posted:month",   // last 1 month
    api_key: apiKey,
    hl: "en",
    gl: "in",                     // results from India region
    no_cache: "false",
  })

  const res = await fetch(`https://serpapi.com/search.json?${params}`)

  if (!res.ok) {
    const body = await res.text()
    console.error("[jobs] SerpAPI request failed:", res.status, body)
    throw new Error(`SerpAPI error: ${res.status}`)
  }

  const data = (await res.json()) as { jobs_results?: SerpApiJob[]; error?: string }

  if (data.error) {
    console.error("[jobs] SerpAPI error:", data.error)
    throw new Error(`SerpAPI: ${data.error}`)
  }

  const jobs: JobResult[] = (data.jobs_results ?? [])
    .map((job) => {
      const applyUrl = getLinkedInApplyUrl(job)
      const senior = isSeniorRole(job.title, job.description)
      return {
        jobId: job.job_id,
        title: job.title,
        company: job.company_name,
        location: job.location ?? location,
        applyUrl,
        via: job.via ?? "Job Board",
        postedAt: job.detected_extensions?.posted_at,
        isRemote: job.detected_extensions?.work_from_home ?? isRemote,
        isSenior: senior,
      }
    })
    .filter((j) => j.applyUrl)  // must have an apply link

  // If onlySenior, filter — but keep all if none are senior (so we don't show empty)
  if (options?.onlySenior) {
    const seniorOnly = jobs.filter((j) => j.isSenior)
    return seniorOnly.length > 0 ? seniorOnly : jobs
  }

  return jobs
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
        url: j.applyUrl,
      })),
    )
    .onConflictDoNothing()
}

export function formatJobsMessage(jobs: JobResult[], heading: string): string {
  const lines = [`<b>${escapeHtml(heading)}</b>`, ""]

  for (const job of jobs.slice(0, 10)) {
    const locationStr = job.isRemote ? "🌐 Remote" : `📍 ${escapeHtml(job.location)}`
    const postedStr = job.postedAt ? ` · ${escapeHtml(job.postedAt)}` : ""
    const seniorBadge = job.isSenior ? " 🔺" : ""

    lines.push(
      `<b>${escapeHtml(job.title)}${seniorBadge}</b>`,
      `🏢 ${escapeHtml(job.company)} — ${locationStr}`,
      `📌 via ${escapeHtml(job.via)}${postedStr}`,
      `🔗 <a href="${job.applyUrl}">Apply here</a>`,
      "",
    )
  }

  return lines.join("\n").trim()
}

// Fixed roles for Frappe/ERPNext — these are always searched regardless of resume
const FRAPPE_ROLES = [
  "Frappe Developer",
  "ERPNext Developer",
  "Senior Frappe Developer",
  "Frappe ERPNext Developer",
]

export async function searchAndSendJobs(
  user: BotUser,
  options?: { onlyNew?: boolean; onlySenior?: boolean },
): Promise<number> {
  // Merge user's parsed roles with the fixed Frappe/ERPNext roles (dedupe)
  const userRoles = (user.roles ?? []).slice(0, 4)
  const allRoles = Array.from(new Set([...FRAPPE_ROLES, ...userRoles]))
  const location = user.location ?? "India"

  const allJobs: JobResult[] = []

  for (const role of allRoles.slice(0, 6)) {
    try {
      const jobs = await searchJobs(role, location, {
        onlySenior: options?.onlySenior ?? true,  // default to senior/3+ only
      })
      allJobs.push(...jobs)
    } catch (error) {
      console.error(`[jobs] search failed for "${role}":`, error)
    }
  }

  // Dedupe by jobId
  const unique = Array.from(new Map(allJobs.map((j) => [j.jobId, j])).values())
  const toSend = options?.onlyNew ? await filterNewJobs(user.chatId, unique) : unique

  if (toSend.length === 0) return 0

  const heading = options?.onlyNew
    ? `🆕 ${toSend.length} new Frappe/ERPNext job${toSend.length > 1 ? "s" : ""} for you`
    : `🔍 Top ${Math.min(toSend.length, 10)} Frappe/ERPNext jobs in ${location} (last 30 days)`

  await sendMessage(user.chatId, formatJobsMessage(toSend, heading))
  await markJobsSeen(user.chatId, toSend.slice(0, 10))
  return toSend.length
}

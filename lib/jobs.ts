import { db } from "@/lib/db"
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
}

interface AdzunaJob {
  id: string
  title: string
  company: { display_name: string }
  location: { display_name: string }
  redirect_url: string
  salary_min?: number
  salary_max?: number
  created: string // ISO date
  category?: { label: string }
  adref?: string
}

function getAdzunaCredentials(): { appId: string; appKey: string } | null {
  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY
  if (!appId || !appKey) return null
  return { appId, appKey }
}

// Map user location to Adzuna country code
function getCountryCode(location: string): string {
  const loc = location.toLowerCase()
  if (loc === "remote" || loc === "india" || loc.includes("hyderabad") || loc.includes("bangalore") ||
      loc.includes("bengaluru") || loc.includes("mumbai") || loc.includes("pune") ||
      loc.includes("chennai") || loc.includes("delhi") || loc.includes("kolkata") ||
      loc.includes("ahmedabad") || loc.includes("surat")) {
    return "in"
  }
  // fallback to India for unrecognized locations (most users are India-based)
  return "in"
}

export async function searchJobs(
  query: string,
  location: string,
  options?: { daysOld?: number; page?: number },
): Promise<JobResult[]> {
  const creds = getAdzunaCredentials()
  if (!creds) throw new Error("Adzuna credentials not set (ADZUNA_APP_ID, ADZUNA_APP_KEY)")

  const countryCode = getCountryCode(location)
  const page = options?.page ?? 1
  const daysOld = options?.daysOld ?? 30

  const params = new URLSearchParams({
    app_id: creds.appId,
    app_key: creds.appKey,
    what: query,
    results_per_page: "20",
    max_days_old: String(daysOld),
    sort_by: "salary", // sort by salary desc where available
    sort_direction: "down",
  })

  // For India-specific city, add location param
  const isRemote = location.toLowerCase() === "remote"
  if (!isRemote && location.toLowerCase() !== "india") {
    params.set("where", location)
  }
  if (isRemote) {
    params.set("what_or", query + " remote work from home")
  }

  const url = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}?${params}`
  const res = await fetch(url)

  if (!res.ok) {
    const body = await res.text()
    console.error("[jobs] Adzuna request failed:", res.status, body)
    throw new Error(`Adzuna API error: ${res.status}`)
  }

  const data = (await res.json()) as { results?: AdzunaJob[] }
  return (data.results ?? []).map((job) => ({
    jobId: job.id,
    title: job.title,
    company: job.company?.display_name ?? "Unknown",
    location: job.location?.display_name ?? location,
    url: job.redirect_url,
    source: "Adzuna",
    postedAt: job.created,
    minSalary: job.salary_min,
    maxSalary: job.salary_max,
    salaryCurrency: "INR",
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
  const fmt = (n: number) => {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`
    return `₹${n}`
  }
  if (job.minSalary && job.maxSalary) {
    return `${fmt(job.minSalary)} – ${fmt(job.maxSalary)}/yr`
  }
  if (job.maxSalary) return `Up to ${fmt(job.maxSalary)}/yr`
  if (job.minSalary) return `From ${fmt(job.minSalary)}/yr`
  return null
}

function sortBySalary(jobs: JobResult[]): JobResult[] {
  return [...jobs].sort((a, b) => {
    const salaryA = a.maxSalary ?? a.minSalary ?? 0
    const salaryB = b.maxSalary ?? b.minSalary ?? 0
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
      ...(salary ? [`💰 ${escapeHtml(salary)}`] : []),
      `🔗 <a href="${job.url}">Apply here</a>`,
      "",
    )
  }
  return lines.join("\n").trim()
}

export async function searchAndSendJobs(
  user: BotUser,
  options?: { onlyNew?: boolean; daysOld?: number },
): Promise<number> {
  const roles = (user.roles ?? []).slice(0, 6)
  const location = user.location ?? "India"
  if (roles.length === 0) return 0

  const allJobs: JobResult[] = []
  for (const role of roles) {
    try {
      // Fetch 2 pages per role for broader coverage
      const [page1, page2] = await Promise.allSettled([
        searchJobs(role, location, { daysOld: options?.daysOld ?? 30, page: 1 }),
        searchJobs(role, location, { daysOld: options?.daysOld ?? 30, page: 2 }),
      ])
      if (page1.status === "fulfilled") allJobs.push(...page1.value)
      if (page2.status === "fulfilled") allJobs.push(...page2.value)
    } catch (error) {
      console.error(`[jobs] search failed for role "${role}":`, error)
    }
  }

  // Dedupe by jobId
  const unique = Array.from(new Map(allJobs.map((j) => [j.jobId, j])).values())
  const toSend = options?.onlyNew ? await filterNewJobs(user.chatId, unique) : unique

  if (toSend.length === 0) return 0

  const heading = options?.onlyNew
    ? `${toSend.length} new job posting${toSend.length > 1 ? "s" : ""} for you`
    : `Top ${Math.min(toSend.length, 10)} job matches for ${roles.slice(0, 3).join(", ")} in ${location} (last 30 days)`

  await sendMessage(user.chatId, formatJobsMessage(toSend, heading))
  await markJobsSeen(user.chatId, toSend.slice(0, 10))
  return toSend.length
}

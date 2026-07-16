import { db } from "@/lib/db"
import { getWebhookSecret } from "@/lib/env"
import { botUsers, type BotUser } from "@/lib/db/schema"
import { searchAndSendJobs } from "@/lib/jobs"
import { extractTextFromFile, parseResume } from "@/lib/resume"
import { escapeHtml, getFileUrl, sendChatAction, sendMessage } from "@/lib/telegram"
import { eq } from "drizzle-orm"

export const maxDuration = 60

interface TelegramMessage {
  message_id: number
  chat: { id: number; first_name?: string }
  text?: string
  document?: { file_id: string; file_name?: string; file_size?: number }
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

const WELCOME = [
  "Hi! I'm your <b>Job Hunter Bot</b>.",
  "",
  "Send me your resume as a <b>PDF or DOCX file</b> and I'll:",
  "1. Extract your skills and tech stack",
  "2. Figure out the roles that match you best",
  "3. Find matching jobs from LinkedIn, Naukri, Indeed and more",
  "4. Message you every morning when new jobs are posted",
  "",
  "<b>Commands:</b>",
  "/jobs — search for jobs right now",
  "/profile — view your parsed profile",
  "/location — change your preferred job location",
  "/start — start over with a new resume",
].join("\n")

async function getOrCreateUser(chatId: string, name?: string): Promise<BotUser> {
  const existing = await db.select().from(botUsers).where(eq(botUsers.chatId, chatId)).limit(1)
  if (existing.length > 0) return existing[0]
  const inserted = await db
    .insert(botUsers)
    .values({ chatId, name: name ?? null, state: "new" })
    .onConflictDoNothing()
    .returning()
  if (inserted.length > 0) return inserted[0]
  const retry = await db.select().from(botUsers).where(eq(botUsers.chatId, chatId)).limit(1)
  return retry[0]
}

async function updateUser(chatId: string, values: Partial<typeof botUsers.$inferInsert>) {
  await db
    .update(botUsers)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(botUsers.chatId, chatId))
}

async function handleDocument(user: BotUser, message: TelegramMessage) {
  const doc = message.document
  if (!doc) return
  const chatId = user.chatId

  const fileName = doc.file_name ?? "resume.pdf"
  const lower = fileName.toLowerCase()
  if (!lower.endsWith(".pdf") && !lower.endsWith(".docx") && !lower.endsWith(".txt")) {
    await sendMessage(chatId, "Please send your resume as a <b>PDF</b>, <b>DOCX</b>, or <b>TXT</b> file.")
    return
  }
  if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
    await sendMessage(chatId, "That file is too large. Please send a file under 10 MB.")
    return
  }

  await sendChatAction(chatId, "typing")
  await sendMessage(chatId, "Got your resume! Parsing it now, give me a moment...")

  const fileUrl = await getFileUrl(doc.file_id)
  if (!fileUrl) {
    await sendMessage(chatId, "I couldn't download that file from Telegram. Please try sending it again.")
    return
  }

  const fileRes = await fetch(fileUrl)
  if (!fileRes.ok) {
    await sendMessage(chatId, "I couldn't download that file. Please try sending it again.")
    return
  }

  const buffer = await fileRes.arrayBuffer()
  const resumeText = await extractTextFromFile(buffer, fileName)
  if (!resumeText || resumeText.trim().length < 50) {
    await sendMessage(
      chatId,
      "I couldn't read any text from that file. If it's a scanned/image PDF, please send a text-based PDF or DOCX instead.",
    )
    return
  }

  await sendChatAction(chatId, "typing")

  try {
    const parsed = await parseResume(resumeText)
    await updateUser(chatId, {
      name: parsed.name,
      resumeText: resumeText.slice(0, 20000),
      skills: parsed.skills,
      roles: parsed.roles,
      experience: parsed.experience,
      state: "awaiting_location",
    })

    const summary = [
      `Resume parsed, <b>${escapeHtml(parsed.name)}</b>!`,
      "",
      `<b>Tech stack:</b> ${escapeHtml(parsed.skills.slice(0, 15).join(", "))}`,
      `<b>Experience:</b> ${escapeHtml(parsed.experience)}`,
      `<b>Best matching roles:</b>`,
      ...parsed.roles.map((r, i) => `${i + 1}. ${escapeHtml(r)}`),
      "",
      "Now, <b>where should I search for jobs?</b>",
      "Reply with a city or country (e.g. <i>Bangalore</i>, <i>India</i>, <i>Remote</i>).",
    ].join("\n")
    await sendMessage(chatId, summary)
  } catch (error) {
    console.error("[webhook] resume parsing failed:", error)
    await sendMessage(chatId, "Something went wrong while analyzing your resume. Please try again.")
  }
}

async function handleLocation(user: BotUser, location: string) {
  await updateUser(user.chatId, { location, state: "active" })
  await sendMessage(
    user.chatId,
    `Location set to <b>${escapeHtml(location)}</b>. Searching for jobs now...`,
  )
  await sendChatAction(user.chatId, "typing")

  const updated = { ...user, location, state: "active" }
  try {
    const count = await searchAndSendJobs(updated, { datePosted: "month" })
    if (count === 0) {
      await sendMessage(
        user.chatId,
        "No matching jobs found this week, but I'll keep looking! You'll get a message every morning when new jobs are posted. Use /jobs anytime to search again.",
      )
    } else {
      await sendMessage(
        user.chatId,
        "I'll check for new postings <b>every morning</b> and message you when I find something. Use /jobs anytime to search on demand.",
      )
    }
  } catch (error) {
    console.error("[webhook] job search failed:", error)
    await sendMessage(
      user.chatId,
      "Job search isn't available right now (the job API may not be configured yet). Your profile is saved — try /jobs later.",
    )
  }
}

async function handleCommand(user: BotUser, text: string) {
  const chatId = user.chatId
  const command = text.split(/[\s@]/)[0].toLowerCase()

  switch (command) {
    case "/start":
      await updateUser(chatId, { state: "new" })
      await sendMessage(chatId, WELCOME)
      return

    case "/profile": {
      if (!user.resumeText) {
        await sendMessage(chatId, "No resume on file yet. Send me your resume as a PDF or DOCX to get started.")
        return
      }
      const profile = [
        `<b>Your profile</b>`,
        "",
        `<b>Name:</b> ${escapeHtml(user.name ?? "Unknown")}`,
        `<b>Experience:</b> ${escapeHtml(user.experience ?? "Unknown")}`,
        `<b>Location:</b> ${escapeHtml(user.location ?? "Not set")}`,
        `<b>Tech stack:</b> ${escapeHtml((user.skills ?? []).join(", "))}`,
        `<b>Matching roles:</b> ${escapeHtml((user.roles ?? []).join(", "))}`,
        "",
        "Send a new resume anytime to update your profile.",
      ].join("\n")
      await sendMessage(chatId, profile)
      return
    }

    case "/location":
      await updateUser(chatId, { state: "awaiting_location" })
      await sendMessage(chatId, "Where should I search for jobs? Reply with a city or country (e.g. <i>Bangalore</i>, <i>India</i>, <i>Remote</i>).")
      return

    case "/jobs": {
      if (!user.roles || user.roles.length === 0) {
        await sendMessage(chatId, "I need your resume first! Send it as a PDF or DOCX file.")
        return
      }
      if (!user.location) {
        await updateUser(chatId, { state: "awaiting_location" })
        await sendMessage(chatId, "First, tell me where to search. Reply with a city or country.")
        return
      }
      await sendChatAction(chatId, "typing")
      await sendMessage(chatId, "Searching for jobs...")
      try {
        const count = await searchAndSendJobs(user, { datePosted: "month" })
        if (count === 0) {
          await sendMessage(chatId, "No jobs found for your roles this week. I'll notify you as soon as new ones are posted.")
        }
      } catch (error) {
        console.error("[webhook] /jobs failed:", error)
        await sendMessage(chatId, "Job search failed. The job API may not be configured — please try again later.")
      }
      return
    }

    default:
      await sendMessage(chatId, "Unknown command. Try /jobs, /profile, /location, or /start.")
  }
}

export async function POST(request: Request) {
  // Verify the request actually comes from Telegram
  const secret = request.headers.get("x-telegram-bot-api-secret-token")
  if (secret !== getWebhookSecret()) {
    return new Response("Unauthorized", { status: 401 })
  }

  let update: TelegramUpdate
  try {
    update = (await request.json()) as TelegramUpdate
  } catch {
    return new Response("Bad Request", { status: 400 })
  }

  const message = update.message
  if (!message?.chat?.id) {
    return Response.json({ ok: true })
  }

  const chatId = String(message.chat.id)

  try {
    const user = await getOrCreateUser(chatId, message.chat.first_name)

    if (message.document) {
      await handleDocument(user, message)
    } else if (message.text?.startsWith("/")) {
      await handleCommand(user, message.text)
    } else if (message.text && user.state === "awaiting_location") {
      await handleLocation(user, message.text.trim().slice(0, 100))
    } else if (message.text) {
      if (!user.resumeText) {
        await sendMessage(chatId, WELCOME)
      } else {
        await sendMessage(chatId, "Send a new resume to update your profile, or use /jobs, /profile, /location.")
      }
    }
  } catch (error) {
    console.error("[webhook] handler error:", error)
  }

  // Always return 200 so Telegram doesn't retry endlessly
  return Response.json({ ok: true })
}

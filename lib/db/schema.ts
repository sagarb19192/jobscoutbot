import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"

export const botUsers = pgTable("bot_users", {
  id: serial("id").primaryKey(),
  chatId: text("chatId").notNull().unique(),
  name: text("name"),
  resumeText: text("resumeText"),
  skills: jsonb("skills").$type<string[]>().default([]),
  roles: jsonb("roles").$type<string[]>().default([]),
  experience: text("experience"),
  location: text("location"),
  state: text("state").notNull().default("new"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
})

export const seenJobs = pgTable(
  "seen_jobs",
  {
    id: serial("id").primaryKey(),
    chatId: text("chatId").notNull(),
    jobId: text("jobId").notNull(),
    title: text("title"),
    company: text("company"),
    url: text("url"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.chatId, t.jobId)],
)

export type BotUser = typeof botUsers.$inferSelect

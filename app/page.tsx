import { SetupStatus } from "@/components/setup-status"

const steps = [
  {
    title: "Create your bot with @BotFather",
    description:
      "Open Telegram, search for @BotFather, send /newbot, pick a name and username. Copy the token it gives you and add it as the TELEGRAM_BOT_TOKEN environment variable in Project Settings → Vars.",
  },
  {
    title: "Get a free JSearch API key",
    description:
      "Sign up at rapidapi.com, subscribe to the free plan of the JSearch API, and add your key as RAPIDAPI_KEY. JSearch aggregates jobs from LinkedIn, Naukri, Indeed, Glassdoor and more.",
  },
  {
    title: "Add the two secrets",
    description:
      "Set TELEGRAM_WEBHOOK_SECRET and CRON_SECRET to any long random strings. These protect your webhook and daily cron endpoint from unauthorized calls.",
  },
  {
    title: "Register the webhook",
    description:
      "Click the button in the Bot status card. This tells Telegram to deliver messages to this app.",
  },
  {
    title: "Send your resume",
    description:
      "Open your bot in Telegram, hit Start, and send your resume as a PDF or DOCX. The bot parses it, detects your tech stack and matching roles, asks your preferred location, and sends matching jobs.",
  },
]

const features = [
  {
    title: "Resume parsing",
    description: "AI extracts your name, skills, tech stack, and experience level from PDF or DOCX resumes.",
  },
  {
    title: "Role matching",
    description: "Automatically decides the 2-4 job titles that best fit your profile.",
  },
  {
    title: "Jobs from everywhere",
    description: "Searches LinkedIn, Naukri, Indeed, Glassdoor and more via the JSearch aggregator.",
  },
  {
    title: "Daily morning alerts",
    description:
      "Every morning at 8:00 AM IST, the bot checks for new postings and messages you only when something new appears.",
  },
]

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-primary">Telegram Job Hunter Bot</p>
        <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Your resume in. Matching jobs out. Every morning.
        </h1>
        <p className="text-pretty leading-relaxed text-muted-foreground">
          Send your resume to the bot on Telegram and it parses your skills, figures out the roles
          you fit, and delivers fresh job postings from across the internet — daily.
        </p>
      </header>

      <SetupStatus />

      <section aria-labelledby="features-heading" className="flex flex-col gap-4">
        <h2 id="features-heading" className="text-xl font-semibold text-foreground">
          What it does
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4"
            >
              <h3 className="text-sm font-semibold text-card-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="setup-heading" className="flex flex-col gap-4">
        <h2 id="setup-heading" className="text-xl font-semibold text-foreground">
          Setup guide
        </h2>
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="border-t border-border pt-6">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Bot commands: /start to begin, /jobs to search now, /profile to view your parsed resume,
          /location to change where jobs are searched.
        </p>
      </footer>
    </main>
  )
}

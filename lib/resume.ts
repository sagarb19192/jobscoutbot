import { generateText, Output } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"

const resumeSchema = z.object({
  name: z.string().describe("Candidate's full name"),
  skills: z
    .array(z.string())
    .describe("Technical skills and tech stack, e.g. React, Node.js, Python, AWS"),
  roles: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "3-6 specific, searchable job titles best suited for this candidate ordered by fit. " +
      "IMPORTANT: If the resume mentions niche frameworks or platforms, use those as primary roles. " +
      "Examples: if Frappe/ERPNext → 'Frappe Developer', 'ERPNext Developer'; " +
      "if Django → 'Django Developer'; if React → 'React Developer'; " +
      "if Salesforce → 'Salesforce Developer'; if SAP → 'SAP Developer'. " +
      "Always prefer specific titles over generic ones like 'Software Developer'.",
    ),
  experience: z
    .string()
    .describe("Short summary of experience level, e.g. 'Fresher', '3 years', '5+ years senior'"),
})

export type ParsedResume = z.infer<typeof resumeSchema>

export async function extractTextFromFile(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<string | null> {
  const lower = fileName.toLowerCase()
  try {
    if (lower.endsWith(".pdf")) {
      const { extractText } = await import("unpdf")
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })
      return typeof text === "string" ? text : String(text)
    }
    if (lower.endsWith(".docx")) {
      const mammoth = await import("mammoth")
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
      return result.value
    }
    if (lower.endsWith(".txt")) {
      return new TextDecoder().decode(buffer)
    }
  } catch (error) {
    console.error("[resume] text extraction failed:", error)
  }
  return null
}

export async function parseResume(resumeText: string): Promise<ParsedResume> {
  const { output } = await generateText({
    model: openai("gpt-4o-mini"),
    output: Output.object({ schema: resumeSchema }),
    prompt: `You are an expert technical recruiter specializing in matching candidates to job postings.
Analyze this resume and extract:
1. The candidate's full name
2. All technical skills, frameworks, tools, and tech stack mentioned
3. 3-6 SPECIFIC job role titles to search job boards with — ranked by best fit.
   - CRITICAL: If the resume mentions niche/specific frameworks or platforms, those MUST be the primary roles.
   - Examples:
     * Frappe / ERPNext mentioned → include "Frappe Developer", "ERPNext Developer"
     * Django mentioned → include "Django Developer"  
     * React/Next.js mentioned → include "React Developer" or "Next.js Developer"
     * SAP mentioned → include "SAP Developer" or "SAP Consultant"
     * Salesforce mentioned → include "Salesforce Developer"
   - Also include broader roles like "Full Stack Developer" or "Backend Developer" as secondary options
   - Avoid overly generic titles like "Software Developer" unless no specific tech is found
4. A short experience summary (e.g. "2+ years", "Fresher", "5+ years senior")

Resume:
${resumeText.slice(0, 14000)}`,
  })
  return output
}

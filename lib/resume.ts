import { generateText, Output } from "ai"
import { z } from "zod"

const resumeSchema = z.object({
  name: z.string().describe("Candidate's full name"),
  skills: z
    .array(z.string())
    .describe("Technical skills and tech stack, e.g. React, Node.js, Python, AWS"),
  roles: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "2-4 job titles this candidate is best suited for, ordered by fit, e.g. 'Frontend Developer', 'Full Stack Engineer'",
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
    model: "openai/gpt-4o-mini",
    output: Output.object({ schema: resumeSchema }),
    prompt: `You are an expert technical recruiter. Analyze this resume and extract:
1. The candidate's name
2. All technical skills / tech stack
3. The 2-4 job roles/titles that best match this candidate for job searching
4. A short experience summary

Resume:
${resumeText.slice(0, 12000)}`,
  })
  return output
}

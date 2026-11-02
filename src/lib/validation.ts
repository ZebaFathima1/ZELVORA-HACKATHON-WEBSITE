import { z } from "zod";
import { TRACKS } from "@/lib/constants";

const isHttpsUrl = (value: string) => {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
};
const optionalUrl = z.union([z.literal(""), z.string().url().refine(isHttpsUrl, "URL must use HTTPS")]);

export const projectDetailsSchema = z.object({
  project_title: z.string().trim().min(3).max(160),
  problem_statement: z.string().trim().min(20).max(3000),
  problem_description: z.string().trim().min(40).max(8000),
  proposed_solution: z.string().trim().min(40).max(8000),
  objectives: z.string().trim().min(20).max(3000),
  innovation: z.string().trim().min(20).max(3000),
  technical_implementation: z.string().trim().min(20).max(5000),
  technologies: z.string().trim().min(2).max(1000),
  real_world_applications: z.string().trim().min(20).max(3000),
  expected_impact: z.string().trim().min(20).max(3000)
});

export const projectSchema = projectDetailsSchema.extend({
  github_url: z.string().url().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "github.com";
    } catch {
      return false;
    }
  }, "Enter an HTTPS GitHub repository URL"),
  deployed_url: optionalUrl,
  demo_video_url: optionalUrl,
  deployment_exception: z.string().max(1000).optional().default(""),
  confirmed: z.literal(true)
}).superRefine((data, ctx) => {
  if (!data.deployed_url && data.deployment_exception.trim().length < 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deployment_exception"],
      message: "Add a deployed URL or explain why deployment is not feasible (at least 20 characters)."
    });
  }
});

export const trackSchema = z.enum(TRACKS);

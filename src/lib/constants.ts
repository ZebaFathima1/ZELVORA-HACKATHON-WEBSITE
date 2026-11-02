export const TRACKS = [
  "Education / EdTech",
  "AI Innovation",
  "Healthcare",
  "Business"
] as const;

export type Track = (typeof TRACKS)[number];

export const RUBRIC = [
  { key: "innovation", label: "Innovation and Originality", max: 20 },
  { key: "technical_implementation", label: "Technical Implementation", max: 20 },
  { key: "github_code_quality", label: "GitHub Code Quality", max: 15 },
  { key: "problem_solving", label: "Problem Solving", max: 15 },
  { key: "real_world_impact", label: "Real-World Impact", max: 10 },
  { key: "ui_ux", label: "UI/UX", max: 10 },
  { key: "documentation", label: "Documentation and Explanation", max: 10 }
] as const;

export const REQUIRED_UPLOAD_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg"
];

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

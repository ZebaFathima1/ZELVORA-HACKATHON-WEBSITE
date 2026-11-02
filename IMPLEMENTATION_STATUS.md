# Implementation status

## Implemented in this workspace

- [x] Next.js/TypeScript foundation and responsive, branded participant/admin UI.
- [x] Supabase client integration and environment placeholders.
- [x] Team ID verification against registered Supabase rows; read-only team details.
- [x] Four-step participant form with backend validation, GitHub requirement, deployment exception, file limits/types, upload progress, confirmation, and printable receipt.
- [x] Atomic, unique one-submission-per-team database path; duplicate response includes existing reference; submission fields and evaluation snapshot are database-immutable.
- [x] Private Storage bucket and admin-only signed download.
- [x] Supabase Auth organizer login at `/organizer`, role checks, RLS, organizer dashboard, submissions search/filter/details, CSV export and registered-team CSV import.
- [x] Submission opening/deadline/enabled/frozen controls and audit trigger.
- [x] Evidence-based evaluation pipeline with PDF/PPTX extraction, safe static GitHub source inspection, evidence-linked validated LLM scoring, manual-review flags, report UI, and separate provisional/final organizer rankings.
- [x] Demo-data isolation across RLS, dashboard queries, batch creation, worker claims/completion, leaderboard maintenance, and an opt-in idempotent 40-team demo seed.
- [x] Authenticated, read-only Demo Preview section for synthetic dashboard, teams, submissions, evaluation examples, and rankings.
- [x] Admin-only AI provider connection test for checking the Supabase Function URL/key/model configuration before starting an evaluation batch.
- [x] Deployment and security documentation.

## Not implemented / needs configured services

- [ ] OCR for image-only PDFs and guaranteed legacy `.ppt` parsing; image analysis depends on vision support from the configured model and is flagged for review if unavailable.
- [ ] Deployed application verification; participant-controlled URLs are intentionally not fetched to prevent SSRF and remain unverified for organizer review.
- [ ] Durable managed background queue that continues after the admin browser closes.
- [ ] Email receipts, XLSX export, dedicated PDF renderer, and measured throughput benchmark.
- [ ] Authenticated organizer login, live statistics, and AI execution against Supabase; no privileged Supabase CLI session or LLM service configuration is available in this workspace.
- [ ] Apply/validate migrations and deploy Edge Functions to the connected Supabase project; no Supabase CLI is installed or authenticated here.

## Verification state

`npm run typecheck` and `npm run build` pass. The local port-3001 organizer sign-in page and unauthenticated redirect from `/organizer/evaluation` were verified in the integrated browser. A Playwright debug attempt could not start because its Chromium executable is not installed. Live authenticated workflows, SQL execution, function deployment, and real evaluation remain unverified; complete those checks after applying both migrations and deploying the functions to the configured Supabase project.

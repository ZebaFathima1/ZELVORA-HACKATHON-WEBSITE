# Zelvora Hackathon Platform

Hackathon participant submission and organizer evaluation portal for Zelvora Technologies Pvt. Ltd. The backend is Supabase: PostgreSQL, Auth, private Storage, Row Level Security, and Supabase Edge Functions. There is no separate FastAPI service.

## What is included

- Responsive participant portal with read-only team verification, four-step project submission, required presentation upload, progress, confirmation, and printable receipt.
- Database-enforced one-submission-per-team with an atomic RPC and unique constraint.
- Dedicated `/organizer` sign-in with existing `admin_users` authorization, RLS-protected workspace, roster CSV import, event controls, submission review/download, evaluation batches, reports, leaderboards, and organizer-controlled shortlisting.
- Supabase Edge Function pipeline that extracts PDF/PPTX text, statically inspects a capped set of public GitHub files without executing code, and uses a configured OpenAI-compatible model for evidence-linked scoring against the fixed 100-point rubric.
- Presentation, repository, and evidence-consistency reports; image/OCR and deployment limitations are explicitly marked for organizer review.
- Optional, clearly labeled 40-team demo fixture in `supabase/demo_seed.sql`. All fixture rows carry `is_demo=true`; RLS, dashboard queries, and real evaluation batches exclude them.
- SQL migration, environment template, and deployment/security documentation.

## Requirements

- Node.js 20+
- A Supabase project with the CLI installed for local Supabase development/deployment
- An OpenAI-compatible LLM API key for AI evaluation

## Connect Supabase and run locally

1. Create a Supabase project at [supabase.com/dashboard](https://supabase.com/dashboard). In **Project Settings → API** (or **API Keys**), copy the **Project URL** and the public **anon/publishable key**. Do not use or expose the `service_role` or secret key in the browser app.
2. In the project folder, install dependencies and create the local environment file:

   ```powershell
   cd "C:\path\to\zelvora hackathon website"
   npm install
   Copy-Item .env.example .env.local
   notepad .env.local
   ```

   Set the values in `.env.local`. The app uses the publishable key when present and falls back to the legacy anon key:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SB_PUBLISHABLE_KEY
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_LEGACY_ANON_KEY
   ```

   Save the file and restart the Next.js server whenever these values change.
3. Configure Supabase Auth in **Authentication → Sign In / Providers → Email**: enable email/password sign-in. The organizer page supports account signup; require email confirmation if desired. Set the **Site URL** to `http://localhost:3001`, and add `http://localhost:3001/organizer/reset-password` to **Redirect URLs** so password recovery works.
4. Link the Supabase CLI to the project and apply both database migrations in order:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Find `YOUR_PROJECT_REF` in the project URL (`https://YOUR_PROJECT_REF.supabase.co`). If using **SQL Editor**, run `supabase/migrations/202611010001_initial_schema.sql` first, then `supabase/migrations/202611010002_evidence_evaluation.sql`.
5. In **Project Settings → Edge Functions → Secrets** (or the secrets page for your Supabase project), add:

   | Secret | Value |
   | --- | --- |
   | `AI_PROVIDER_API_KEY` | Your OpenAI-compatible provider API key |
   | `AI_PROVIDER_BASE_URL` | `https://api.openai.com/v1` (or your compatible provider's API base URL) |
   | `AI_MODEL` | `gpt-4o-mini` (or a model available to your provider) |
   | `ALLOWED_ORIGIN` | `http://localhost:3001` while testing locally (the functions also allow `localhost:3000`) |

   `GITHUB_TOKEN` is optional and can improve GitHub API rate limits. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Keep all provider/service-role keys in Supabase secrets only—never add them to `.env.local`, frontend code, or source control. For a deployed frontend, change `ALLOWED_ORIGIN` to its exact HTTPS origin.
6. Deploy the Edge Functions:

   ```powershell
   npx supabase functions deploy verify-team
   npx supabase functions deploy submit-project
   npx supabase functions deploy start-evaluation
   npx supabase functions deploy process-evaluation
   npx supabase functions deploy test-ai-provider
   ```
   The evaluation worker imports its shared parser and evidence helpers from `supabase/functions/_shared`.
7. (Optional, development/test project only) To exercise the participant submission flow, run `supabase/participant_test_seed.sql` in the Supabase SQL Editor after both migrations. It creates a clearly labeled test team with ID `ZYL900099` and temporarily opens submissions. Submit that team once to test the full flow; submissions are intentionally one-time. Do not run this fixture against a live event project.
8. (Optional, development project only) For populated organizer-screen fixtures, run `supabase/demo_seed.sql` in the Supabase SQL Editor **after both migrations**. This inserts synthetic records, including mock scores that are not AI output; do not treat them as real submissions, reports, recommendations, or awards. The seed is idempotent and aborts if its reserved team-ID range collides with real teams. Normal RLS policies and application queries hide demo rows, and real evaluation batches exclude them.
9. Start the website on port 3001:

   ```powershell
   npm run dev:organizer
   ```

   Open `http://localhost:3001/organizer`. Leave the dev terminal running; press **Ctrl+C** to stop it.
10. Create an organizer account from `/organizer`. The signup migration adds new authenticated accounts to `admin_users` with the organizer role. Use **Demo Preview** after sign-in to inspect the separate synthetic walkthrough. Sign in and open **AI Evaluation → Test AI connection**. Freeze submissions in **Event Settings** first; the backend verifies the frozen state before starting an evaluation batch.

   CSV import headers for registered teams:

   ```text
   team_id,team_name,team_leader,college,branch,track,members
   ```

   `members` is a pipe-separated list of 2–4 registered member names (including the team leader). Track values must be exactly `Education / EdTech`, `AI Innovation`, `Healthcare`, or `Business`. Team IDs use the stable `ZYL` + digits format (for example `ZYL001`).

## Validation

```sh
npm run typecheck
npm run build
```

Supabase Edge Function and SQL deployment must also be tested in a configured Supabase project. This workspace has only the public frontend configuration; no authenticated Supabase CLI session, privileged project access, or AI provider secret is available, so migrations, live organizer data, and real evaluation cannot be exercised here.

## Important readiness notes

- Team ID verification is an event-specific low-assurance access method, not authentication. It can expose registered names/college/track and is vulnerable to someone who knows a Team ID. Rate limits and server-side checks reduce abuse; the registration system should provide a high-entropy secret submission token before a high-stakes production event.
- Evaluation never executes untrusted repository code or fetches participant deployment URLs. It extracts PDF/PPTX text and statically inspects a capped set of GitHub metadata/source files. OCR for image-only PDFs and legacy `.ppt` extraction are not guaranteed; when embedded-image vision is rejected, the presentation is flagged for manual review. Deployment behavior always remains unverified and requires organizer review.
- Evaluation jobs are stored in Supabase and are processed by four browser-driven workers while the organizer keeps the evaluation page open. For durable processing across browser disconnects/restarts, deploy a managed Supabase Queue/cron worker before relying on long evaluation runs.
- Email confirmations, XLSX export, evaluation-report PDF generation (browser print/save is available), and automated evaluation-time benchmarking are not included.
- Do not enable the event for real submissions until environment configuration, both migrations, administrator roles, function deployments, storage policies, rate limits, and event opening/deadline settings have been verified. TypeScript/build and anonymous-route checks do not replace authenticated live-Supabase tests.

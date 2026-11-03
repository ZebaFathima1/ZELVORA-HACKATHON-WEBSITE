# Zelvora Hackathon Platform

Hackathon participant submission and organizer evaluation portal for Zelvora Technologies Pvt. Ltd. The backend is Supabase: PostgreSQL, Auth, private Storage, Row Level Security, and Supabase Edge Functions. There is no separate FastAPI service.

## What is included

- Responsive participant portal with read-only team verification, four-step project submission, required presentation upload, progress, confirmation, and printable receipt.
- Database-enforced one-submission-per-team with an atomic RPC and unique constraint.
- Dedicated `/organizer` sign-in with existing `admin_users` authorization, RLS-protected workspace, roster CSV import, event controls, submission review/download, evaluation batches, reports, leaderboards, and organizer-controlled shortlisting.
- Supabase job queue and evidence pipeline with a separately authenticated Windows worker that uses local Ollama (`qwen3-vl:8b`); the website never connects to Ollama or exposes its port.
- Presentation, repository, and evidence-consistency reports; image/OCR and deployment limitations are explicitly marked for organizer review.
- Optional, clearly labeled 40-team demo fixture in `supabase/demo_seed.sql`. All fixture rows carry `is_demo=true`; RLS, dashboard queries, and real evaluation batches exclude them.
- SQL migration, environment template, and deployment/security documentation.

## Requirements

- Node.js 20+
- A Supabase project with the CLI installed for local Supabase development/deployment
- Ollama for Windows with `qwen3-vl:8b` downloaded
- A high-entropy worker secret configured in Supabase Edge Function secrets and the local worker environment

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
4. Link the Supabase CLI to the project and apply the database migrations in order:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Find `YOUR_PROJECT_REF` in the project URL (`https://YOUR_PROJECT_REF.supabase.co`). If using **SQL Editor**, run every migration file in timestamp order, including `202611030001_qwen_live_finalization.sql` and `202611030002_local_ollama_worker.sql`.
5. In **Project Settings → Edge Functions → Secrets**, add:

   | Secret | Value |
   | --- | --- |
   | `AI_WORKER_SECRET` | A new random secret shared only with your local worker; do not use your Supabase service-role key |
   | `ALLOWED_ORIGIN` | Explicit comma-separated allowlist. Localhost now: `http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001`. Append `,https://YOUR_PRODUCTION_DOMAIN` later (never `*`) |

   Generate a secret locally in PowerShell with `$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToBase64String($bytes)` and use the exact same value in `ai-worker/.env`. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Functions. Never put the service-role key or worker secret in the website's `.env.local` or browser code. `GITHUB_TOKEN` is optional and can improve public GitHub API rate limits.
6. Deploy the Edge Functions:

   ```powershell
   npx supabase functions deploy verify-team
   npx supabase functions deploy submit-project
   npx supabase functions deploy ai-worker-control
   npx supabase functions deploy ai-worker-status
   npx supabase functions deploy start-ai-evaluation
   npx supabase functions deploy evaluation-status
   npx supabase functions deploy finalize-leaderboard
   npx supabase functions deploy process-evaluation
   npx supabase functions deploy evaluate-project
   npx supabase functions deploy start-evaluation
   npx supabase functions deploy test-ai-provider
   ```
   The worker-control endpoint requires `AI_WORKER_SECRET`; only the worker knows it. Organizer actions still validate Supabase Auth and roles inside the function.
   The last four commands deploy retired hosted-provider endpoints that return HTTP 410, ensuring older clients cannot continue using hosted inference. Remove any old `QWEN_API_KEY`, `QWEN_API_URL`, or `QWEN_MODEL_NAME` secrets after these deployments succeed.
7. Configure and install the worker:

   ```powershell
   Copy-Item ai-worker\.env.example ai-worker\.env
   notepad ai-worker\.env
   ```

   Set `SUPABASE_URL` to your project URL, `SUPABASE_ANON_KEY` to the public publishable/anon key, and `AI_WORKER_SECRET` to the same random value saved in Supabase. Leave `OLLAMA_BASE_URL=http://127.0.0.1:11434` and `OLLAMA_MODEL=qwen3-vl:8b` unless your local setup differs. Do not set Ollama to a public or LAN address.

   Then install the local worker's dependencies once:

   ```powershell
   npm --prefix ai-worker install
   ```
8. (Optional, development/test project only) To exercise the participant submission flow, run `supabase/participant_test_seed.sql` in the Supabase SQL Editor after all migrations. It creates a clearly labeled test team with ID `ZYL900099` and temporarily opens submissions. Submit that team once to test the full flow; submissions are intentionally one-time. Do not run this fixture against a live event project.
9. (Optional, development project only) For populated organizer-screen fixtures, run `supabase/demo_seed.sql` in the Supabase SQL Editor after all migrations. This inserts synthetic records, including mock scores that are not AI output; do not treat them as real submissions, reports, recommendations, or awards. The seed is idempotent and aborts if its reserved team-ID range collides with real teams. Normal RLS policies and application queries hide demo rows, and real evaluation batches exclude them.
10. Start the website on port 3001:

   ```powershell
   npm run dev:organizer
   ```

   Open `http://localhost:3001/organizer`. Leave the dev terminal running; press **Ctrl+C** to stop it.
11. Start the worker from the repository root in another PowerShell window:

   ```powershell
   .\scripts\start-ai-worker.ps1
   .\scripts\check-ai-worker.ps1
   ```

   It checks Ollama/model availability, performs a small model-generation test, then registers heartbeats with Supabase. It processes one project at a time and does not require the browser tab to remain open.
12. Create an organizer account from `/organizer`. The signup migration adds new authenticated accounts to `admin_users` with the organizer role. Sign in and open **AI Evaluation → Test AI connection**. Confirm Supabase, worker, Ollama, and model all show ready; freeze submissions in **Event Settings** before starting evaluation.

To pause/resume a batch, use the dashboard controls. To gracefully stop the worker, run `.\scripts\stop-ai-worker.ps1`; Ollama is left running. The worker only contacts Supabase over HTTPS, and Ollama remains bound to loopback. A deployed website uses the same Supabase functions, so the public browser never calls localhost.

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
- Evaluation never executes untrusted repository code or fetches participant deployment URLs. It extracts PDF/PPTX text, passes up to four embedded PPTX images to local Qwen3-VL through Ollama, and statically inspects a capped set of GitHub metadata/source files. PDF pages are not currently rendered to images; image-only PDFs and legacy `.ppt` extraction are flagged for manual review. Deployment behavior always remains unverified and requires organizer review.
- Evaluation jobs remain in Supabase while the local worker is offline. Job claims are atomic, leased, retried/requeued after worker loss, and saved results are retried after temporary network failures. Worker progress and heartbeat are visible in the organizer dashboard.
- Evaluation uses local Ollama rather than Hugging Face/provider inference. Ollama must be running on the Windows host, but no public Ollama port or tunnel is required. PDF pages currently contribute extracted text only; image-only PDFs and unverified deployment behavior require manual review.
- Email confirmations, XLSX export, evaluation-report PDF generation (browser print/save is available), and automated evaluation-time benchmarking are not included. No 125–250-project completion time is promised; throughput depends on local GPU/CPU, model settings, and provider-independent document extraction.
- Do not enable the event for real submissions until environment configuration, all migrations, administrator roles, function deployments, storage policies, rate limits, and event opening/deadline settings have been verified. TypeScript/build and anonymous-route checks do not replace authenticated live-Supabase tests.

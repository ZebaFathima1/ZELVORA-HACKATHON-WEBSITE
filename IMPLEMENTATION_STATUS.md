# Implementation status

## Implemented in this workspace

- [x] Next.js/TypeScript foundation and responsive, branded participant/admin UI.
- [x] Supabase client integration and environment placeholders (`.env.local` already configured; not overwritten).
- [x] Team ID verification against registered Supabase rows; read-only team details.
- [x] Four-step participant form with backend validation, GitHub requirement, deployment exception, file limits/types, upload progress, confirmation, and printable receipt.
- [x] Atomic, unique one-submission-per-team database path; duplicate response includes existing reference; submission fields and evaluation snapshot are database-immutable.
- [x] Private Storage bucket and admin-only signed download.
- [x] Supabase Auth organizer login at `/organizer`, role checks, RLS, organizer dashboard, submissions search/filter/details, CSV export and registered-team CSV import.
- [x] Submission opening/deadline/enabled/frozen controls and audit trigger.
- [x] Shared localhost/production evaluation architecture: browser → Supabase Edge Functions → evaluation queue → authenticated Windows AI worker → local Ollama (`qwen3-vl:8b`) → results in Supabase → organizer dashboard. The browser never calls `localhost:11434`.
- [x] Local worker (`ai-worker/`) with secret auth, heartbeat, atomic claim/lease, progress, retries, recovery of interrupted jobs, process lock, graceful stop scripts.
- [x] Evidence pipeline (PDF/PPTX extraction, static GitHub inspection, VL image attachments when available), validated rubric scoring, manual-review flags, provisional/final rankings.
- [x] Organizer AI Evaluation page: Test AI connection, Supabase/worker/Ollama/model status, queue counts, Start / Pause / Resume, progress, finalize Top 5.
- [x] Worker smoke test fixed for Qwen3-VL: uses `/api/chat` because `/api/generate` often returns empty `response` with filled `thinking`.
- [x] Demo-data isolation across RLS and evaluation batches.

## Local verification completed (this session)

- [x] Existing project is Next.js 14 at repo root (previous `create-next-app` network failure was irrelevant; no second app was created).
- [x] `npm test` — 3/3 passed.
- [x] `npm run typecheck` — passed.
- [x] Ollama API connected at `http://127.0.0.1:11434`.
- [x] Model `qwen3-vl:8b` installed.
- [x] `/api/chat` JSON smoke test returned `{"ok":true}`.
- [x] Supabase project linked: `mijzlufjpmoyluhwzrgh` (host matches `.env.local`).
- [x] `ai-worker/.env` created from existing `.env.local` (gitignored); `.env.local` not modified.
- [x] Edge Functions already deployed for core flows; **missing on remote:** `ai-worker-control`, `ai-worker-status`.
- [x] Remote migrations applied through `202611020001`; **pending on remote:** `202611030001`, `202611030002` (Qwen finalization + local Ollama worker tables).

## Blocked on production mutation consent

Agent mode cannot apply hosted Supabase mutations without explicit `--yes` approval:

1. `npx supabase db push --remote --yes` — apply worker migrations.
2. `npx supabase secrets set --env-file ai-worker/.supabase-secrets.env --yes` — set `AI_WORKER_SECRET` + `ALLOWED_ORIGIN`.
3. Deploy `ai-worker-control` and `ai-worker-status` (and refresh related evaluation functions).

One-shot script after you approve:

```powershell
.\scripts\apply-ollama-integration.ps1
.\scripts\start-ai-worker.ps1
.\scripts\check-ai-worker.ps1
```

## Not claimed complete yet

- [ ] End-to-end evaluation job saved to Supabase (requires migrations + secrets + function deploy + running worker).
- [ ] Leaderboard updated from a real AI evaluation.
- [ ] Production domain browser test against the same worker (domain/deploy URL not verified in this session).
- [ ] OCR for image-only PDFs; deployed-app crawling remains intentionally disabled (SSRF).

## Network failure note (prior agent)

`npx create-next-app` failed with `ECONNRESET` against the npm registry. That attempt was unnecessary: this repository already has a working Next.js app, `package-lock.json`, and `node_modules`. No new Next.js scaffold was required or created in this continuation.

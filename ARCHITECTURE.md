# Architecture

```text
Browser
  ├─ Next.js participant portal (public Team ID flow)
  └─ Next.js organizer workspace (Supabase Auth session)
       ├─ Supabase Auth
       ├─ PostgREST with role-aware RLS
       ├─ Supabase Storage (private submission-files bucket)
       └─ Supabase Edge Functions
            ├─ verify-team       (public, rate-limited)
            ├─ submit-project   (public, validates and uploads)
            ├─ start-ai-evaluation (admin-only, checks local worker and freezes snapshot)
            ├─ ai-worker-control (secret-authenticated machine operations)
            ├─ evaluation-status (admin-only live status and provisional rankings)
            └─ finalize-leaderboard (admin-only recommendation staging)

Supabase PostgreSQL
  ├─ registration, submission, evaluation, and organizer tables
  ├─ unique team submission constraint + transactional submit_project RPC
  ├─ immutable evaluation snapshot + job claim/finish RPCs
  └─ RLS, audit triggers, rate-limit counters

External evidence providers
  ├─ GitHub REST API (public repository metadata, languages, README)
  └─ None for AI inference (local Ollama only)

Windows organizer machine
  ├─ standalone ai-worker process (outbound HTTPS to Supabase)
  ├─ worker secret stored in local ai-worker/.env and Supabase Function secrets
  └─ Ollama bound to loopback (127.0.0.1:11434) → qwen3-vl:8b
```

## Trust boundaries

- The browser contains only the Supabase URL and public anon key. These are not secrets; RLS and Edge Function checks enforce access.
- The service-role key and worker authentication secret are server-side only. The worker uses the public Supabase key plus its dedicated shared secret; the service-role key never leaves Supabase.
- Public participant Edge Functions accept a Team ID but treat it as an identifier, not authentication. Their outputs are limited to team information needed for confirmation and duplicate status. Calls are rate-limited.
- Submitted text and GitHub README are untrusted prompt data. The evaluator's system prompt fixes the rubric and prohibits obeying embedded instructions.
- GitHub analysis retrieves public repository metadata, languages, README, and a capped selection of source files. It never clones or executes project code.
- The local worker evaluates the submitted description, extracted presentation, static GitHub evidence, and available PPTX images in one local Ollama request so cross-verification uses the same context. PDFs currently contribute extracted text only; image-only PDFs require manual review.
- Submitted deployment URLs are not fetched. This prevents a server-side request-forgery path until a properly isolated browser worker is configured.
- The evaluation batch stores an immutable JSON snapshot before jobs are created. Worker inputs are read from that snapshot rather than mutable roster/submission rows.
- The local worker is not reachable from the public internet. It claims jobs over HTTPS through authenticated Edge Functions, uses an atomic PostgreSQL lease, and renews the lease while a local Ollama request is in flight.

## Scalability and resilience

The database has indexes for queue claim/status and lease queries, one job per project per batch, and `FOR UPDATE SKIP LOCKED` claims. Expired leases are requeued up to the retry limit; completed output is retained locally until Supabase confirms the save. Jobs remain pending while the Windows worker is offline. Processing is sequential by default to avoid overloading local hardware.

## Ranking policy

Each track is ranked by score descending. Equal scores are ordered by earlier submission timestamp, then Team ID ascending. Validated completed evaluations update provisional Top 5 leaderboards in Supabase; Supabase Realtime notifies dashboards, with polling as fallback. Staged final recommendations remain unapproved until an organizer approves them.

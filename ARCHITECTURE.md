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
            ├─ start-evaluation (admin-only, freezes snapshot)
            └─ process-evaluation (admin-only job worker)

Supabase PostgreSQL
  ├─ registration, submission, evaluation, and organizer tables
  ├─ unique team submission constraint + transactional submit_project RPC
  ├─ immutable evaluation snapshot + job claim/finish RPCs
  └─ RLS, audit triggers, rate-limit counters

External evidence providers
  ├─ GitHub REST API (public repository metadata, languages, README)
  └─ Configured OpenAI-compatible API (structured evaluation response)
```

## Trust boundaries

- The browser contains only the Supabase URL and public anon key. These are not secrets; RLS and Edge Function checks enforce access.
- The service-role key and LLM API key are Supabase Function secrets and never enter browser bundles.
- Public participant Edge Functions accept a Team ID but treat it as an identifier, not authentication. Their outputs are limited to team information needed for confirmation and duplicate status. Calls are rate-limited.
- Submitted text and GitHub README are untrusted prompt data. The evaluator's system prompt fixes the rubric and prohibits obeying embedded instructions.
- GitHub analysis retrieves public metadata, languages, and README only. It never clones or executes project code.
- Submitted deployment URLs are not fetched. This prevents a server-side request-forgery path until a properly isolated browser worker is configured.
- The evaluation batch stores an immutable JSON snapshot before jobs are created. Worker inputs are read from that snapshot rather than mutable roster/submission rows.

## Scalability and resilience

The database has indexes for queue claim/status queries, one job per project per batch, and `FOR UPDATE SKIP LOCKED` job claims. The current organizer UI dispatches up to four workers and records independent success/failure states. This supports controlled concurrency but is not a durable managed queue; the operator must keep the evaluation page open. Use Supabase Queues/pgmq or an equivalent managed worker before relying on unattended 125–250 project processing.

## Ranking policy

Each track is ranked by score descending. Equal scores are ordered by earlier submission timestamp, then Team ID ascending. Ranks are provisional recommendations; organizers retain winner/runner-up decisions.

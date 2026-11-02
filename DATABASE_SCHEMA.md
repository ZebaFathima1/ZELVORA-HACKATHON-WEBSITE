# Database schema

Migration: `supabase/migrations/202611010001_initial_schema.sql`.

| Table | Purpose | Key constraints / access |
|---|---|---|
| `teams` | Stable registration roster and assigned track | UUID PK, unique `team_id`, track enum; organizer-managed, track/ID locked after submission |
| `team_members` | Registered team members | FK to team, organizer-managed |
| `submissions` | Immutable final project | Unique `team_uuid` enforces one submission per team; status may change only through workers |
| `submission_files` | Private uploaded-file metadata | FK to submission, constrained file kinds and 20 MB limit |
| `admin_users` | Supabase Auth user roles | `admin`, `organizer`, `evaluator` |
| `event_settings` | Open/deadline/enabled/frozen state | Singleton row; changes audited |
| `evaluation_batches` | Frozen project snapshot and batch counters | Snapshot cannot be updated |
| `evaluation_jobs` | Per-submission job state/retries/timestamps | Unique batch+submission, indexed queue claim |
| `evaluation_evidence` | Source-specific evidence snapshot | FK to evaluation job |
| `ai_evaluations` | Structured rubric report | One latest evaluation per submission, score 0–100 |
| `evaluation_criteria` | Rubric metadata | Seven criteria totaling 100 points |
| `leaderboards` | Track score and rank | Unique track+submission; ranking tie-breaker documented |
| `shortlisted_teams` | Organizer review state and reasons | Unique track+submission, recommended/approved/rejected |
| `audit_logs` | Admin changes and event actions | Admin-readable; event settings and shortlist changes have triggers |
| `public_api_limits` | Edge Function rate-limit windows | RLS enabled, service-role-only RPC access |

## Core functions

- `submit_project(...)`: service-role-only transaction; checks team and current event window, inserts the submission and file rows, returns generated `ZSUB-####` reference. Duplicate `team_uuid` insert is rejected atomically.
- `consume_public_rate_limit(...)`: atomic fixed-window counter called by public functions.
- `import_registered_teams(...)`: authenticated organizer-only atomic roster import.
- `create_evaluation_batch(...)`: freezes submissions, snapshots project/team/file metadata, and creates jobs in one transaction.
- `claim_evaluation_job(...)`: claims one queued job with `FOR UPDATE SKIP LOCKED`.
- `finish_evaluation_job(...)`: records a validated result or independent failure, updates counters, and refreshes the affected track rank.
- `is_admin()` / `has_any_role(...)`: RLS role predicates.

Participant access to base tables is denied. Public functions use the service role only after validation and rate checks. Storage bucket `submission-files` is private; only registered admin roles can read via RLS and short-lived signed URLs.

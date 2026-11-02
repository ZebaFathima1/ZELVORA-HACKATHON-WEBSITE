# Project plan

## Architecture decision

Use Next.js App Router with TypeScript for the participant and organizer UI, with Supabase as the complete backend: PostgreSQL/RLS, Auth, private Storage, and Edge Functions. A separate FastAPI service is intentionally not introduced; this preserves the requested Supabase backend and reduces the number of systems requiring credentials and deployment.

## Work phases

1. Foundation: Next.js, shared types/validation, Supabase clients, environment setup.
2. Participant portal: Team ID lookup, read-only registration profile, four-step submission, receipt.
3. Submission integrity: server-side validation, private uploads, rate limits, atomic database RPC, unique team constraint, immutable project fields.
4. Organizer access: Supabase Auth, role checks, admin layout, RLS.
5. Operations: dashboard, roster import, search/export, private file downloads, submission windows and audit history.
6. Evaluation: frozen project snapshot, job tables/claim RPC, GitHub evidence, structured LLM scoring, report persistence.
7. Decisions: track ranking, shortlisting recommendations and organizer approval/rejection.
8. Deployment and security: Vercel/Supabase setup, secret handling, RLS review, deployment limitations.

## Completion gates

- No client-side service-role or AI credentials.
- A team can create at most one submission, including concurrent requests.
- All admin records are protected by authenticated role-aware RLS.
- Participant data and uploads remain private except for intentionally returned team profile information.
- Scores satisfy the published criterion maxima and sum to 100.
- Unverified evidence is disclosed; AI recommendations do not declare winners.
- Live integration and deployment are not considered verified until run against configured Supabase and LLM projects.

## Known blockers before production

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) and [SECURITY.md](./SECURITY.md). In particular: high-assurance participant access, durable server-managed evaluation workers, presentation text extraction, isolated deployment inspection, and configured live validation require follow-up work and event credentials.

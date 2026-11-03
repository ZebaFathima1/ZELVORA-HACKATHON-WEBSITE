# Security notes

## Implemented controls

- Public anon key only in the browser; service-role key remains inside Supabase. The worker secret is only in Supabase Function secrets and the local worker `.env`.
- Row Level Security is enabled for platform tables. Public users cannot query participant or organizer tables directly.
- Admin sessions use Supabase Auth; RLS maps user UUID to `admin_users` role. Evaluators are read-only; organizer-only operations are restricted.
- Submission validation occurs in an Edge Function and again in a service-role-only database transaction. A unique constraint on `submissions.team_uuid` and row lock prevent concurrent duplicate submissions.
- Submitted project fields cannot be edited after receipt. Team ID/track cannot be changed after a team has a submission. Evaluation snapshot content is immutable.
- Submission files use a private Storage bucket, server-side MIME/signature/size validation, sanitized names, and short-lived signed links for authorized administrators.
- Public lookup and submission endpoints use atomic rate-limit counters; submission attempts are limited per source IP and per team.
- The Windows worker makes outbound HTTPS requests only; Ollama stays on loopback and no tunnel/port-forwarding is used. Worker endpoints require a dedicated secret, and organizer controls also verify Supabase Auth roles.
- Evaluation workers do not clone/execute submitted code or request participant deployment URLs. Project descriptions and repository text are explicitly untrusted; score fields and evidence references are validated before persistence.
- Event settings and shortlist changes are written to the audit table.

## Material residual risks

1. **Team ID is not authentication.** Anyone who obtains a team ID can view the returned team name/member names/college/track and can submit first, preventing the legitimate team from submitting. Rate limits do not establish identity. Before a high-stakes event, integrate a high-entropy, one-time secret submission token from the registration portal and require it in both verification and submit functions.
2. **Admin bootstrap and credentials.** Provision admins directly from trusted Supabase project administration. Enable MFA, strong password policy, least privilege, session expiry, and alerting in project settings.
3. **Local data handling.** The worker downloads private presentation files into memory and sends extracted evidence to Ollama on the local host. Control access to the Windows account/device. Pending model output is stored in `ai-worker/.active-job.json` until Supabase confirms persistence.
4. **LLM reliability/bias.** AI scores are advisory; evidence gaps and contradictions are flagged for manual review, and organizer approval is required for final awards. PDF page visuals and deployed applications remain unverified.
5. **Worker availability.** When the Windows computer is offline, jobs remain queued and evaluation cannot proceed. Expired leases are requeued safely; no background inference happens while the worker is off.
6. **No live integration tests have been run.** Apply migrations to a non-production project first; test RLS with anon, participant, evaluator, organizer, and admin roles; run worker restart, offline, model-missing, and actual single-project tests.

## Operations checklist

- Set `ALLOWED_ORIGIN` to an explicit comma-separated origin allowlist (never `*`), e.g. `http://localhost:3000,http://localhost:3001,https://your-production-domain`. Edge Functions reflect only listed origins (plus built-in localhost:3000/3001). Append the production HTTPS origin when the site is deployed.
- Configure and rotate the worker secret and optional GitHub token as managed secrets.
- Import only verified registration records; restrict access to CSV files.
- Set opening/deadline settings and verify with participant test IDs before announcing the portal.
- Review Supabase logs, rate-limit behavior, storage policies, and Edge Function resource limits.
- Use a separate staging project and never test duplicate/race behavior against the live event database.
- Review legal/data-retention requirements for member names and uploaded files.

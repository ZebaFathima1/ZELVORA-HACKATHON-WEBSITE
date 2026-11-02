# Security notes

## Implemented controls

- Public anon key only in the browser; service-role and AI secrets belong exclusively in Supabase Function secrets.
- Row Level Security is enabled for platform tables. Public users cannot query participant or organizer tables directly.
- Admin sessions use Supabase Auth; RLS maps user UUID to `admin_users` role. Evaluators are read-only; organizer-only operations are restricted.
- Submission validation occurs in an Edge Function and again in a service-role-only database transaction. A unique constraint on `submissions.team_uuid` and row lock prevent concurrent duplicate submissions.
- Submitted project fields cannot be edited after receipt. Team ID/track cannot be changed after a team has a submission. Evaluation snapshot content is immutable.
- Submission files use a private Storage bucket, server-side MIME/signature/size validation, sanitized names, and short-lived signed links for authorized administrators.
- Public lookup and submission endpoints use atomic rate-limit counters; submission attempts are limited per source IP and per team.
- Evaluation workers do not clone/execute submitted code or request participant deployment URLs. Project descriptions and repository text are explicitly untrusted; score fields are validated against rubric ceilings.
- Event settings and shortlist changes are written to the audit table.

## Material residual risks

1. **Team ID is not authentication.** Anyone who obtains a team ID can view the returned team name/member names/college/track and can submit first, preventing the legitimate team from submitting. Rate limits do not establish identity. Before a high-stakes event, integrate a high-entropy, one-time secret submission token from the registration portal and require it in both verification and submit functions.
2. **Admin bootstrap and credentials.** Provision admins directly from trusted Supabase project administration. Enable MFA, strong password policy, least privilege, session expiry, and alerting in project settings.
3. **LLM reliability/bias.** AI scores are advisory and all reports are flagged for human review because presentation text and deployed app are not independently evaluated. Organizers must review evidence and determine awards.
4. **Evaluation-worker durability.** Current workers run from the organizer browser; a tab close/network outage can leave jobs queued. Use a managed server-side Supabase queue/worker before production-scale operation.
5. **No live integration tests have been run.** Apply migrations to a non-production project first; test RLS with anon, participant, evaluator, organizer, and admin roles; run simultaneous duplicate-submission tests and upload rejection tests.

## Operations checklist

- Set `ALLOWED_ORIGIN` to the exact frontend origin, not `*`, for deployment.
- Configure and rotate Supabase/LLM/GitHub credentials as managed secrets.
- Import only verified registration records; restrict access to CSV files.
- Set opening/deadline settings and verify with participant test IDs before announcing the portal.
- Review Supabase logs, rate-limit behavior, storage policies, and Edge Function resource limits.
- Use a separate staging project and never test duplicate/race behavior against the live event database.
- Review legal/data-retention requirements for member names and uploaded files.

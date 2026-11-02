# API documentation

All functions are deployed under `/functions/v1/`. Browser calls use the public anon key. Admin functions also require a valid Supabase Auth bearer token and a row in `admin_users`.

## `POST /verify-team`

Request: `{ "team_id": "ZYL001" }`

Returns team ID/name/leader/college/branch/track/member names, team size, whether the event is open, and an existing reference if already submitted. Does not expose member emails. Public and rate limited. A Team ID is not a credential.

## `POST /submit-project`

Multipart form fields: `team_id`, `project_title`, all nine project narrative fields, `github_url`, optional `deployed_url`, optional `demo_video_url`, `deployment_exception`, `confirmed=true`, required `presentation` file, optional `architecture` and `documentation` files.

Accepted files: PDF, PPT, PPTX, PNG, JPG/JPEG, at most 20 MiB each. Content type and file signatures are checked; storage is private. The function calls `submit_project` after uploading and removes staged files if the database transaction fails.

Success: `{ "submission_id": "uuid", "reference": "ZSUB-0001", "submitted_at": "ISO-8601 timestamp" }`

Duplicate response: HTTP 409 with the exact no-multiple-submissions message and existing reference/project title where available. Closed window: HTTP 403. Invalid data: HTTP 400. Public rate limits are per IP and per Team ID.

## `POST /start-evaluation`

Admin/organizer only. No required body. Atomically freezes submissions and creates an immutable project snapshot, batch, and jobs.

Success: `{ "batch_id": "uuid" }`

## `POST /process-evaluation`

Authenticated admin/evaluator only. Request: `{ "batch_id": "uuid" }`. Claims one job, retrieves GitHub metadata/README, requests a JSON evaluation from the configured LLM provider, validates criterion scores, and persists the report. Returns `{ "done": true, "processed": false }` when no queued job remains; otherwise `{ "done": false, "processed": true, "score": 82 }`. Provider failures mark only that job failed.

LLM provider requirements: OpenAI-compatible `/chat/completions` with `response_format: { "type": "json_object" }`.

## Authenticated database API

Organizer pages use Supabase PostgREST. RLS permits read-only evaluator access; admin/organizer roles can adjust allowed records. Participant APIs must not query tables directly.

Team roster import uses `import_registered_teams(p_rows)` and is atomic. The CSV headers are `team_id,team_name,team_leader,college,branch,track,members`; `members` is a pipe-separated list of 2–4 registered names including the team leader.

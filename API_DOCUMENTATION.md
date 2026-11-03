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

## `POST /start-ai-evaluation`

Admin/organizer only. No required body. Atomically freezes submissions and creates an immutable project snapshot, batch, and jobs.

Success: `{ "batch_id": "uuid" }`

## `POST /ai-worker-control`

Worker operations use the `x-worker-secret` header and `worker_id`; the shared secret is server-side only and is never sent to the browser. Actions include `heartbeat`, `claim`, `context`, `progress`, `renew`, `complete`, and `fail`. Admin-only `pause` and `resume` actions require a Supabase Auth bearer token and organizer role.

Claiming is atomic in PostgreSQL and assigns a 10-minute renewable lease. Worker context is built from the immutable batch snapshot, private Supabase Storage, and static GitHub API inspection; repository code is never executed. The Windows worker sends the context to local Ollama and returns the model JSON. The Edge Function validates score ceilings and evidence reference IDs before the existing completion RPC saves all evaluation/evidence tables and provisional rankings.

## `GET /ai-worker-status`

Authenticated admin/evaluator only. Reports whether a recent Windows worker heartbeat is present, Ollama is reachable, the configured model passed a generation smoke test, and the queue is ready. `start-ai-evaluation` refuses to create a batch when the worker or model is unavailable.

## `POST /evaluation-status`

Authenticated admin/evaluator only. Optional request: `{ "batch_id": "uuid" }`; without it, returns the latest real batch. Returns job counts, job stages, manual-review count, and provisional track Top 5 data. The organizer UI subscribes to Supabase Realtime and keeps a five-second polling fallback.

## `POST /finalize-leaderboard`

Admin/organizer only. Request: `{ "batch_id": "uuid" }`. Once jobs are no longer queued or processing and required manual reviews are resolved, stores per-track Top 5 as `recommended` rows. Failed jobs are reported as flagged; they are not ranked. This does not approve awards or overwrite existing approved rankings. Human approval remains required.

Inference runs only on the configured local Ollama host (`qwen3-vl:8b`). The browser and deployed website never connect to `localhost:11434`; the worker makes outbound HTTPS requests to Supabase.

## Authenticated database API

Organizer pages use Supabase PostgREST. RLS permits read-only evaluator access; admin/organizer roles can adjust allowed records. Participant APIs must not query tables directly.

Team roster import uses `import_registered_teams(p_rows)` and is atomic. The CSV headers are `team_id,team_name,team_leader,college,branch,track,members`; `members` is a pipe-separated list of 2–4 registered names including the team leader.

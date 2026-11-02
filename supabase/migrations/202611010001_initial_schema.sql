create extension if not exists pgcrypto;

create type public.hackathon_track as enum (
  'Education / EdTech',
  'AI Innovation',
  'Healthcare',
  'Business'
);

create sequence if not exists public.submission_reference_seq start 1;

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  team_id text not null unique check (team_id ~ '^ZYL[0-9]{3,}$'),
  team_name text not null,
  team_leader text not null,
  college text not null,
  branch text not null,
  track public.hackathon_track not null,
  created_at timestamptz not null default now()
);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_uuid uuid not null references public.teams(id) on delete cascade,
  full_name text not null,
  email text,
  member_role text,
  created_at timestamptz not null default now()
);

create index team_members_team_uuid_idx on public.team_members(team_uuid);
create unique index team_members_unique_name_idx on public.team_members(team_uuid, lower(full_name));

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default (
    'ZSUB-' || lpad(nextval('public.submission_reference_seq')::text, 4, '0')
  ),
  team_uuid uuid not null unique references public.teams(id),
  project_title text not null,
  project_data jsonb not null,
  github_url text not null,
  deployed_url text,
  demo_video_url text,
  deployment_exception text,
  manual_review boolean not null default false,
  status text not null default 'submitted'
    check (status in ('submitted', 'queued', 'evaluating', 'evaluated', 'failed')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index submissions_submitted_at_idx on public.submissions(submitted_at desc);
create index submissions_status_idx on public.submissions(status);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_uuid uuid not null references public.submissions(id) on delete cascade,
  file_kind text not null check (file_kind in ('presentation', 'architecture', 'documentation')),
  storage_path text not null unique,
  original_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_at timestamptz not null default now()
);

create table public.admin_users (
  user_uuid uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('admin', 'organizer', 'evaluator')),
  created_at timestamptz not null default now()
);

create table public.event_settings (
  id boolean primary key default true check (id),
  opens_at timestamptz,
  deadline_at timestamptz,
  submissions_enabled boolean not null default false,
  frozen boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.event_settings (id) values (true) on conflict (id) do nothing;

create table public.evaluation_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  snapshot jsonb not null,
  total_jobs integer not null default 0,
  queued_jobs integer not null default 0,
  processing_jobs integer not null default 0,
  completed_jobs integer not null default 0,
  failed_jobs integer not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.evaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_uuid uuid not null references public.evaluation_batches(id) on delete cascade,
  submission_uuid uuid not null references public.submissions(id),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_uuid, submission_uuid)
);

create index evaluation_jobs_claim_idx on public.evaluation_jobs(status, created_at);

create table public.evaluation_evidence (
  id uuid primary key default gen_random_uuid(),
  job_uuid uuid not null references public.evaluation_jobs(id) on delete cascade,
  source text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create table public.ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  submission_uuid uuid not null unique references public.submissions(id),
  job_uuid uuid not null references public.evaluation_jobs(id),
  total_score numeric(5,2) not null check (total_score between 0 and 100),
  criteria jsonb not null,
  strengths jsonb not null,
  weaknesses jsonb not null,
  innovation_assessment text not null,
  technical_assessment text not null,
  github_assessment text not null,
  deployment_assessment text not null,
  missing_information jsonb not null,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  manual_review boolean not null default false,
  evaluated_at timestamptz not null default now()
);

create table public.evaluation_criteria (
  id uuid primary key default gen_random_uuid(),
  criterion_key text not null unique,
  label text not null,
  maximum_score integer not null check (maximum_score > 0),
  display_order integer not null
);

insert into public.evaluation_criteria (criterion_key, label, maximum_score, display_order) values
  ('innovation', 'Innovation and Originality', 20, 1),
  ('technical_implementation', 'Technical Implementation', 20, 2),
  ('github_code_quality', 'GitHub Code Quality', 15, 3),
  ('problem_solving', 'Problem Solving', 15, 4),
  ('real_world_impact', 'Real-World Impact', 10, 5),
  ('ui_ux', 'UI/UX', 10, 6),
  ('documentation', 'Documentation and Explanation', 10, 7)
on conflict (criterion_key) do nothing;

create table public.leaderboards (
  id uuid primary key default gen_random_uuid(),
  track public.hackathon_track not null,
  submission_uuid uuid not null references public.submissions(id) on delete cascade,
  rank integer not null check (rank > 0),
  score numeric(5,2) not null check (score between 0 and 100),
  calculated_at timestamptz not null default now(),
  unique (track, submission_uuid)
);

create table public.shortlisted_teams (
  id uuid primary key default gen_random_uuid(),
  track public.hackathon_track not null,
  submission_uuid uuid not null references public.submissions(id) on delete cascade,
  position integer,
  status text not null default 'recommended' check (status in ('recommended', 'approved', 'rejected')),
  reason text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (track, submission_uuid),
  unique (track, position)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_uuid uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.public_api_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null
);
alter table public.public_api_limits enable row level security;

create or replace function public.prevent_submission_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.team_uuid is distinct from old.team_uuid
     or new.project_title is distinct from old.project_title
     or new.project_data is distinct from old.project_data
     or new.github_url is distinct from old.github_url
     or new.deployed_url is distinct from old.deployed_url
     or new.demo_video_url is distinct from old.demo_video_url
     or new.deployment_exception is distinct from old.deployment_exception
     or new.manual_review is distinct from old.manual_review
     or new.submitted_at is distinct from old.submitted_at
     or new.reference is distinct from old.reference then
    raise exception 'SUBMISSIONS_ARE_READ_ONLY';
  end if;
  return new;
end;
$$;

create trigger submission_fields_are_immutable
before update on public.submissions
for each row execute function public.prevent_submission_edits();

create or replace function public.prevent_registered_track_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.team_id is distinct from old.team_id or new.track is distinct from old.track)
     and exists (select 1 from public.submissions where team_uuid = old.id) then
    raise exception 'TEAM_ID_AND_TRACK_ARE_LOCKED_AFTER_SUBMISSION';
  end if;
  return new;
end;
$$;

create trigger submitted_team_identity_is_immutable
before update on public.teams
for each row execute function public.prevent_registered_track_edits();

create or replace function public.prevent_batch_snapshot_edits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.snapshot is distinct from old.snapshot
     or new.total_jobs is distinct from old.total_jobs
     or new.created_by is distinct from old.created_by then
    raise exception 'EVALUATION_SNAPSHOT_IS_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger evaluation_snapshot_is_immutable
before update on public.evaluation_batches
for each row execute function public.prevent_batch_snapshot_edits();

create or replace function public.consume_public_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.public_api_limits(rate_key, window_started_at, request_count)
  values (p_key, now(), 1)
  on conflict (rate_key) do update
    set window_started_at = case
          when public.public_api_limits.window_started_at < now() - make_interval(secs => p_window_seconds)
          then now() else public.public_api_limits.window_started_at end,
        request_count = case
          when public.public_api_limits.window_started_at < now() - make_interval(secs => p_window_seconds)
          then 1 else public.public_api_limits.request_count + 1 end
  returning request_count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.consume_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_public_rate_limit(text, integer, integer) to service_role;

create or replace function public.create_evaluation_batch(p_created_by uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_snapshot jsonb;
  v_total integer;
  v_settings public.event_settings%rowtype;
begin
  select * into v_settings from public.event_settings where id = true for update;
  if not found then raise exception 'EVENT_SETTINGS_NOT_CONFIGURED'; end if;

  if exists (
    select 1 from public.evaluation_batches
    where status in ('queued', 'running')
  ) then
    raise exception 'EVALUATION_BATCH_ACTIVE' using errcode = 'P0001';
  end if;

  update public.event_settings set frozen = true, updated_at = now(), updated_by = p_created_by
  where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'submission_id', s.id,
    'team_uuid', t.id,
    'team_id', t.team_id,
    'team_name', t.team_name,
    'team_leader', t.team_leader,
    'college', t.college,
    'branch', t.branch,
    'track', t.track,
    'reference', s.reference,
    'project_title', s.project_title,
    'project_data', s.project_data,
    'github_url', s.github_url,
    'deployed_url', s.deployed_url,
    'demo_video_url', s.demo_video_url,
    'deployment_exception', s.deployment_exception,
    'manual_review', s.manual_review,
    'submitted_at', s.submitted_at,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'file_kind', f.file_kind,
        'storage_path', f.storage_path,
        'original_name', f.original_name,
        'content_type', f.content_type,
        'size_bytes', f.size_bytes
      ) order by f.file_kind)
      from public.submission_files f where f.submission_uuid = s.id
    ), '[]'::jsonb)
  ) order by s.submitted_at, t.team_id), '[]'::jsonb)
  into v_snapshot
  from public.submissions s
  join public.teams t on t.id = s.team_uuid
  where s.status in ('submitted', 'failed');

  v_total := jsonb_array_length(v_snapshot);
  if v_total = 0 then raise exception 'NO_ELIGIBLE_SUBMISSIONS' using errcode = 'P0001'; end if;

  insert into public.evaluation_batches(snapshot, total_jobs, queued_jobs, created_by)
  values (v_snapshot, v_total, v_total, p_created_by)
  returning id into v_batch;

  insert into public.evaluation_jobs(batch_uuid, submission_uuid)
  select v_batch, s.id
  from public.submissions s
  where s.status in ('submitted', 'failed');

  insert into public.audit_logs(actor_uuid, action, entity_type, entity_id, details)
  values (p_created_by, 'start_evaluation', 'evaluation_batch', v_batch::text, jsonb_build_object('frozen', true, 'total_jobs', v_total));

  update public.submissions set status = 'queued'
  where status in ('submitted', 'failed');

  return v_batch;
end;
$$;
revoke all on function public.create_evaluation_batch(uuid) from public, anon, authenticated;
grant execute on function public.create_evaluation_batch(uuid) to service_role;

create or replace function public.claim_evaluation_job(p_batch uuid)
returns setof public.evaluation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.evaluation_jobs%rowtype;
begin
  select * into v_job
  from public.evaluation_jobs
  where batch_uuid = p_batch and status = 'queued'
  order by created_at
  for update skip locked
  limit 1;
  if not found then return; end if;

  update public.evaluation_jobs
  set status = 'processing', attempts = attempts + 1, started_at = now()
  where id = v_job.id
  returning * into v_job;
  update public.submissions set status = 'evaluating' where id = v_job.submission_uuid;
  update public.evaluation_batches set
    status = 'running',
    queued_jobs = greatest(queued_jobs - 1, 0),
    processing_jobs = processing_jobs + 1
  where id = p_batch;
  return next v_job;
end;
$$;
revoke all on function public.claim_evaluation_job(uuid) from public, anon, authenticated;
grant execute on function public.claim_evaluation_job(uuid) to service_role;

create or replace function public.finish_evaluation_job(
  p_job uuid,
  p_result jsonb,
  p_evidence jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission uuid;
  v_failed boolean := p_result ? 'error';
begin
  select submission_uuid into v_submission
  from public.evaluation_jobs where id = p_job for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;

  if v_failed then
    update public.evaluation_jobs
      set status = 'failed', error_message = left(p_result->>'error', 1000), completed_at = now()
      where id = p_job;
    update public.submissions set status = 'failed' where id = v_submission;
    update public.evaluation_batches set
      processing_jobs = greatest(processing_jobs - 1, 0),
      failed_jobs = failed_jobs + 1,
      status = case when queued_jobs = 0 and processing_jobs <= 1 then 'completed_with_errors' else 'running' end,
      completed_at = case when queued_jobs = 0 and processing_jobs <= 1 then now() else null end
      where id = (select batch_uuid from public.evaluation_jobs where id = p_job);
    return;
  end if;

  insert into public.ai_evaluations (
    submission_uuid, job_uuid, total_score, criteria, strengths, weaknesses,
    innovation_assessment, technical_assessment, github_assessment,
    deployment_assessment, missing_information, confidence, manual_review
  ) values (
    v_submission, p_job, (p_result->>'total_score')::numeric,
    p_result->'criteria', p_result->'strengths', p_result->'weaknesses',
    p_result->>'innovation_assessment', p_result->>'technical_assessment',
    p_result->>'github_assessment', p_result->>'deployment_assessment',
    p_result->'missing_information', p_result->>'confidence',
    coalesce((p_result->>'manual_review')::boolean, false)
  )
  on conflict (submission_uuid) do update set
    job_uuid = excluded.job_uuid,
    total_score = excluded.total_score,
    criteria = excluded.criteria,
    strengths = excluded.strengths,
    weaknesses = excluded.weaknesses,
    innovation_assessment = excluded.innovation_assessment,
    technical_assessment = excluded.technical_assessment,
    github_assessment = excluded.github_assessment,
    deployment_assessment = excluded.deployment_assessment,
    missing_information = excluded.missing_information,
    confidence = excluded.confidence,
    manual_review = excluded.manual_review,
    evaluated_at = now();

  insert into public.evaluation_evidence(job_uuid, source, evidence)
  select p_job, item->>'source', item->'evidence'
  from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) item;

  update public.evaluation_jobs set status = 'completed', completed_at = now() where id = p_job;
  update public.submissions set status = 'evaluated' where id = v_submission;
  update public.evaluation_batches set
    processing_jobs = greatest(processing_jobs - 1, 0),
    completed_jobs = completed_jobs + 1,
    status = case when queued_jobs = 0 and processing_jobs <= 1
      then case when failed_jobs > 0 then 'completed_with_errors' else 'completed' end
      else 'running' end,
    completed_at = case when queued_jobs = 0 and processing_jobs <= 1 then now() else null end
    where id = (select batch_uuid from public.evaluation_jobs where id = p_job);

  insert into public.leaderboards(track, submission_uuid, rank, score)
  values (
    (select t.track from public.teams t join public.submissions s on s.team_uuid = t.id where s.id = v_submission),
    v_submission, 1, (p_result->>'total_score')::numeric
  )
  on conflict (track, submission_uuid) do update set score = excluded.score, calculated_at = now();

  with ordered as (
    select l.id, row_number() over (
      partition by l.track order by l.score desc, s.submitted_at asc, t.team_id asc
    )::integer as new_rank
    from public.leaderboards l
    join public.submissions s on s.id = l.submission_uuid
    join public.teams t on t.id = s.team_uuid
    where l.track = (select t.track from public.teams t join public.submissions s on s.team_uuid = t.id where s.id = v_submission)
  )
  update public.leaderboards l set rank = ordered.new_rank
  from ordered where ordered.id = l.id;
end;
$$;
revoke all on function public.finish_evaluation_job(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finish_evaluation_job(uuid, jsonb, jsonb) to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_uuid = (select auth.uid())
  );
$$;

create or replace function public.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_uuid = (select auth.uid()) and role = any(p_roles)
  );
$$;

create or replace function public.import_registered_teams(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_member jsonb;
  v_team_uuid uuid;
  v_count integer := 0;
  v_member_count integer;
begin
  if not public.has_any_role(array['admin', 'organizer']) then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'TEAM_IMPORT_INVALID';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if coalesce(v_row->>'team_id', '') !~ '^ZYL[0-9]{3,}$'
       or length(coalesce(v_row->>'team_name', '')) = 0
       or length(coalesce(v_row->>'team_leader', '')) = 0
       or length(coalesce(v_row->>'college', '')) = 0
       or length(coalesce(v_row->>'branch', '')) = 0
       or v_row->>'track' not in ('Education / EdTech', 'AI Innovation', 'Healthcare', 'Business') then
      raise exception 'TEAM_IMPORT_INVALID';
    end if;
    insert into public.teams(team_id, team_name, team_leader, college, branch, track)
    values (
      upper(v_row->>'team_id'), v_row->>'team_name', v_row->>'team_leader',
      v_row->>'college', v_row->>'branch', (v_row->>'track')::public.hackathon_track
    ) returning id into v_team_uuid;
    v_member_count := 0;
    if jsonb_typeof(v_row->'members') = 'array' then
      for v_member in select * from jsonb_array_elements(v_row->'members') loop
        if length(trim(coalesce(v_member->>'full_name', ''))) > 0 then
          insert into public.team_members(team_uuid, full_name, email, member_role)
          values (v_team_uuid, trim(v_member->>'full_name'), nullif(trim(v_member->>'email'), ''), nullif(trim(v_member->>'role'), ''));
          v_member_count := v_member_count + 1;
        end if;
      end loop;
    end if;
    if v_member_count < 2 or v_member_count > 4 then
      raise exception 'TEAM_SIZE_MUST_BE_BETWEEN_2_AND_4';
    end if;
    v_count := v_count + 1;
  end loop;
  insert into public.audit_logs(actor_uuid, action, entity_type, details)
  values ((select auth.uid()), 'import', 'teams', jsonb_build_object('count', v_count));
  return v_count;
end;
$$;
revoke all on function public.import_registered_teams(jsonb) from public, anon;
grant execute on function public.import_registered_teams(jsonb) to authenticated;

create or replace function public.submit_project(
  p_team_id text,
  p_project_title text,
  p_project_data jsonb,
  p_github_url text,
  p_deployed_url text,
  p_demo_video_url text,
  p_deployment_exception text,
  p_files jsonb
)
returns table (submission_id uuid, submission_reference text, submitted_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams%rowtype;
  v_submission public.submissions%rowtype;
  v_settings public.event_settings%rowtype;
  v_file jsonb;
begin
  select * into v_team from public.teams
  where team_id = upper(trim(p_team_id))
  for update;
  if not found then
    raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_settings from public.event_settings where id = true for share;
  if v_settings is null
     or not v_settings.submissions_enabled
     or v_settings.frozen
     or (v_settings.opens_at is not null and now() < v_settings.opens_at)
     or (v_settings.deadline_at is not null and now() > v_settings.deadline_at) then
    raise exception 'SUBMISSIONS_CLOSED' using errcode = 'P0001';
  end if;

  insert into public.submissions (
    team_uuid, project_title, project_data, github_url, deployed_url,
    demo_video_url, deployment_exception, manual_review
  ) values (
    v_team.id, p_project_title, p_project_data, p_github_url, nullif(p_deployed_url, ''),
    nullif(p_demo_video_url, ''), nullif(p_deployment_exception, ''),
    nullif(p_deployed_url, '') is null
  ) returning * into v_submission;

  for v_file in select * from jsonb_array_elements(p_files) loop
    insert into public.submission_files (
      submission_uuid, file_kind, storage_path, original_name, content_type, size_bytes
    ) values (
      v_submission.id, v_file->>'kind', v_file->>'path', v_file->>'name',
      v_file->>'content_type', (v_file->>'size')::bigint
    );
  end loop;

  return query select v_submission.id, v_submission.reference, v_submission.submitted_at;
exception
  when unique_violation then
    raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
end;
$$;

revoke all on function public.submit_project(text, text, jsonb, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_project(text, text, jsonb, text, text, text, text, jsonb) to service_role;

create or replace function public.admin_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(actor_uuid, action, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(new.id::text, old.id::text),
    jsonb_build_object('new', case when tg_op <> 'DELETE' then to_jsonb(new) else null end,
                       'old', case when tg_op <> 'INSERT' then to_jsonb(old) else null end)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger event_settings_audit
after insert or update or delete on public.event_settings
for each row execute function public.admin_audit();

create trigger shortlist_audit
after insert or update or delete on public.shortlisted_teams
for each row execute function public.admin_audit();

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.admin_users enable row level security;
alter table public.event_settings enable row level security;
alter table public.evaluation_batches enable row level security;
alter table public.evaluation_jobs enable row level security;
alter table public.evaluation_evidence enable row level security;
alter table public.ai_evaluations enable row level security;
alter table public.evaluation_criteria enable row level security;
alter table public.leaderboards enable row level security;
alter table public.shortlisted_teams enable row level security;
alter table public.audit_logs enable row level security;

create policy "Admins can read teams" on public.teams for select to authenticated using (public.is_admin());
create policy "Organizers can import teams" on public.teams for insert to authenticated with check (public.has_any_role(array['admin', 'organizer']));
create policy "Organizers can update teams" on public.teams for update to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Organizers can delete teams" on public.teams for delete to authenticated using (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read team members" on public.team_members for select to authenticated using (public.is_admin());
create policy "Organizers manage team members" on public.team_members for all to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read submissions" on public.submissions for select to authenticated using (public.is_admin());
create policy "Organizers update submissions" on public.submissions for update to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Organizers delete submissions" on public.submissions for delete to authenticated using (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read submission files" on public.submission_files for select to authenticated using (public.is_admin());
create policy "Organizers manage submission files" on public.submission_files for all to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Users read own admin row" on public.admin_users for select to authenticated using (user_uuid = (select auth.uid()) or public.has_any_role(array['admin']));
create policy "Admins read event settings" on public.event_settings for select to authenticated using (public.is_admin());
create policy "Organizers update event settings" on public.event_settings for update to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read batches" on public.evaluation_batches for select to authenticated using (public.is_admin());
create policy "Admins read jobs" on public.evaluation_jobs for select to authenticated using (public.is_admin());
create policy "Admins read evidence" on public.evaluation_evidence for select to authenticated using (public.is_admin());
create policy "Admins read evaluations" on public.ai_evaluations for select to authenticated using (public.is_admin());
create policy "Admins read rubric" on public.evaluation_criteria for select to authenticated using (public.is_admin());
create policy "Admins read leaderboards" on public.leaderboards for select to authenticated using (public.is_admin());
create policy "Organizers manage leaderboards" on public.leaderboards for all to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read shortlists" on public.shortlisted_teams for select to authenticated using (public.is_admin());
create policy "Organizers manage shortlists" on public.shortlisted_teams for all to authenticated using (public.has_any_role(array['admin', 'organizer'])) with check (public.has_any_role(array['admin', 'organizer']));
create policy "Admins read audit logs" on public.audit_logs for select to authenticated using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-files',
  'submission-files',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create policy "Admins access private submission files"
on storage.objects for select to authenticated
using (bucket_id = 'submission-files' and public.is_admin());

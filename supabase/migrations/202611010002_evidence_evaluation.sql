alter table public.teams
  add column is_demo boolean not null default false;

alter table public.team_members
  add column is_demo boolean not null default false;

alter table public.submissions
  add column is_demo boolean not null default false;

alter table public.submission_files
  add column is_demo boolean not null default false;

alter table public.evaluation_batches
  add column is_demo boolean not null default false;

alter table public.evaluation_jobs
  add column is_demo boolean not null default false;

alter table public.evaluation_evidence
  add column is_demo boolean not null default false;

alter table public.ai_evaluations
  add column is_demo boolean not null default false;

alter table public.leaderboards
  add column is_demo boolean not null default false;

alter table public.shortlisted_teams
  add column is_demo boolean not null default false;

alter table public.evaluation_jobs
  add column progress_stage text not null default 'queued'
    check (progress_stage in (
      'queued',
      'reading_presentation',
      'analyzing_presentation',
      'inspecting_github',
      'analyzing_source',
      'checking_deployment',
      'cross_verifying',
      'calculating_score',
      'completed',
      'manual_review',
      'failed'
    ));

alter table public.shortlisted_teams
  drop constraint if exists shortlisted_teams_track_submission_uuid_key,
  drop constraint if exists shortlisted_teams_track_position_key,
  add constraint shortlisted_teams_demo_track_submission_unique unique (track, submission_uuid, is_demo),
  add constraint shortlisted_teams_demo_track_position_unique unique (track, position, is_demo);

create index teams_is_demo_idx on public.teams(is_demo);
create index team_members_is_demo_idx on public.team_members(is_demo);
create index submissions_is_demo_status_idx on public.submissions(is_demo, status);
create index submission_files_is_demo_idx on public.submission_files(is_demo);
create index evaluation_batches_is_demo_created_idx on public.evaluation_batches(is_demo, created_at desc);
create index evaluation_jobs_is_demo_idx on public.evaluation_jobs(is_demo, status);
create index evaluation_evidence_is_demo_idx on public.evaluation_evidence(is_demo, job_uuid);
create index ai_evaluations_is_demo_score_idx on public.ai_evaluations(is_demo, total_score desc);

alter policy "Admins can read teams" on public.teams
  using (public.is_admin());
alter policy "Organizers can import teams" on public.teams
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Organizers can update teams" on public.teams
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Organizers can delete teams" on public.teams
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Admins read team members" on public.team_members
  using (public.is_admin());
alter policy "Organizers manage team members" on public.team_members
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Admins read submissions" on public.submissions
  using (public.is_admin());
alter policy "Organizers update submissions" on public.submissions
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Organizers delete submissions" on public.submissions
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Admins read submission files" on public.submission_files
  using (public.is_admin());
alter policy "Organizers manage submission files" on public.submission_files
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Admins read batches" on public.evaluation_batches
  using (public.is_admin());
alter policy "Admins read jobs" on public.evaluation_jobs
  using (public.is_admin());
alter policy "Admins read evidence" on public.evaluation_evidence
  using (public.is_admin());
alter policy "Admins read evaluations" on public.ai_evaluations
  using (public.is_admin());
alter policy "Admins read leaderboards" on public.leaderboards
  using (public.is_admin());
alter policy "Organizers manage leaderboards" on public.leaderboards
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);
alter policy "Admins read shortlists" on public.shortlisted_teams
  using (public.is_admin());
alter policy "Organizers manage shortlists" on public.shortlisted_teams
  using (public.has_any_role(array['admin', 'organizer']) and not is_demo)
  with check (public.has_any_role(array['admin', 'organizer']) and not is_demo);

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
  where team_id = upper(trim(p_team_id)) and not is_demo
  for update;
  if not found then raise exception 'TEAM_NOT_FOUND' using errcode = 'P0001'; end if;

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
    demo_video_url, deployment_exception, manual_review, is_demo
  ) values (
    v_team.id, p_project_title, p_project_data, p_github_url, nullif(p_deployed_url, ''),
    nullif(p_demo_video_url, ''), nullif(p_deployment_exception, ''),
    nullif(p_deployed_url, '') is null, false
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

create table public.presentation_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_uuid uuid not null unique references public.submissions(id) on delete cascade,
  job_uuid uuid not null references public.evaluation_jobs(id) on delete cascade,
  extraction_status text not null check (extraction_status in ('completed', 'unavailable', 'failed')),
  parser text,
  extracted_text text not null default '',
  slide_count integer,
  analysis jsonb not null default '{}'::jsonb,
  missing_sections jsonb not null default '[]'::jsonb,
  unsupported_claims jsonb not null default '[]'::jsonb,
  contradictory_claims jsonb not null default '[]'::jsonb,
  manual_review boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slide_count is null or slide_count >= 0)
);

create table public.presentation_evidence (
  id uuid primary key default gen_random_uuid(),
  analysis_uuid uuid not null references public.presentation_analyses(id) on delete cascade,
  slide_number integer,
  category text not null,
  excerpt text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check (slide_number is null or slide_number > 0)
);

create table public.github_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_uuid uuid not null unique references public.submissions(id) on delete cascade,
  job_uuid uuid not null references public.evaluation_jobs(id) on delete cascade,
  repository_url text not null,
  accessible boolean not null,
  commit_sha text,
  languages jsonb not null default '{}'::jsonb,
  frameworks jsonb not null default '[]'::jsonb,
  architecture_observations jsonb not null default '[]'::jsonb,
  code_quality_score numeric(5,2),
  implementation_completeness numeric(5,2),
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  security_observations jsonb not null default '[]'::jsonb,
  missing_functionality jsonb not null default '[]'::jsonb,
  analysis jsonb not null default '{}'::jsonb,
  manual_review boolean not null default false,
  is_demo boolean not null default false,
  analyzed_at timestamptz not null default now(),
  check (code_quality_score is null or code_quality_score between 0 and 15),
  check (implementation_completeness is null or implementation_completeness between 0 and 100)
);

create index github_analyses_repository_idx on public.github_analyses(repository_url, analyzed_at desc);

create table public.repository_evidence (
  id uuid primary key default gen_random_uuid(),
  analysis_uuid uuid not null references public.github_analyses(id) on delete cascade,
  evidence_order integer not null default 0 check (evidence_order >= 0),
  file_path text not null,
  evidence_kind text not null,
  excerpt text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index repository_evidence_analysis_order_idx on public.repository_evidence(analysis_uuid, evidence_order);

create table public.evidence_consistency_checks (
  id uuid primary key default gen_random_uuid(),
  submission_uuid uuid not null references public.submissions(id) on delete cascade,
  job_uuid uuid not null references public.evaluation_jobs(id) on delete cascade,
  verified_claims jsonb not null default '[]'::jsonb,
  unsupported_claims jsonb not null default '[]'::jsonb,
  contradictions jsonb not null default '[]'::jsonb,
  unavailable_sources jsonb not null default '[]'::jsonb,
  manual_review boolean not null default false,
  is_demo boolean not null default false,
  checked_at timestamptz not null default now(),
  unique (submission_uuid, job_uuid)
);

create table public.evaluation_criterion_scores (
  id uuid primary key default gen_random_uuid(),
  evaluation_uuid uuid not null references public.ai_evaluations(id) on delete cascade,
  criterion_key text not null references public.evaluation_criteria(criterion_key),
  score numeric(5,2) not null check (score >= 0),
  maximum_score integer not null check (maximum_score > 0),
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  missing_information jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (evaluation_uuid, criterion_key),
  check (score <= maximum_score)
);

create table public.manual_review_resolutions (
  submission_uuid uuid primary key references public.submissions(id) on delete cascade,
  resolved_by uuid not null references auth.users(id),
  resolution text not null check (length(trim(resolution)) >= 8),
  resolved_at timestamptz not null default now()
);

create table public.final_rankings (
  id uuid primary key default gen_random_uuid(),
  track public.hackathon_track not null,
  submission_uuid uuid not null references public.submissions(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  status text not null default 'approved' check (status in ('recommended', 'approved')),
  decision_reason text not null check (length(trim(decision_reason)) >= 8),
  approved_by uuid references auth.users(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'recommended' and approved_by is null) or (status = 'approved' and approved_by is not null)),
  unique (track, position, is_demo),
  unique (track, submission_uuid, is_demo)
);

create index final_rankings_track_idx on public.final_rankings(track, position);

create or replace function public.create_real_evaluation_batch(p_created_by uuid)
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
  if exists (select 1 from public.evaluation_batches where status in ('queued', 'running') and not is_demo) then
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
  where s.status in ('submitted', 'failed') and not s.is_demo and not t.is_demo;

  v_total := jsonb_array_length(v_snapshot);
  if v_total = 0 then raise exception 'NO_ELIGIBLE_SUBMISSIONS' using errcode = 'P0001'; end if;

  insert into public.evaluation_batches(snapshot, total_jobs, queued_jobs, created_by, is_demo)
  values (v_snapshot, v_total, v_total, p_created_by, false)
  returning id into v_batch;

  insert into public.evaluation_jobs(batch_uuid, submission_uuid)
  select v_batch, s.id from public.submissions s
  join public.teams t on t.id = s.team_uuid
  where s.status in ('submitted', 'failed') and not s.is_demo and not t.is_demo;

  insert into public.audit_logs(actor_uuid, action, entity_type, entity_id, details)
  values (p_created_by, 'start_evaluation', 'evaluation_batch', v_batch::text,
    jsonb_build_object('frozen', true, 'total_jobs', v_total, 'demo_records_excluded', true));

  update public.submissions set status = 'queued'
  where status in ('submitted', 'failed') and not is_demo
    and team_uuid in (select id from public.teams where not is_demo);
  return v_batch;
end;
$$;
revoke all on function public.create_real_evaluation_batch(uuid) from public, anon, authenticated;
grant execute on function public.create_real_evaluation_batch(uuid) to service_role;

create or replace function public.claim_evaluation_job(p_batch uuid)
returns setof public.evaluation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.evaluation_jobs%rowtype;
begin
  select j.* into v_job
  from public.evaluation_jobs j
  join public.evaluation_batches b on b.id = j.batch_uuid
  join public.submissions s on s.id = j.submission_uuid
  join public.teams t on t.id = s.team_uuid
  where j.batch_uuid = p_batch and j.status = 'queued'
    and not b.is_demo and not j.is_demo and not s.is_demo and not t.is_demo
  order by j.created_at
  for update of j skip locked
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
  where id = p_batch and not is_demo;
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
  v_batch uuid;
  v_track public.hackathon_track;
  v_failed boolean := p_result ? 'error';
begin
  select j.submission_uuid, j.batch_uuid, t.track
    into v_submission, v_batch, v_track
  from public.evaluation_jobs j
  join public.evaluation_batches b on b.id = j.batch_uuid
  join public.submissions s on s.id = j.submission_uuid
  join public.teams t on t.id = s.team_uuid
  where j.id = p_job and j.status = 'processing'
    and not b.is_demo and not j.is_demo and not s.is_demo and not t.is_demo
  for update of j;
  if not found then raise exception 'REAL_PROCESSING_JOB_NOT_FOUND'; end if;

  if v_failed then
    update public.evaluation_jobs
      set status = 'failed', progress_stage = 'failed',
          error_message = left(p_result->>'error', 1000), completed_at = now()
      where id = p_job;
    update public.submissions set status = 'failed' where id = v_submission and not is_demo;
    update public.evaluation_batches set
      processing_jobs = greatest(processing_jobs - 1, 0),
      failed_jobs = failed_jobs + 1,
      status = case when queued_jobs = 0 and processing_jobs <= 1 then 'completed_with_errors' else 'running' end,
      completed_at = case when queued_jobs = 0 and processing_jobs <= 1 then now() else null end
    where id = v_batch and not is_demo;
    return;
  end if;

  insert into public.ai_evaluations (
    submission_uuid, job_uuid, total_score, criteria, strengths, weaknesses,
    innovation_assessment, technical_assessment, github_assessment,
    deployment_assessment, missing_information, confidence, manual_review, is_demo
  ) values (
    v_submission, p_job, (p_result->>'total_score')::numeric,
    p_result->'criteria', p_result->'strengths', p_result->'weaknesses',
    p_result->>'innovation_assessment', p_result->>'technical_assessment',
    p_result->>'github_assessment', p_result->>'deployment_assessment',
    p_result->'missing_information', p_result->>'confidence',
    coalesce((p_result->>'manual_review')::boolean, false), false
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
    is_demo = false,
    evaluated_at = now()
  where not public.ai_evaluations.is_demo;

  insert into public.evaluation_evidence(job_uuid, source, evidence, is_demo)
  select p_job, item->>'source', item->'evidence', false
  from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) item;

  update public.evaluation_jobs
    set status = 'completed', progress_stage = 'completed', completed_at = now()
    where id = p_job;
  update public.submissions set status = 'evaluated' where id = v_submission and not is_demo;
  update public.evaluation_batches set
    processing_jobs = greatest(processing_jobs - 1, 0),
    completed_jobs = completed_jobs + 1,
    status = case when queued_jobs = 0 and processing_jobs <= 1
      then case when failed_jobs > 0 then 'completed_with_errors' else 'completed' end
      else 'running' end,
    completed_at = case when queued_jobs = 0 and processing_jobs <= 1 then now() else null end
  where id = v_batch and not is_demo;

  insert into public.leaderboards(track, submission_uuid, rank, score, is_demo)
  values (v_track, v_submission, 1, (p_result->>'total_score')::numeric, false)
  on conflict (track, submission_uuid) do update
    set score = excluded.score, calculated_at = now(), is_demo = false
    where not public.leaderboards.is_demo;

  with ordered as (
    select l.id, row_number() over (
      partition by l.track order by l.score desc, s.submitted_at asc, t.team_id asc
    )::integer as new_rank
    from public.leaderboards l
    join public.submissions s on s.id = l.submission_uuid
    join public.teams t on t.id = s.team_uuid
    where l.track = v_track and not l.is_demo and not s.is_demo and not t.is_demo
  )
  update public.leaderboards l set rank = ordered.new_rank
  from ordered where ordered.id = l.id;
end;
$$;
revoke all on function public.finish_evaluation_job(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finish_evaluation_job(uuid, jsonb, jsonb) to service_role;

alter table public.presentation_analyses enable row level security;
alter table public.presentation_evidence enable row level security;
alter table public.github_analyses enable row level security;
alter table public.repository_evidence enable row level security;
alter table public.evidence_consistency_checks enable row level security;
alter table public.evaluation_criterion_scores enable row level security;
alter table public.manual_review_resolutions enable row level security;
alter table public.final_rankings enable row level security;

grant select on public.presentation_analyses, public.presentation_evidence,
  public.github_analyses, public.repository_evidence,
  public.evidence_consistency_checks, public.evaluation_criterion_scores,
  public.manual_review_resolutions, public.final_rankings to authenticated;
grant all on public.presentation_analyses, public.presentation_evidence,
  public.github_analyses, public.repository_evidence,
  public.evidence_consistency_checks, public.evaluation_criterion_scores,
  public.manual_review_resolutions, public.final_rankings to service_role;

create policy "Admins read presentation analyses"
  on public.presentation_analyses for select to authenticated using (public.is_admin());
create policy "Admins read presentation evidence"
  on public.presentation_evidence for select to authenticated using (public.is_admin());
create policy "Admins read GitHub analyses"
  on public.github_analyses for select to authenticated using (public.is_admin());
create policy "Admins read repository evidence"
  on public.repository_evidence for select to authenticated using (public.is_admin());
create policy "Admins read evidence consistency checks"
  on public.evidence_consistency_checks for select to authenticated using (public.is_admin());
create policy "Admins read criterion scores"
  on public.evaluation_criterion_scores for select to authenticated using (public.is_admin());
create policy "Admins read manual review resolutions"
  on public.manual_review_resolutions for select to authenticated using (public.is_admin());
create policy "Admins read final rankings"
  on public.final_rankings for select to authenticated using (public.is_admin());

create or replace function public.update_evaluation_job_stage(p_job uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_stage not in (
    'reading_presentation', 'analyzing_presentation', 'inspecting_github',
    'analyzing_source', 'checking_deployment', 'cross_verifying',
    'calculating_score', 'manual_review', 'completed', 'failed'
  ) then
    raise exception 'INVALID_EVALUATION_STAGE';
  end if;
  update public.evaluation_jobs set progress_stage = p_stage
  where id = p_job and status = 'processing' and not is_demo
    and batch_uuid in (select id from public.evaluation_batches where not is_demo);
  if not found then raise exception 'PROCESSING_JOB_NOT_FOUND'; end if;
end;
$$;
revoke all on function public.update_evaluation_job_stage(uuid, text) from public, anon, authenticated;
grant execute on function public.update_evaluation_job_stage(uuid, text) to service_role;

create or replace function public.resolve_manual_review(p_submission uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_any_role(array['admin', 'organizer']) then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if length(trim(coalesce(p_resolution, ''))) < 8 then raise exception 'REVIEW_RESOLUTION_REQUIRED'; end if;
  if not exists (
    select 1 from public.ai_evaluations e
    where e.submission_uuid = p_submission and not e.is_demo and e.manual_review
  ) then raise exception 'MANUAL_REVIEW_NOT_REQUIRED'; end if;
  insert into public.manual_review_resolutions(submission_uuid, resolved_by, resolution)
  values (p_submission, auth.uid(), trim(p_resolution))
  on conflict (submission_uuid) do update
    set resolved_by = excluded.resolved_by, resolution = excluded.resolution, resolved_at = now();
  insert into public.audit_logs(actor_uuid, action, entity_type, entity_id, details)
  values (auth.uid(), 'resolve_manual_review', 'submission', p_submission::text,
    jsonb_build_object('resolution', trim(p_resolution)));
end;
$$;
revoke all on function public.resolve_manual_review(uuid, text) from public, anon;
grant execute on function public.resolve_manual_review(uuid, text) to authenticated;

create or replace function public.complete_evidence_evaluation(
  p_job uuid,
  p_result jsonb,
  p_evidence jsonb,
  p_presentation jsonb,
  p_github jsonb,
  p_consistency jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission uuid;
  v_presentation_analysis uuid;
  v_github_analysis uuid;
  v_evaluation uuid;
  v_demo boolean;
  v_item jsonb;
  v_evidence_order integer := 0;
begin
  select j.submission_uuid, s.is_demo or t.is_demo or j.is_demo or b.is_demo
    into v_submission, v_demo
  from public.evaluation_jobs j
  join public.evaluation_batches b on b.id = j.batch_uuid
  join public.submissions s on s.id = j.submission_uuid
  join public.teams t on t.id = s.team_uuid
  where j.id = p_job and j.status = 'processing'
  for update of j;
  if not found then raise exception 'PROCESSING_JOB_NOT_FOUND'; end if;
  if v_demo then raise exception 'DEMO_EVALUATIONS_CANNOT_BE_PUBLISHED'; end if;

  insert into public.presentation_analyses(
    submission_uuid, job_uuid, extraction_status, parser, extracted_text,
    slide_count, analysis, missing_sections, unsupported_claims,
    contradictory_claims, manual_review, is_demo
  ) values (
    v_submission, p_job, p_presentation->>'extraction_status',
    nullif(p_presentation->>'parser', ''), coalesce(p_presentation->>'extracted_text', ''),
    nullif(p_presentation->>'slide_count', '')::integer,
    coalesce(p_presentation->'analysis', '{}'::jsonb),
    coalesce(p_presentation->'missing_sections', '[]'::jsonb),
    coalesce(p_presentation->'unsupported_claims', '[]'::jsonb),
    coalesce(p_presentation->'contradictory_claims', '[]'::jsonb),
    coalesce((p_presentation->>'manual_review')::boolean, false), false
  )
  on conflict (submission_uuid) do update set
    job_uuid = excluded.job_uuid, extraction_status = excluded.extraction_status,
    parser = excluded.parser, extracted_text = excluded.extracted_text,
    slide_count = excluded.slide_count, analysis = excluded.analysis,
    missing_sections = excluded.missing_sections,
    unsupported_claims = excluded.unsupported_claims,
    contradictory_claims = excluded.contradictory_claims,
    manual_review = excluded.manual_review, updated_at = now()
  returning id into v_presentation_analysis;

  delete from public.presentation_evidence where analysis_uuid = v_presentation_analysis;
  for v_item in select value from jsonb_array_elements(coalesce(p_presentation->'evidence', '[]'::jsonb)) loop
    insert into public.presentation_evidence(analysis_uuid, slide_number, category, excerpt)
    values (
      v_presentation_analysis,
      nullif(v_item->>'slide_number', '')::integer,
      coalesce(v_item->>'category', 'presentation'),
      left(coalesce(v_item->>'excerpt', ''), 2000)
    );
  end loop;

  insert into public.github_analyses(
    submission_uuid, job_uuid, repository_url, accessible, commit_sha,
    languages, frameworks, architecture_observations, code_quality_score,
    implementation_completeness, strengths, weaknesses, security_observations,
    missing_functionality, analysis, manual_review, is_demo
  ) values (
    v_submission, p_job, coalesce(p_github->>'repository_url', ''),
    coalesce((p_github->>'accessible')::boolean, false),
    nullif(p_github->>'commit_sha', ''),
    coalesce(p_github->'languages', '{}'::jsonb),
    coalesce(p_github->'frameworks', '[]'::jsonb),
    coalesce(p_github->'architecture_observations', '[]'::jsonb),
    nullif(p_github->>'code_quality_score', '')::numeric,
    nullif(p_github->>'implementation_completeness', '')::numeric,
    coalesce(p_github->'strengths', '[]'::jsonb),
    coalesce(p_github->'weaknesses', '[]'::jsonb),
    coalesce(p_github->'security_observations', '[]'::jsonb),
    coalesce(p_github->'missing_functionality', '[]'::jsonb),
    coalesce(p_github->'analysis', '{}'::jsonb),
    coalesce((p_github->>'manual_review')::boolean, false), false
  )
  on conflict (submission_uuid) do update set
    job_uuid = excluded.job_uuid, repository_url = excluded.repository_url,
    accessible = excluded.accessible, commit_sha = excluded.commit_sha,
    languages = excluded.languages, frameworks = excluded.frameworks,
    architecture_observations = excluded.architecture_observations,
    code_quality_score = excluded.code_quality_score,
    implementation_completeness = excluded.implementation_completeness,
    strengths = excluded.strengths, weaknesses = excluded.weaknesses,
    security_observations = excluded.security_observations,
    missing_functionality = excluded.missing_functionality,
    analysis = excluded.analysis, manual_review = excluded.manual_review,
    analyzed_at = now()
  returning id into v_github_analysis;

  delete from public.repository_evidence where analysis_uuid = v_github_analysis;
  v_evidence_order := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_github->'evidence', '[]'::jsonb)) loop
    v_evidence_order := v_evidence_order + 1;
    insert into public.repository_evidence(analysis_uuid, evidence_order, file_path, evidence_kind, excerpt)
    values (
      v_github_analysis, v_evidence_order, coalesce(v_item->>'file_path', 'repository metadata'),
      coalesce(v_item->>'evidence_kind', 'source'),
      left(coalesce(v_item->>'excerpt', ''), 2000)
    );
  end loop;

  insert into public.evidence_consistency_checks(
    submission_uuid, job_uuid, verified_claims, unsupported_claims,
    contradictions, unavailable_sources, manual_review, is_demo
  ) values (
    v_submission, p_job,
    coalesce(p_consistency->'verified_claims', '[]'::jsonb),
    coalesce(p_consistency->'unsupported_claims', '[]'::jsonb),
    coalesce(p_consistency->'contradictions', '[]'::jsonb),
    coalesce(p_consistency->'unavailable_sources', '[]'::jsonb),
    coalesce((p_consistency->>'manual_review')::boolean, false), false
  )
  on conflict (submission_uuid, job_uuid) do update set
    verified_claims = excluded.verified_claims,
    unsupported_claims = excluded.unsupported_claims,
    contradictions = excluded.contradictions,
    unavailable_sources = excluded.unavailable_sources,
    manual_review = excluded.manual_review, checked_at = now();

  update public.evaluation_jobs set progress_stage =
    case when coalesce((p_result->>'manual_review')::boolean, false) then 'manual_review' else 'completed' end
  where id = p_job;
  perform public.finish_evaluation_job(p_job, p_result, p_evidence);

  select id into v_evaluation from public.ai_evaluations where submission_uuid = v_submission;
  for v_item in
    select jsonb_build_object('key', key, 'value', value)
    from jsonb_each(p_result->'criteria') as criteria(key, value)
  loop
    insert into public.evaluation_criterion_scores(
      evaluation_uuid, criterion_key, score, maximum_score, reason,
      evidence, missing_information, confidence, is_demo
    )
    select v_evaluation, v_item->>'key',
      (v_item->'value'->>'score')::numeric, c.maximum_score,
      coalesce(v_item->'value'->>'explanation', ''),
      coalesce(v_item->'value'->'evidence', '[]'::jsonb),
      coalesce(v_item->'value'->'missing_evidence', '[]'::jsonb),
      coalesce(p_result->>'confidence', 'low'), false
    from public.evaluation_criteria c where c.criterion_key = v_item->>'key'
    on conflict (evaluation_uuid, criterion_key) do update set
      score = excluded.score, maximum_score = excluded.maximum_score,
      reason = excluded.reason, evidence = excluded.evidence,
      missing_information = excluded.missing_information,
      confidence = excluded.confidence, is_demo = false;
  end loop;
end;
$$;
revoke all on function public.complete_evidence_evaluation(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_evidence_evaluation(uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.approve_track_top_five(p_track public.hackathon_track, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_submission uuid;
  v_position integer := 0;
  v_count integer := 0;
begin
  if not public.has_any_role(array['admin', 'organizer']) then raise exception 'ADMIN_ACCESS_REQUIRED'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5 then
    raise exception 'FINAL_RANKINGS_INVALID';
  end if;
  if exists (
    select 1 from public.submissions s
    join public.teams t on t.id = s.team_uuid
    where t.track = p_track and not s.is_demo and not t.is_demo
      and (s.status <> 'evaluated' or not exists (
        select 1 from public.ai_evaluations e where e.submission_uuid = s.id and not e.is_demo
      ))
  ) then raise exception 'TRACK_HAS_UNEVALUATED_SUBMISSIONS'; end if;
  if exists (
    select 1 from public.ai_evaluations e
    join public.submissions s on s.id = e.submission_uuid
    join public.teams t on t.id = s.team_uuid
    where t.track = p_track and not e.is_demo and e.manual_review
      and not s.is_demo and not t.is_demo
      and not exists (select 1 from public.manual_review_resolutions r where r.submission_uuid = s.id)
  ) then raise exception 'TRACK_HAS_UNRESOLVED_MANUAL_REVIEWS'; end if;

  delete from public.final_rankings where track = p_track and not is_demo;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_position := v_position + 1;
    v_submission := (v_row->>'submission_uuid')::uuid;
    if length(trim(coalesce(v_row->>'decision_reason', ''))) < 8 then
      raise exception 'FINAL_RANKING_REASON_REQUIRED';
    end if;
    if not exists (
      select 1 from public.submissions s
      join public.teams t on t.id = s.team_uuid
      join public.ai_evaluations e on e.submission_uuid = s.id
      where s.id = v_submission and t.track = p_track
        and not s.is_demo and not t.is_demo and not e.is_demo and s.status = 'evaluated'
    ) then raise exception 'FINAL_RANKING_SUBMISSION_INVALID'; end if;
    insert into public.final_rankings(
      track, submission_uuid, position, status, decision_reason, approved_by, is_demo
    ) values (
      p_track, v_submission, v_position, 'approved',
      trim(v_row->>'decision_reason'), auth.uid(), false
    );
    v_count := v_count + 1;
  end loop;
  insert into public.audit_logs(actor_uuid, action, entity_type, details)
  values (auth.uid(), 'approve_final_top_five', 'final_rankings',
    jsonb_build_object('track', p_track, 'count', v_count, 'rankings', p_rows));
  return v_count;
end;
$$;
revoke all on function public.approve_track_top_five(public.hackathon_track, jsonb) from public, anon;
grant execute on function public.approve_track_top_five(public.hackathon_track, jsonb) to authenticated;

create table public.ai_workers (
  worker_id uuid primary key,
  display_name text not null,
  status text not null check (status in ('idle', 'processing', 'error', 'offline')),
  ollama_connected boolean not null default false,
  model_available boolean not null default false,
  model_name text not null,
  current_job_uuid uuid references public.evaluation_jobs(id) on delete set null,
  last_error text,
  last_heartbeat timestamptz not null default now(),
  worker_version text,
  updated_at timestamptz not null default now()
);

alter table public.ai_workers enable row level security;
revoke all on public.ai_workers from anon, authenticated;
grant select on public.ai_workers to authenticated;
grant all on public.ai_workers to service_role;
create policy "Admins can read AI worker status"
  on public.ai_workers for select to authenticated using (public.is_admin());

alter table public.evaluation_jobs
  add column worker_id uuid references public.ai_workers(worker_id) on delete set null,
  add column lease_expires_at timestamptz;

alter table public.evaluation_batches
  add column paused boolean not null default false;

create index evaluation_jobs_lease_idx
  on public.evaluation_jobs(status, lease_expires_at)
  where status = 'processing';

create table public.worker_evaluation_contexts (
  job_uuid uuid primary key references public.evaluation_jobs(id) on delete cascade,
  worker_id uuid not null references public.ai_workers(worker_id) on delete cascade,
  context jsonb not null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now()
);
alter table public.worker_evaluation_contexts enable row level security;
revoke all on public.worker_evaluation_contexts from anon, authenticated;
grant all on public.worker_evaluation_contexts to service_role;
create index worker_evaluation_contexts_expiry_idx
  on public.worker_evaluation_contexts(expires_at);

create or replace function public.claim_local_evaluation_job(
  p_worker uuid,
  p_lease_seconds integer default 600
)
returns setof public.evaluation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker public.ai_workers%rowtype;
  v_job public.evaluation_jobs%rowtype;
  v_expired record;
begin
  select * into v_worker from public.ai_workers
  where worker_id = p_worker
  for update;
  if not found or v_worker.last_heartbeat < now() - interval '90 seconds'
    or not v_worker.ollama_connected or not v_worker.model_available then
    raise exception 'WORKER_NOT_READY';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'INVALID_JOB_LEASE';
  end if;

  for v_expired in
    select id, batch_uuid, submission_uuid, attempts
    from public.evaluation_jobs
    where status = 'processing' and lease_expires_at <= now() and not is_demo
    for update skip locked
  loop
    delete from public.worker_evaluation_contexts where job_uuid = v_expired.id;
    if v_expired.attempts >= 4 then
      update public.evaluation_jobs
      set status = 'failed', progress_stage = 'failed',
          error_message = 'Worker lease expired after maximum attempts.',
          lease_expires_at = null, worker_id = null, completed_at = now()
      where id = v_expired.id;
      update public.submissions set status = 'failed' where id = v_expired.submission_uuid;
      update public.evaluation_batches set
        processing_jobs = greatest(processing_jobs - 1, 0),
        failed_jobs = failed_jobs + 1
      where id = v_expired.batch_uuid;
    else
      update public.evaluation_jobs
      set status = 'queued', progress_stage = 'queued',
          error_message = 'Previous worker lease expired; job was requeued.',
          lease_expires_at = null, worker_id = null, started_at = null
      where id = v_expired.id;
      update public.submissions set status = 'queued' where id = v_expired.submission_uuid;
      update public.evaluation_batches set
        processing_jobs = greatest(processing_jobs - 1, 0),
        queued_jobs = queued_jobs + 1
      where id = v_expired.batch_uuid;
    end if;
  end loop;
  update public.evaluation_batches b set
    status = case when b.failed_jobs > 0 then 'completed_with_errors' else 'completed' end,
    completed_at = coalesce(b.completed_at, now())
  where not b.is_demo and b.queued_jobs = 0 and b.processing_jobs = 0
    and b.status = 'running';

  if exists (
    select 1 from public.evaluation_jobs
    where worker_id = p_worker and status = 'processing'
      and lease_expires_at > now() and not is_demo
  ) then
    return;
  end if;

  select j.* into v_job
  from public.evaluation_jobs j
  join public.evaluation_batches b on b.id = j.batch_uuid
  where j.status = 'queued' and not j.is_demo and not b.is_demo and not b.paused
  order by j.created_at
  for update of j skip locked
  limit 1;
  if not found then return; end if;

  update public.evaluation_jobs
  set status = 'processing', attempts = attempts + 1,
      started_at = now(), worker_id = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      error_message = null
  where id = v_job.id
  returning * into v_job;

  update public.submissions set status = 'evaluating' where id = v_job.submission_uuid;
  update public.evaluation_batches set
    status = 'running',
    queued_jobs = greatest(queued_jobs - 1, 0),
    processing_jobs = processing_jobs + 1
  where id = v_job.batch_uuid;
  update public.ai_workers set
    status = 'processing', current_job_uuid = v_job.id, last_error = null,
    last_heartbeat = now(), updated_at = now()
  where worker_id = p_worker;
  return next v_job;
end;
$$;
revoke all on function public.claim_local_evaluation_job(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_local_evaluation_job(uuid, integer) to service_role;

create or replace function public.renew_local_evaluation_lease(
  p_worker uuid,
  p_job uuid,
  p_lease_seconds integer default 600
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expiry timestamptz;
begin
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'INVALID_JOB_LEASE';
  end if;
  update public.evaluation_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job and worker_id = p_worker
    and status = 'processing' and lease_expires_at > now()
  returning lease_expires_at into v_expiry;
  if not found then raise exception 'WORKER_JOB_LEASE_LOST'; end if;
  update public.ai_workers set last_heartbeat = now(), updated_at = now()
  where worker_id = p_worker;
  update public.worker_evaluation_contexts
  set expires_at = now() + interval '30 minutes'
  where job_uuid = p_job and worker_id = p_worker;
  return v_expiry;
end;
$$;
revoke all on function public.renew_local_evaluation_lease(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.renew_local_evaluation_lease(uuid, uuid, integer) to service_role;

create or replace function public.update_local_evaluation_progress(
  p_worker uuid,
  p_job uuid,
  p_stage text,
  p_lease_seconds integer default 600
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds < 60 or p_lease_seconds > 1800 then
    raise exception 'INVALID_JOB_LEASE';
  end if;
  if p_stage not in (
    'reading_presentation', 'analyzing_presentation', 'inspecting_github',
    'analyzing_source', 'checking_deployment', 'cross_verifying',
    'calculating_score', 'manual_review'
  ) then
    raise exception 'INVALID_EVALUATION_STAGE';
  end if;
  update public.evaluation_jobs
  set progress_stage = p_stage,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_job and worker_id = p_worker
    and status = 'processing' and lease_expires_at > now();
  if not found then raise exception 'WORKER_JOB_LEASE_LOST'; end if;
  update public.ai_workers set
    status = 'processing', current_job_uuid = p_job,
    last_heartbeat = now(), updated_at = now()
  where worker_id = p_worker;
  update public.worker_evaluation_contexts
  set expires_at = now() + interval '30 minutes'
  where job_uuid = p_job and worker_id = p_worker;
end;
$$;
revoke all on function public.update_local_evaluation_progress(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.update_local_evaluation_progress(uuid, uuid, text, integer) to service_role;

create or replace function public.complete_local_evidence_evaluation(
  p_worker uuid,
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
begin
  perform 1 from public.evaluation_jobs
  where id = p_job and worker_id = p_worker
    and status = 'processing' and lease_expires_at > now()
  for update;
  if not found then raise exception 'WORKER_JOB_LEASE_LOST'; end if;
  perform public.complete_evidence_evaluation(
    p_job, p_result, p_evidence, p_presentation, p_github, p_consistency
  );
  delete from public.worker_evaluation_contexts where job_uuid = p_job;
  update public.evaluation_jobs set worker_id = null, lease_expires_at = null
  where id = p_job;
  update public.ai_workers set
    status = 'idle', current_job_uuid = null, last_error = null,
    last_heartbeat = now(), updated_at = now()
  where worker_id = p_worker;
end;
$$;
revoke all on function public.complete_local_evidence_evaluation(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.complete_local_evidence_evaluation(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.fail_local_evaluation_job(
  p_worker uuid,
  p_job uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.evaluation_jobs
  where id = p_job and worker_id = p_worker
    and status = 'processing' and lease_expires_at > now()
  for update;
  if not found then raise exception 'WORKER_JOB_LEASE_LOST'; end if;
  perform public.finish_evaluation_job(
    p_job, jsonb_build_object('error', left(coalesce(p_error, 'Worker evaluation failed.'), 1000)), '[]'::jsonb
  );
  delete from public.worker_evaluation_contexts where job_uuid = p_job;
  update public.evaluation_jobs set worker_id = null, lease_expires_at = null
  where id = p_job;
  update public.ai_workers set
    status = 'error', current_job_uuid = null,
    last_error = left(coalesce(p_error, 'Worker evaluation failed.'), 1000),
    last_heartbeat = now(), updated_at = now()
  where worker_id = p_worker;
end;
$$;
revoke all on function public.fail_local_evaluation_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_local_evaluation_job(uuid, uuid, text) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'ai_workers'
    ) then
    alter publication supabase_realtime add table public.ai_workers;
  end if;
end;
$$;

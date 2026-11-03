create or replace function public.stage_recommended_top_five(p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_track public.hackathon_track;
  v_submission record;
  v_position integer;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.admin_users
    where user_uuid = p_actor and role in ('admin', 'organizer')
  ) then
    raise exception 'ORGANIZER_ACCESS_REQUIRED';
  end if;

  if exists (
    select 1 from public.evaluation_jobs
    where status in ('queued', 'processing') and not is_demo
  ) then
    raise exception 'EVALUATIONS_STILL_RUNNING';
  end if;

  if exists (
    select 1 from public.ai_evaluations e
    join public.submissions s on s.id = e.submission_uuid
    join public.teams t on t.id = s.team_uuid
    where not e.is_demo and not s.is_demo and not t.is_demo
      and e.manual_review
      and not exists (
        select 1 from public.manual_review_resolutions r
        where r.submission_uuid = s.id
      )
  ) then
    raise exception 'UNRESOLVED_MANUAL_REVIEWS';
  end if;

  if exists (
    select 1 from public.final_rankings
    where status = 'approved' and not is_demo
  ) then
    raise exception 'FINAL_RANKINGS_ALREADY_APPROVED';
  end if;

  delete from public.final_rankings
  where status = 'recommended' and not is_demo;

  for v_track in
    select unnest(enum_range(null::public.hackathon_track))
  loop
    v_position := 0;
    for v_submission in
      select s.id, l.score
      from public.leaderboards l
      join public.submissions s on s.id = l.submission_uuid
      join public.teams t on t.id = s.team_uuid
      join public.ai_evaluations e on e.submission_uuid = s.id
      where l.track = v_track and s.status = 'evaluated'
        and not l.is_demo and not s.is_demo and not t.is_demo and not e.is_demo
      order by l.score desc, s.submitted_at asc, t.team_id asc
      limit 5
    loop
      v_position := v_position + 1;
      insert into public.final_rankings(
        track, submission_uuid, position, status, decision_reason, approved_by, is_demo
      ) values (
        v_track, v_submission.id, v_position, 'recommended',
        format('Provisional local AI evidence-based score: %s/100. Organizer approval is required.', v_submission.score),
        null, false
      );
      v_count := v_count + 1;
    end loop;
  end loop;

  insert into public.audit_logs(actor_uuid, action, entity_type, details)
  values (
    p_actor,     'stage_local_ai_top_five_recommendations', 'final_rankings',
    jsonb_build_object('count', v_count, 'requires_human_approval', true)
  );
  return v_count;
end;
$$;

revoke all on function public.stage_recommended_top_five(uuid) from public, anon, authenticated;
grant execute on function public.stage_recommended_top_five(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evaluation_batches'
    ) then
      alter publication supabase_realtime add table public.evaluation_batches;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evaluation_jobs'
    ) then
      alter publication supabase_realtime add table public.evaluation_jobs;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leaderboards'
    ) then
      alter publication supabase_realtime add table public.leaderboards;
    end if;
  end if;
end;
$$;

-- DEMO-ONLY fixture data. Apply only after both schema migrations.
-- Every row is tagged is_demo=true and excluded from participant, batch, and real leaderboard queries.
-- All project/repository claims below are synthetic; no repository or deployment is represented as verified.
do $$
declare
  v_batch uuid;
begin
  if exists (
    select 1 from public.teams
    where team_id between 'ZYL900001' and 'ZYL900040' and not is_demo
  ) then
    raise exception 'Demo team ID range overlaps real teams; no demo rows were inserted.';
  end if;

  insert into public.teams(team_id, team_name, team_leader, college, branch, track, is_demo)
  select
    'ZYL' || lpad((900000 + n)::text, 6, '0'),
    'Demo Team ' || lpad((900000 + n)::text, 6, '0'),
    'Demo Leader ' || lpad(n::text, 2, '0'),
    'Fictional Demo College ' || ((n - 1) % 8 + 1)::text,
    (array['Computer Science', 'Information Technology', 'Design', 'Business'])[((n - 1) % 4) + 1],
    (array['Education / EdTech', 'AI Innovation', 'Healthcare', 'Business'])[((n - 1) % 4) + 1]::public.hackathon_track,
    true
  from generate_series(1, 40) as n
  on conflict (team_id) do nothing;

  insert into public.team_members(team_uuid, full_name, member_role, is_demo)
  select t.id, member_name, member_role, true
  from public.teams t
  cross join lateral (
    select 'Demo Leader ' || right(t.team_id, 2) as member_name, 'Team leader' as member_role, 0 as member_number
    union all
    select 'Demo Collaborator ' || right(t.team_id, 2) || chr(64 + member_number), 'Team member', member_number
    from generate_series(1, 1 + (right(t.team_id, 2)::integer % 3)) as member_number
  ) members
  where t.is_demo and t.team_id between 'ZYL900001' and 'ZYL900040'
  on conflict do nothing;

  update public.team_members set is_demo = true
  where team_uuid in (
    select id from public.teams
    where is_demo and team_id between 'ZYL900001' and 'ZYL900040'
  );

  insert into public.submissions(
    team_uuid, project_title, project_data, github_url, deployed_url,
    manual_review, status, is_demo
  )
  select
    t.id,
    'DEMO ONLY: Project ' || right(t.team_id, 6),
    jsonb_build_object(
      'problem_statement', 'DEMO ONLY: Synthetic problem statement for previewing organizer screens.',
      'proposed_solution', 'DEMO ONLY: Synthetic project description; no real implementation evidence.',
      'technologies', '[]'::jsonb,
      'demo_fixture', true,
      'notice', 'Synthetic demo record. Not a real participant submission.'
    ),
    'https://github.com',
    null,
    true,
    'evaluated',
    true
  from public.teams t
  where t.is_demo and t.team_id between 'ZYL900001' and 'ZYL900040'
  on conflict (team_uuid) do nothing;

  select b.id into v_batch
  from public.evaluation_batches b
  where b.is_demo and b.status = 'completed'
  order by b.created_at desc
  limit 1;

  if v_batch is null then
    insert into public.evaluation_batches(
      status, snapshot, total_jobs, queued_jobs, processing_jobs,
      completed_jobs, failed_jobs, is_demo, completed_at
    ) values ('completed', '[]'::jsonb, 40, 0, 0, 40, 0, true, now())
    returning id into v_batch;
  end if;

  insert into public.evaluation_jobs(
    batch_uuid, submission_uuid, status, progress_stage, attempts, started_at, completed_at, is_demo
  )
  select v_batch, s.id, 'completed', 'completed', 1, now(), now(), true
  from public.submissions s
  join public.teams t on t.id = s.team_uuid
  where s.is_demo and t.is_demo and t.team_id between 'ZYL900001' and 'ZYL900040'
  on conflict (batch_uuid, submission_uuid) do nothing;

  update public.evaluation_batches b
  set total_jobs = (select count(*) from public.evaluation_jobs j where j.batch_uuid = b.id and j.is_demo),
      queued_jobs = 0,
      processing_jobs = 0,
      completed_jobs = (select count(*) from public.evaluation_jobs j where j.batch_uuid = b.id and j.is_demo and j.status = 'completed'),
      failed_jobs = 0,
      status = 'completed',
      completed_at = coalesce(b.completed_at, now())
  where b.id = v_batch and b.is_demo;

  with scores as (
    select
      s.id as submission_uuid,
      j.id as job_uuid,
      t.track,
      t.team_id,
      (12 + right(t.team_id, 2)::integer % 9) as innovation,
      (12 + right(t.team_id, 2)::integer * 3 % 9) as technical_implementation,
      (8 + right(t.team_id, 2)::integer * 7 % 8) as github_code_quality,
      (9 + right(t.team_id, 2)::integer * 4 % 7) as problem_solving,
      (5 + right(t.team_id, 2)::integer * 3 % 6) as real_world_impact,
      (5 + right(t.team_id, 2)::integer * 5 % 6) as ui_ux,
      (5 + right(t.team_id, 2)::integer * 2 % 6) as documentation
    from public.submissions s
    join public.teams t on t.id = s.team_uuid
    join public.evaluation_jobs j on j.submission_uuid = s.id and j.batch_uuid = v_batch
    where s.is_demo and t.is_demo
  ), evaluations as (
    select *,
      innovation + technical_implementation + github_code_quality + problem_solving
        + real_world_impact + ui_ux + documentation as total
    from scores
  )
  insert into public.ai_evaluations(
    submission_uuid, job_uuid, total_score, criteria, strengths, weaknesses,
    innovation_assessment, technical_assessment, github_assessment,
    deployment_assessment, missing_information, confidence, manual_review, is_demo
  )
  select
    submission_uuid,
    job_uuid,
    total,
    jsonb_build_object(
      'innovation', jsonb_build_object('score', innovation, 'explanation', 'DEMO ONLY: Synthetic preview score; not AI-generated.', 'evidence', '[]'::jsonb, 'missing_evidence', '["Demo data is not evidence."]'::jsonb),
      'technical_implementation', jsonb_build_object('score', technical_implementation, 'explanation', 'DEMO ONLY: Synthetic preview score; not AI-generated.', 'evidence', '[]'::jsonb, 'missing_evidence', '["Demo data is not evidence."]'::jsonb),
      'github_code_quality', jsonb_build_object('score', github_code_quality, 'explanation', 'DEMO ONLY: Synthetic preview score; repository was not inspected.', 'evidence', '[]'::jsonb, 'missing_evidence', '["No repository source was inspected."]'::jsonb),
      'problem_solving', jsonb_build_object('score', problem_solving, 'explanation', 'DEMO ONLY: Synthetic preview score; not AI-generated.', 'evidence', '[]'::jsonb, 'missing_evidence', '["Demo data is not evidence."]'::jsonb),
      'real_world_impact', jsonb_build_object('score', real_world_impact, 'explanation', 'DEMO ONLY: Synthetic preview score; not AI-generated.', 'evidence', '[]'::jsonb, 'missing_evidence', '["Demo data is not evidence."]'::jsonb),
      'ui_ux', jsonb_build_object('score', ui_ux, 'explanation', 'DEMO ONLY: Synthetic preview score; no app was inspected.', 'evidence', '[]'::jsonb, 'missing_evidence', '["No deployed application was inspected."]'::jsonb),
      'documentation', jsonb_build_object('score', documentation, 'explanation', 'DEMO ONLY: Synthetic preview score; not AI-generated.', 'evidence', '[]'::jsonb, 'missing_evidence', '["No presentation was analyzed."]'::jsonb)
    ),
    '["DEMO ONLY: Synthetic preview record; not an AI finding."]'::jsonb,
    '["DEMO ONLY: Evidence unavailable; do not use for awards."]'::jsonb,
    'DEMO ONLY: No innovation evidence was analyzed.',
    'DEMO ONLY: No implementation evidence was analyzed.',
    'DEMO ONLY: No GitHub source was analyzed.',
    'DEMO ONLY: No deployed application was inspected.',
    '["Synthetic demo record; not a genuine evaluation."]'::jsonb,
    'low',
    true,
    true
  from evaluations
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
    manual_review = true,
    is_demo = true,
    evaluated_at = now()
  where public.ai_evaluations.is_demo;

  insert into public.presentation_analyses(
    submission_uuid, job_uuid, extraction_status, parser, extracted_text,
    analysis, missing_sections, manual_review, is_demo
  )
  select s.id, j.id, 'unavailable', null,
    'DEMO ONLY: No actual presentation file was extracted.',
    jsonb_build_object('demo_notice', 'Synthetic fixture only; no presentation was analyzed.'),
    '["No actual presentation file was submitted."]'::jsonb, true, true
  from public.submissions s
  join public.evaluation_jobs j on j.submission_uuid = s.id and j.batch_uuid = v_batch
  where s.is_demo
  on conflict (submission_uuid) do update set
    job_uuid = excluded.job_uuid, extraction_status = excluded.extraction_status,
    parser = excluded.parser, extracted_text = excluded.extracted_text,
    analysis = excluded.analysis, missing_sections = excluded.missing_sections,
    manual_review = true, is_demo = true, updated_at = now()
  where public.presentation_analyses.is_demo;

  delete from public.presentation_evidence pe
  using public.presentation_analyses pa
  where pe.analysis_uuid = pa.id and pe.is_demo and pa.is_demo
    and pa.submission_uuid in (select id from public.submissions where is_demo);
  insert into public.presentation_evidence(
    analysis_uuid, slide_number, category, excerpt, is_demo
  )
  select pa.id, null, 'demo_fixture',
    'DEMO ONLY: Synthetic placeholder; no presentation was analyzed.', true
  from public.presentation_analyses pa
  where pa.is_demo and pa.submission_uuid in (select id from public.submissions where is_demo);

  insert into public.github_analyses(
    submission_uuid, job_uuid, repository_url, accessible, languages,
    frameworks, architecture_observations, strengths, weaknesses,
    security_observations, missing_functionality, analysis, manual_review, is_demo
  )
  select s.id, j.id, 'https://github.com', false, '{}'::jsonb, '[]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_object('demo_notice', 'No repository was inspected; this is a synthetic record.'),
    true, true
  from public.submissions s
  join public.evaluation_jobs j on j.submission_uuid = s.id and j.batch_uuid = v_batch
  where s.is_demo
  on conflict (submission_uuid) do update set
    job_uuid = excluded.job_uuid, accessible = false, languages = '{}'::jsonb,
    frameworks = '[]'::jsonb, architecture_observations = '[]'::jsonb,
    strengths = '[]'::jsonb, weaknesses = '[]'::jsonb,
    security_observations = '[]'::jsonb, missing_functionality = '[]'::jsonb,
    analysis = excluded.analysis, manual_review = true, is_demo = true,
    analyzed_at = now()
  where public.github_analyses.is_demo;

  delete from public.repository_evidence re
  using public.github_analyses ga
  where re.analysis_uuid = ga.id and re.is_demo and ga.is_demo
    and ga.submission_uuid in (select id from public.submissions where is_demo);
  insert into public.repository_evidence(
    analysis_uuid, evidence_order, file_path, evidence_kind, excerpt, is_demo
  )
  select ga.id, 0, 'DEMO ONLY (no repository inspected)', 'demo_fixture',
    'DEMO ONLY: Synthetic placeholder; no repository source was inspected.', true
  from public.github_analyses ga
  where ga.is_demo and ga.submission_uuid in (select id from public.submissions where is_demo);

  insert into public.evidence_consistency_checks(
    submission_uuid, job_uuid, verified_claims, unsupported_claims,
    contradictions, unavailable_sources, manual_review, is_demo
  )
  select s.id, j.id, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '["DEMO ONLY: No presentation, repository, or deployment evidence was inspected."]'::jsonb,
    true, true
  from public.submissions s
  join public.evaluation_jobs j on j.submission_uuid = s.id and j.batch_uuid = v_batch
  where s.is_demo
  on conflict (submission_uuid, job_uuid) do update set
    verified_claims = '[]'::jsonb, unsupported_claims = '[]'::jsonb,
    contradictions = '[]'::jsonb,
    unavailable_sources = excluded.unavailable_sources,
    manual_review = true, is_demo = true, checked_at = now();

  delete from public.evaluation_evidence where is_demo and job_uuid in (
    select id from public.evaluation_jobs where batch_uuid = v_batch and is_demo
  );
  insert into public.evaluation_evidence(job_uuid, source, evidence, is_demo)
  select j.id, 'demo_fixture', jsonb_build_object(
    'demo_only', true,
    'notice', 'Synthetic demo fixture. No participant evidence or actual AI analysis.'
  ), true
  from public.evaluation_jobs j
  where j.batch_uuid = v_batch and j.is_demo;

  insert into public.evaluation_criterion_scores(
    evaluation_uuid, criterion_key, score, maximum_score, reason,
    evidence, missing_information, confidence, is_demo
  )
  select e.id, c.criterion_key,
    (e.criteria->c.criterion_key->>'score')::numeric,
    c.maximum_score,
    'DEMO ONLY: Synthetic fixture score; not AI-generated.',
    '[]'::jsonb,
    '["No genuine project evidence was inspected."]'::jsonb,
    'low',
    true
  from public.ai_evaluations e
  cross join public.evaluation_criteria c
  where e.is_demo and e.job_uuid in (select id from public.evaluation_jobs where batch_uuid = v_batch and is_demo)
    and e.criteria ? c.criterion_key
  on conflict (evaluation_uuid, criterion_key) do update set
    score = excluded.score, reason = excluded.reason,
    evidence = '[]'::jsonb, missing_information = excluded.missing_information,
    confidence = 'low', is_demo = true;

  delete from public.leaderboards where is_demo;
  insert into public.leaderboards(track, submission_uuid, rank, score, is_demo)
  select track, submission_uuid,
    row_number() over (partition by track order by total_score desc, team_id)::integer,
    total_score, true
  from (
    select t.track, e.submission_uuid, e.total_score, t.team_id
    from public.ai_evaluations e
    join public.submissions s on s.id = e.submission_uuid
    join public.teams t on t.id = s.team_uuid
    where e.is_demo and s.is_demo and t.is_demo
  ) demo_scores;

  delete from public.shortlisted_teams where is_demo;
  insert into public.shortlisted_teams(track, submission_uuid, position, status, reason, is_demo)
  select track, submission_uuid, rank, 'recommended',
    'DEMO ONLY: Synthetic preview shortlist; not a real award recommendation.', true
  from public.leaderboards
  where is_demo and rank <= 5;

  delete from public.final_rankings where is_demo;
  insert into public.final_rankings(track, submission_uuid, position, status, decision_reason, approved_by, is_demo)
  select l.track, l.submission_uuid, l.rank, 'recommended',
    'DEMO ONLY: Synthetic preview ranking; no organizer approved this result.',
    null, true
  from public.leaderboards l
  where l.is_demo and l.rank <= 5;
end $$;

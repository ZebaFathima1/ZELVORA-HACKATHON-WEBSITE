-- DEVELOPMENT/TEST ONLY. This creates a participant-verifiable test team and
-- opens submissions. Do not run against a live event project.
do $$
declare
  v_team_uuid uuid;
begin
  if exists (select 1 from public.teams where team_id = 'ZYL900099') then
    raise exception 'Test Team ID ZYL900099 already exists. Choose another unused ZYL + digits ID before running this script.';
  end if;

  insert into public.teams (
    team_id, team_name, team_leader, college, branch, track
  ) values (
    'ZYL900099', 'TEST ONLY - Submission Team', 'Test Leader',
    'Fictional Test College', 'Computer Science', 'AI Innovation'
  )
  returning id into v_team_uuid;

  insert into public.team_members (team_uuid, full_name, email, member_role)
  values
    (v_team_uuid, 'Test Leader', 'test-leader@example.invalid', 'Team leader'),
    (v_team_uuid, 'Test Member Two', 'test-member-two@example.invalid', 'Team member'),
    (v_team_uuid, 'Test Member Three', 'test-member-three@example.invalid', 'Team member');

  update public.event_settings
  set submissions_enabled = true,
      frozen = false,
      opens_at = null,
      deadline_at = null
  where id = true;

  if not found then
    raise exception 'The event_settings row is missing. Apply the database migrations before adding the test team.';
  end if;
end;
$$;

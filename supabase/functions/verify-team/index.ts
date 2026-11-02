import { corsHeaders, clientIp, isOptions, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, request);

  try {
    const body = await request.json();
    const teamId = typeof body.team_id === "string" ? body.team_id.trim().toUpperCase() : "";
    if (!/^ZYL\d{3,}$/.test(teamId)) return json({ error: "Enter a valid Team ID, such as ZYL001." }, 400, request);

    const supabase = serviceClient();
    const { data: allowed, error: limitError } = await supabase.rpc("consume_public_rate_limit", {
      p_key: `verify:${clientIp(request)}`,
      p_limit: 30,
      p_window_seconds: 300
    });
    if (limitError) throw limitError;
    if (!allowed) return json({ error: "Too many attempts. Please wait a few minutes and try again." }, 429, request);

    const { data: team, error } = await supabase
      .from("teams")
      .select("id,team_id,team_name,team_leader,college,branch,track,team_members(full_name,member_role)")
      .eq("team_id", teamId)
      .eq("is_demo", false)
      .maybeSingle();
    if (error) throw error;
    if (!team) return json({ error: "We couldn't find that Team ID. Check it with your registration details." }, 404, request);

    const [{ data: submission, error: submissionError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from("submissions").select("id,reference,project_title,submitted_at").eq("team_uuid", team.id).eq("is_demo", false).maybeSingle(),
      supabase.from("event_settings").select("opens_at,deadline_at,submissions_enabled,frozen").eq("id", true).single()
    ]);
    if (submissionError) throw submissionError;
    if (settingsError) throw settingsError;

    return json({
      team: {
        id: team.id,
        team_id: team.team_id,
        team_name: team.team_name,
        team_leader: team.team_leader,
        college: team.college,
        branch: team.branch,
        track: team.track,
        members: team.team_members,
        team_size: team.team_members.length
      },
      submission: submission ?? null,
      can_submit: !submission
        && settings.submissions_enabled
        && !settings.frozen
        && (!settings.opens_at || Date.now() >= Date.parse(settings.opens_at))
        && (!settings.deadline_at || Date.now() <= Date.parse(settings.deadline_at)),
      submission_message: submission
        ? "Your team has already submitted its project. Multiple submissions are not allowed."
        : null
    }, 200, request);
  } catch (error) {
    console.error("Team verification failed:", error);
    return json({ error: "Team verification is temporarily unavailable. Please try again." }, 500, request);
  }
});

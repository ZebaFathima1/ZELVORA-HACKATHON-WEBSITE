import { corsHeaders, isOptions, json } from "../_shared/http.ts";
import { requireAdmin, serviceClient } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabase = serviceClient();
  try {
    await requireAdmin(request, supabase);
    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return json({ error: "Request body must be a JSON object." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }
    if (body.batch_id !== undefined && (typeof body.batch_id !== "string" || !uuidPattern.test(body.batch_id))) {
      return json({ error: "A valid batch ID is required." }, 400);
    }

    let batchQuery = supabase.from("evaluation_batches")
      .select("id,status,total_jobs,queued_jobs,processing_jobs,completed_jobs,failed_jobs,created_at,completed_at")
      .eq("is_demo", false);
    batchQuery = typeof body.batch_id === "string"
      ? batchQuery.eq("id", body.batch_id)
      : batchQuery.order("created_at", { ascending: false }).limit(1);
    const { data: batch, error: batchError } = await batchQuery.maybeSingle();
    if (batchError) throw batchError;
    if (!batch) {
      return json({
        batch: null,
        counts: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, manual_review: 0 },
        jobs: [],
        provisional_top_five: []
      });
    }

    const { data: jobs, error: jobsError } = await supabase.from("evaluation_jobs")
      .select("id,status,progress_stage,attempts,error_message,submission_uuid,submissions(project_title,teams(team_id,team_name))")
      .eq("batch_uuid", batch.id)
      .eq("is_demo", false)
      .order("created_at", { ascending: true });
    if (jobsError) throw jobsError;

    const submissionIds = (jobs ?? []).map((job) => job.submission_uuid);
    let manualReviewCount = 0;
    if (submissionIds.length) {
      const { count, error: reviewError } = await supabase.from("ai_evaluations")
        .select("id", { count: "exact", head: true })
        .in("submission_uuid", submissionIds)
        .eq("is_demo", false)
        .eq("manual_review", true);
      if (reviewError) throw reviewError;
      manualReviewCount = count ?? 0;
    }

    const { data: topFive, error: leaderboardError } = await supabase.from("leaderboards")
      .select("track,rank,score,submission_uuid,submissions(project_title,teams(team_id,team_name))")
      .eq("is_demo", false)
      .eq("submissions.status", "evaluated")
      .lte("rank", 5)
      .order("track")
      .order("rank");
    if (leaderboardError) throw leaderboardError;

    return json({
      batch,
      counts: {
        total: jobs?.length ?? 0,
        pending: jobs?.filter((job) => job.status === "queued").length ?? 0,
        processing: jobs?.filter((job) => job.status === "processing").length ?? 0,
        completed: jobs?.filter((job) => job.status === "completed").length ?? 0,
        failed: jobs?.filter((job) => job.status === "failed").length ?? 0,
        manual_review: manualReviewCount
      },
      jobs,
      provisional_top_five: topFive ?? []
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evaluation status could not be loaded.";
    console.error("Could not load evaluation status:", error);
    const status = message === "ADMIN_AUTH_REQUIRED" ? 401 : message === "ADMIN_ACCESS_REQUIRED" ? 403 : 500;
    return json({ error: status === 500 ? "Could not load evaluation status. Check the function logs." : "Administrator access is required." }, status);
  }
});

import { corsHeaders, isOptions, json } from "../_shared/http.ts";
import { requireAdmin, serviceClient } from "../_shared/supabase.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const supabase = serviceClient();
  try {
    const { user, role } = await requireAdmin(request, supabase);
    if (role === "evaluator") return json({ error: "Organizer permissions are required to finalize rankings." }, 403);
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
    if (typeof body.batch_id !== "string" || !uuidPattern.test(body.batch_id)) {
      return json({ error: "A valid evaluation batch ID is required." }, 400);
    }

    const { data: batch, error: batchError } = await supabase.from("evaluation_batches")
      .select("id,status,failed_jobs,is_demo")
      .eq("id", body.batch_id)
      .maybeSingle();
    if (batchError) throw batchError;
    if (!batch || batch.is_demo) return json({ error: "A real evaluation batch was not found." }, 404);
    if (["queued", "running"].includes(batch.status)) {
      return json({ error: "Wait until all evaluation jobs finish before staging final recommendations." }, 409);
    }

    const { data: result, error: finalizeError } = await supabase.rpc("stage_recommended_top_five", { p_actor: user.id });
    if (finalizeError) {
      const code = finalizeError.message;
      if (code.includes("EVALUATIONS_STILL_RUNNING")) return json({ error: "Wait until all evaluation jobs finish before staging final recommendations." }, 409);
      if (code.includes("UNRESOLVED_MANUAL_REVIEWS")) return json({ error: "Resolve all required manual reviews before staging recommendations." }, 409);
      if (code.includes("FINAL_RANKINGS_ALREADY_APPROVED")) return json({ error: "Approved final rankings already exist and will not be overwritten." }, 409);
      if (code.includes("ORGANIZER_ACCESS_REQUIRED")) return json({ error: "Organizer permissions are required to finalize rankings." }, 403);
      throw finalizeError;
    }

    return json({
      staged_recommendations: result,
      failed_jobs_flagged: batch.failed_jobs,
      requires_human_approval: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Leaderboard finalization failed.";
    console.error("Could not finalize local AI leaderboard:", error);
    const status = message === "ADMIN_AUTH_REQUIRED" ? 401 : message === "ADMIN_ACCESS_REQUIRED" ? 403 : 500;
    return json({ error: status === 500 ? "Could not finalize rankings. Check the function logs." : "Administrator access is required." }, status);
  }
});

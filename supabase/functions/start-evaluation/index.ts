import { corsHeaders, isOptions, json } from "../_shared/http.ts";
import { requireAdmin, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const supabase = serviceClient();
    const { user, role } = await requireAdmin(request, supabase);
    if (role === "evaluator") return json({ error: "Organizer permissions are required to start a batch." }, 403);
    const { data: settings, error: settingsError } = await supabase
      .from("event_settings")
      .select("frozen")
      .eq("id", true)
      .single();
    if (settingsError) throw settingsError;
    if (!settings.frozen) return json({ error: "Freeze submissions in Event Settings before starting AI evaluation." }, 409);
    if (!Deno.env.get("AI_PROVIDER_API_KEY")) {
      return json({ error: "AI_PROVIDER_API_KEY is not configured in Supabase Function secrets. Configure it before starting a batch." }, 503);
    }
    const { data: batchId, error } = await supabase.rpc("create_real_evaluation_batch", { p_created_by: user.id });
    if (error?.message.includes("EVALUATION_BATCH_ACTIVE")) {
      return json({ error: "An evaluation batch is already queued or running. Resume it before starting another batch." }, 409);
    }
    if (error?.message.includes("NO_ELIGIBLE_SUBMISSIONS")) {
      return json({ error: "There are no submitted or failed projects available for evaluation." }, 409);
    }
    if (error) throw error;
    return json({ batch_id: batchId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Evaluation could not be started.";
    const status = message === "ADMIN_AUTH_REQUIRED" ? 401 : message === "ADMIN_ACCESS_REQUIRED" ? 403 : 500;
    console.error("Could not start evaluation batch:", error);
    return json({ error: status === 500 ? "Evaluation could not be started. Check the function logs." : message }, status);
  }
});

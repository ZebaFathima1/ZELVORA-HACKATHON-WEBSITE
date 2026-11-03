import { corsHeaders, isOptions, json } from "../_shared/http.ts";
import { requireAdmin, serviceClient } from "../_shared/supabase.ts";

const onlineWindowMs = 90_000;

Deno.serve(async (request) => {
  if (isOptions(request)) return new Response("ok", { headers: corsHeaders(request) });
  // Accept GET and POST: the browser Supabase client defaults to POST for functions.invoke.
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, request);
  }

  const supabase = serviceClient();
  try {
    await requireAdmin(request, supabase);
    const [workerResult, batchResult, eligibleResult] = await Promise.all([
      supabase.from("ai_workers")
        .select("worker_id,display_name,status,ollama_connected,model_available,model_name,current_job_uuid,last_error,last_heartbeat,worker_version")
        .order("last_heartbeat", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("evaluation_batches")
        .select("id,status,total_jobs,queued_jobs,processing_jobs,completed_jobs,failed_jobs,paused,created_at")
        .eq("is_demo", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("is_demo", false)
        .in("status", ["submitted", "failed"])
    ]);
    if (workerResult.error) throw workerResult.error;
    if (batchResult.error) throw batchResult.error;
    if (eligibleResult.error) throw eligibleResult.error;

    const worker = workerResult.data;
    const online = Boolean(worker && Date.now() - new Date(worker.last_heartbeat).getTime() <= onlineWindowMs);
    const ollamaConnected = Boolean(online && worker?.ollama_connected);
    const modelAvailable = Boolean(online && worker?.model_available);
    const queueReady = !batchResult.data ||
      (["queued", "running"].includes(batchResult.data.status) && !batchResult.data.paused);
    const ready = online && ollamaConnected && modelAvailable;

    let currentProject: string | null = null;
    if (online && worker?.current_job_uuid) {
      const { data: job, error: jobError } = await supabase.from("evaluation_jobs")
        .select("submissions(project_title)")
        .eq("id", worker.current_job_uuid)
        .maybeSingle();
      if (jobError) throw jobError;
      const related = Array.isArray(job?.submissions) ? job.submissions[0] : job?.submissions;
      currentProject = related?.project_title ?? null;
    }

    return json({
      ready,
      supabase: "connected",
      worker: {
        online,
        status: online ? worker?.status : "offline",
        display_name: worker?.display_name ?? null,
        last_heartbeat: worker?.last_heartbeat ?? null,
        last_error: online ? worker?.last_error : null,
        current_job_id: online ? worker?.current_job_uuid : null,
        current_project: currentProject,
        version: worker?.worker_version ?? null
      },
      ollama: { connected: ollamaConnected },
      model: {
        name: worker?.model_name ?? "qwen3-vl:8b",
        available: modelAvailable
      },
      batch: batchResult.data ? {
        id: batchResult.data.id,
        status: batchResult.data.paused ? "paused" : batchResult.data.status,
        paused: batchResult.data.paused,
        total: batchResult.data.total_jobs,
        pending: batchResult.data.queued_jobs,
        processing: batchResult.data.processing_jobs,
        completed: batchResult.data.completed_jobs,
        failed: batchResult.data.failed_jobs
      } : null,
      eligible_projects: eligibleResult.count ?? 0,
      queue_ready: queueReady
    }, 200, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker status is unavailable.";
    console.error("Could not load worker status:", error);
    const status = message === "ADMIN_AUTH_REQUIRED" ? 401 : message === "ADMIN_ACCESS_REQUIRED" ? 403 : 500;
    return json({ error: status === 401 || status === 403 ? "Administrator access is required." : "Worker status could not be loaded." }, status, request);
  }
});

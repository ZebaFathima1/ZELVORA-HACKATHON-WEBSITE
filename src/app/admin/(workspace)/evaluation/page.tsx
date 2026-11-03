"use client";

import { AlertTriangle, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/function-error";

type Batch = {
  id: string;
  status: string;
  total_jobs: number;
  queued_jobs: number;
  processing_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  created_at: string;
};

type EvaluationJob = {
  id: string;
  status: string;
  progress_stage: string;
  attempts: number;
  error_message: string | null;
  submissions: {
    project_title: string;
    teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null;
  } | { project_title: string; teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null }[] | null;
};

type WorkerStatus = {
  ready: boolean;
  supabase: string;
  worker: {
    online: boolean;
    status: string;
    display_name: string | null;
    last_heartbeat: string | null;
    last_error: string | null;
    current_job_id: string | null;
    current_project: string | null;
  };
  ollama: { connected: boolean };
  model: { name: string; available: boolean };
  batch: {
    id: string;
    status: string;
    paused: boolean;
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } | null;
  eligible_projects: number;
  queue_ready: boolean;
};

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default function EvaluationPage() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [submissionsFrozen, setSubmissionsFrozen] = useState(false);
  const [manualReviewCount, setManualReviewCount] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [statusResult, workerResult, settingsResult] = await Promise.all([
      supabase.functions.invoke("evaluation-status", { body: {} }),
      supabase.functions.invoke("ai-worker-status", { method: "GET" }),
      supabase.from("event_settings").select("frozen").eq("id", true).single()
    ]);
    if (statusResult.error || workerResult.error || settingsResult.error || !settingsResult.data) {
      setErrorMessage(statusResult.error || workerResult.error
        ? await getFunctionErrorMessage(statusResult.error ?? workerResult.error)
        : settingsResult.error?.message ?? "Could not load the event submission settings.");
      return;
    }
    if (!statusResult.data || !Array.isArray(statusResult.data.jobs) || !statusResult.data.counts ||
      typeof statusResult.data.counts.manual_review !== "number") {
      setErrorMessage("Evaluation status returned an invalid response.");
      return;
    }
    if (!workerResult.data || typeof workerResult.data.ready !== "boolean" ||
      typeof workerResult.data.worker?.online !== "boolean" ||
      typeof workerResult.data.ollama?.connected !== "boolean" ||
      typeof workerResult.data.model?.available !== "boolean") {
      setErrorMessage("AI worker status returned an invalid response.");
      return;
    }
    setBatch(statusResult.data.batch as Batch | null);
    setWorkerStatus(workerResult.data as WorkerStatus);
    setSubmissionsFrozen(settingsResult.data.frozen);
    setManualReviewCount(statusResult.data.counts.manual_review);
    setJobs(statusResult.data.jobs as EvaluationJob[]);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const supabase = createClient();
    let timer: number | undefined;
    const refreshSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void refresh(); }, 250);
    };
    const channel = supabase.channel("evaluation-live-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "evaluation_batches" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "evaluation_jobs" }, refreshSoon)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_workers" }, refreshSoon)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  async function testWorkerConnection() {
    setTestingProvider(true);
    setErrorMessage("");
    setMessage("");
    try {
      const { data, error } = await createClient().functions.invoke("ai-worker-status", { method: "GET" });
      if (error) {
        setErrorMessage(await getFunctionErrorMessage(error));
        return;
      }
      if (!data || typeof data.ready !== "boolean" || !data.worker || !data.ollama || !data.model) {
        setErrorMessage("AI worker status returned an invalid response.");
        return;
      }
      setWorkerStatus(data as WorkerStatus);
      if (!data.ready) {
        const reasons = [
          !data.worker.online ? "Windows worker is offline." : "",
          data.worker.online && !data.ollama.connected ? "Ollama is disconnected." : "",
          data.worker.online && data.ollama.connected && !data.model.available
            ? `Model ${data.model.name} is unavailable or failed its startup generation check.` : ""
        ].filter(Boolean);
        setErrorMessage(reasons.join(" ") || "The worker is not ready.");
        return;
      }
      setMessage(`Supabase, worker, Ollama, and ${data.model.name} are ready.`);
    } catch (testError) {
      setErrorMessage(testError instanceof Error ? testError.message : "The local AI worker connection test failed.");
    } finally {
      setTestingProvider(false);
    }
  }

  async function start() {
    if (!window.confirm("Submissions must already be frozen. Create an immutable evaluation snapshot and start AI evaluation now?")) return;
    setBusy(true);
    setErrorMessage("");
    setMessage("");
    const { data: settings, error: settingsError } = await createClient().from("event_settings").select("frozen").eq("id", true).single();
    if (settingsError) {
      setErrorMessage(`Could not verify submission freeze state: ${settingsError.message}`);
      setBusy(false);
      return;
    }
    if (!settings.frozen) {
      setErrorMessage("Freeze submissions in Event Settings before starting AI evaluation.");
      setBusy(false);
      return;
    }
    const { data, error } = await createClient().functions.invoke("start-ai-evaluation", { body: {} });
    if (error) {
      setErrorMessage(await getFunctionErrorMessage(error));
      setBusy(false);
      return;
    }
    if (!data || typeof data.batch_id !== "string") {
      setErrorMessage("The start-evaluation endpoint returned an invalid batch ID.");
      setBusy(false);
      return;
    }
    setMessage("Evaluation jobs are queued in Supabase. Your Windows worker will process them with local Ollama.");
    await refresh();
    setBusy(false);
  }

  async function resume() {
    if (!batch) return;
    setBusy(true);
    setErrorMessage("");
    setMessage("Resuming the active evaluation batch.");
    try {
      const { data, error } = await createClient().functions.invoke("ai-worker-control", {
        body: { action: "resume" }
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setMessage(data?.paused === false ? "Batch resumed. The Windows worker will continue processing." : "Batch resume status could not be confirmed.");
    } catch (resumeError) {
      setErrorMessage(resumeError instanceof Error ? resumeError.message : "Could not resume evaluation.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function pause() {
    setBusy(true);
    setErrorMessage("");
    try {
      const { data, error } = await createClient().functions.invoke("ai-worker-control", {
        body: { action: "pause" }
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      setMessage(data?.paused === true
        ? "Batch paused. The current project may finish; no new project will be claimed."
        : "Batch pause status could not be confirmed.");
    } catch (pauseError) {
      setErrorMessage(pauseError instanceof Error ? pauseError.message : "Could not pause evaluation.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function finalizeLeaderboard() {
    if (!batch || !window.confirm("Stage provisional Top 5 recommendations for each track? Organizers must still approve final awards.")) return;
    setFinalizing(true);
    setErrorMessage("");
    setMessage("");
    try {
      const { data, error } = await createClient().functions.invoke("finalize-leaderboard", {
        body: { batch_id: batch.id }
      });
      if (error) throw new Error(await getFunctionErrorMessage(error));
      if (!data || typeof data.staged_recommendations !== "number" || typeof data.failed_jobs_flagged !== "number") {
        throw new Error("Leaderboard finalization returned an invalid response.");
      }
      setMessage(
        `Staged ${data.staged_recommendations} provisional rankings. ${data.failed_jobs_flagged} failed job(s) remain flagged; organizer approval is still required.`
      );
      await refresh();
    } catch (finalizeError) {
      setErrorMessage(finalizeError instanceof Error ? finalizeError.message : "Could not stage final recommendations.");
    } finally {
      setFinalizing(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const processingCount = jobs.filter((job) => job.status === "processing").length;
  const queuedCount = jobs.filter((job) => job.status === "queued").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const reviewCount = jobs.filter((job) => job.progress_stage === "manual_review").length;
  const percent = jobs.length
    ? Math.round((completedCount / jobs.length) * 100)
    : batch?.total_jobs ? Math.round((batch.completed_jobs / batch.total_jobs) * 100) : 0;
  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Local Qwen3-VL evaluation</span><h1>AI evaluation</h1><p>Supabase queues projects; your Windows worker evaluates them with local Ollama.</p></div><div className="inline-actions"><button className="button secondary small" onClick={() => void testWorkerConnection()} disabled={testingProvider || busy}>{testingProvider ? <><LoaderCircle size={13} /> Testing…</> : "Test AI connection"}</button><button className="button secondary small" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button></div></div>
      <section className="panel">
        <div className="panel-header"><h2>AI evaluation system status</h2><span className={`status ${workerStatus?.ready ? "success" : "warning"}`}>{workerStatus?.ready ? "READY" : "NOT READY"}</span></div>
        <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {[["Supabase", workerStatus?.supabase ?? "Checking"], ["Local AI worker", workerStatus?.worker.online ? (workerStatus.worker.status === "processing" ? "Online · Processing" : "Online · Idle") : "Offline"], ["Ollama", workerStatus?.ollama.connected ? "Connected" : "Disconnected"], ["Model", workerStatus?.model.available ? `${workerStatus.model.name} available` : `${workerStatus?.model.name ?? "qwen3-vl:8b"} unavailable`], ["Queue", workerStatus?.queue_ready ? "Ready" : "Not ready"], ["Eligible projects", workerStatus?.eligible_projects ?? 0], ["Active batch", workerStatus?.batch?.id ?? "Not started"], ["Current project", workerStatus?.worker.current_project ?? "Idle"], ["Last heartbeat", workerStatus?.worker.last_heartbeat ? new Date(workerStatus.worker.last_heartbeat).toLocaleTimeString() : "Never"]].map(([label, value]) => <div className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong></div>)}
        </div>
        {workerStatus?.worker.last_error && <div className="alert error">{workerStatus.worker.last_error}</div>}
      </section>
      <div className="notice-bar"><AlertTriangle size={17} /> Evaluations run on the Windows Ollama worker, never in the browser. Results are provisional recommendations, not final awards. Submissions are currently {submissionsFrozen ? "frozen" : "not frozen"}.</div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      {message && <div className="alert success">{message}</div>}
      <section className="panel">
        <div className="panel-header"><h2>Current batch</h2>{batch && <span className="status">{batch.status}</span>}</div>
        {!batch ? <div className="empty">No evaluation batches have been started.</div> : <>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            {[["Total", batch.total_jobs], ["Queued", jobs.length ? queuedCount : batch.queued_jobs], ["Processing", jobs.length ? processingCount : batch.processing_jobs], ["Completed", jobs.length ? completedCount : batch.completed_jobs], ["Failed", jobs.length ? failedCount : batch.failed_jobs], ["Manual review", Math.max(reviewCount, manualReviewCount)]].map(([label, value]) => <div className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{String(value)}</strong></div>)}
          </div>
          <div className="score-bar"><span style={{ width: `${percent}%` }} /></div>
          <p className="muted" style={{ fontSize: 11 }}>{percent}% complete · Batch {batch.id} · Started {new Date(batch.created_at).toLocaleString()} · Updated {new Date().toLocaleTimeString()}</p>
          <div className="table-wrap">
            <table><thead><tr><th>Team</th><th>Project</th><th>Stage</th><th>Status</th><th>Attempts</th></tr></thead><tbody>
              {jobs.map((job) => {
                const submission = first(job.submissions);
                const team = first(submission?.teams);
                return <tr key={job.id}>
                  <td>{team?.team_id ?? "—"} · {team?.team_name ?? "—"}</td>
                  <td>{submission?.project_title ?? "—"}</td>
                  <td>{job.progress_stage.replaceAll("_", " ")}</td>
                  <td><span className="status">{job.status}</span>{job.error_message && <small className="alert error">{job.error_message}</small>}</td>
                  <td>{job.attempts}</td>
                </tr>;
              })}
            </tbody></table>
          </div>
        </>}
        <div className="form-actions">
          <span className="muted" style={{ fontSize: 11 }}>Freeze submissions in Event Settings before creating a snapshot. Reopen them there after evaluation.</span>
          <div className="inline-actions">
            {batch && ["queued", "running"].includes(batch.status) && (workerStatus?.batch?.paused
              ? <button className="button secondary" disabled={busy} onClick={resume}>Resume evaluation</button>
              : <button className="button secondary" disabled={busy} onClick={pause}>Pause evaluation</button>)}
            {batch && ["completed", "completed_with_errors", "failed"].includes(batch.status) && <button className="button secondary" disabled={finalizing || busy} onClick={() => void finalizeLeaderboard()}>{finalizing ? <><LoaderCircle size={15} /> Staging…</> : "Stage final Top 5 recommendations"}</button>}
            <button className="button" disabled={busy || finalizing || !submissionsFrozen || !workerStatus?.ready || Boolean(batch && ["queued", "running"].includes(batch.status))} onClick={start}>{busy ? <><LoaderCircle size={15} /> Queuing…</> : <><Play size={15} /> START AI EVALUATION</>}</button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>What the evaluator can verify</h2></div>
        <div className="info-grid">
          <div className="info-cell"><small>Project narrative</small><strong>Submitted project form fields</strong></div>
          <div className="info-cell"><small>GitHub evidence</small><strong>Public repository metadata, languages, README, and selected source files</strong></div>
          <div className="info-cell"><small>Uploads</small><strong>Private PDF/PPT text extraction and up to four embedded PPTX images</strong></div>
          <div className="info-cell"><small>Deployed app</small><strong>Link submitted, not crawled or executed</strong></div>
        </div>
      </section>
    </>
  );
}

"use client";

import { Activity, AlertTriangle, LoaderCircle, Play, RefreshCw } from "lucide-react";
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

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default function EvaluationPage() {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);
  const [submissionsFrozen, setSubmissionsFrozen] = useState(false);
  const [manualReviewCount, setManualReviewCount] = useState(0);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [batchResult, settingsResult, reviewsResult] = await Promise.all([
      supabase.from("evaluation_batches").select("*").eq("is_demo", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("event_settings").select("frozen").eq("id", true).single(),
      supabase.from("ai_evaluations").select("id", { count: "exact", head: true }).eq("is_demo", false).eq("manual_review", true)
    ]);
    const failure = batchResult.error ?? settingsResult.error ?? reviewsResult.error;
    if (failure || !settingsResult.data) {
      setErrorMessage(failure?.message ?? "Could not load the event submission settings.");
      return;
    }
    setBatch(batchResult.data as Batch | null);
    setSubmissionsFrozen(settingsResult.data.frozen);
    setManualReviewCount(reviewsResult.count ?? 0);
    if (batchResult.data) {
      const { data: jobRows, error: jobsError } = await supabase.from("evaluation_jobs")
        .select("id,status,progress_stage,attempts,error_message,submissions(project_title,teams(team_id,team_name))")
        .eq("batch_uuid", batchResult.data.id).eq("is_demo", false)
        .order("created_at", { ascending: true });
      if (jobsError) setErrorMessage(jobsError.message);
      else setJobs((jobRows ?? []) as EvaluationJob[]);
    } else {
      setJobs([]);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function testProvider() {
    setTestingProvider(true);
    setErrorMessage("");
    setMessage("");
    try {
      const { data, error } = await createClient().functions.invoke("test-ai-provider", { body: {} });
      if (error) {
        setErrorMessage(await getFunctionErrorMessage(error));
        return;
      }
      if (!data?.ready) {
        setErrorMessage("The AI provider test returned an unexpected response.");
        return;
      }
      setMessage(`AI provider connection successful. Model: ${data.model}.`);
    } catch (testError) {
      setErrorMessage(testError instanceof Error ? testError.message : "The AI provider connection test failed.");
    } finally {
      setTestingProvider(false);
    }
  }

  async function runWorkers(batchId: string) {
    const supabase = createClient();
    async function worker() {
      for (let count = 0; count < 300; count += 1) {
        const { data, error } = await supabase.functions.invoke("process-evaluation", { body: { batch_id: batchId } });
        if (error) {
          throw new Error(await getFunctionErrorMessage(error));
        }
        if (data?.done) return;
      }
      throw new Error("An evaluation worker reached its request limit. Resume the batch to continue processing.");
    }
    await Promise.all(Array.from({ length: 4 }, () => worker()));
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
    const { data, error } = await createClient().functions.invoke("start-evaluation", { body: {} });
    if (error) {
      setErrorMessage(await getFunctionErrorMessage(error));
      setBusy(false);
      return;
    }
    setMessage("Submissions are frozen. Evaluation jobs are being processed with four controlled workers.");
    await refresh();
    try {
      await runWorkers(data.batch_id);
      setMessage("Evaluation workers finished processing all available jobs.");
    } catch (workerError) {
      setErrorMessage(workerError instanceof Error ? workerError.message : "The evaluation worker stopped unexpectedly.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function resume() {
    if (!batch) return;
    setBusy(true);
    setErrorMessage("");
    setMessage("Resuming workers for the active batch.");
    try {
      await runWorkers(batch.id);
      setMessage("Evaluation workers finished processing all available jobs.");
    } catch (workerError) {
      setErrorMessage(workerError instanceof Error ? workerError.message : "The evaluation worker stopped unexpectedly.");
    } finally {
      await refresh();
      setBusy(false);
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
      <div className="admin-title"><div><span className="eyebrow">Evidence-based evaluation</span><h1>AI evaluation</h1><p>Freeze an immutable submission snapshot and process projects with controlled parallel workers.</p></div><div className="inline-actions"><button className="button secondary small" onClick={() => void testProvider()} disabled={testingProvider || busy}>{testingProvider ? <><LoaderCircle size={13} /> Testing…</> : "Test AI connection"}</button><button className="button secondary small" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button></div></div>
      <div className="notice-bar"><AlertTriangle size={17} /> AI results are recommendations for human review, not final awards. The evaluator does not execute submitted code and will explicitly flag unverified evidence. Submissions are currently {submissionsFrozen ? "frozen" : "not frozen"}.</div>
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
            {batch && ["queued", "running"].includes(batch.status) && <button className="button secondary" disabled={busy} onClick={resume}>{busy ? <><LoaderCircle size={15} /> Evaluating…</> : "Resume workers"}</button>}
            <button className="button" disabled={busy || !submissionsFrozen || Boolean(batch && ["queued", "running"].includes(batch.status))} onClick={start}>{busy ? <><LoaderCircle size={15} /> Evaluating…</> : <><Play size={15} /> START AI EVALUATION</>}</button>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>What the evaluator can verify</h2></div>
        <div className="info-grid">
          <div className="info-cell"><small>Project narrative</small><strong>Submitted project form fields</strong></div>
          <div className="info-cell"><small>GitHub evidence</small><strong>Public repository metadata, languages, README</strong></div>
          <div className="info-cell"><small>Uploads</small><strong>Private file metadata (text extraction must be added to worker deployment)</strong></div>
          <div className="info-cell"><small>Deployed app</small><strong>Link submitted, not crawled or executed</strong></div>
        </div>
      </section>
    </>
  );
}

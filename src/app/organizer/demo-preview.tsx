"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type DemoTeam = {
  id: string;
  team_id: string;
  team_name: string;
  team_leader: string;
  college: string;
  branch: string;
  track: string;
  team_members: Array<{ count: number }> | null;
};

type DemoSubmission = {
  id: string;
  reference: string;
  project_title: string;
  status: string;
  submitted_at: string;
  teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
};

type DemoEvaluation = {
  submission_uuid: string;
  total_score: number;
  manual_review: boolean;
  submissions: {
    project_title: string;
    teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
  } | {
    project_title: string;
    teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
  }[] | null;
};

type DemoJob = {
  status: string;
  progress_stage: string;
};

type DemoFinal = {
  track: string;
  position: number;
  status: string;
  decision_reason: string;
};

type PreviewTab = "overview" | "teams" | "submissions" | "evaluation" | "rankings";

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

const tabs: Array<{ id: PreviewTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "teams", label: "Teams" },
  { id: "submissions", label: "Submissions" },
  { id: "evaluation", label: "Evaluation" },
  { id: "rankings", label: "Rankings" }
];

export default function OrganizerDemoPreview() {
  const [tab, setTab] = useState<PreviewTab>("overview");
  const [teams, setTeams] = useState<DemoTeam[]>([]);
  const [submissions, setSubmissions] = useState<DemoSubmission[]>([]);
  const [evaluations, setEvaluations] = useState<DemoEvaluation[]>([]);
  const [jobs, setJobs] = useState<DemoJob[]>([]);
  const [finals, setFinals] = useState<DemoFinal[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [teamResult, submissionResult, evaluationResult, jobResult, finalResult] = await Promise.all([
      supabase.from("teams")
        .select("id,team_id,team_name,team_leader,college,branch,track,team_members(count)")
        .eq("is_demo", true).order("team_id").limit(100),
      supabase.from("submissions")
        .select("id,reference,project_title,status,submitted_at,teams(team_id,team_name,track)")
        .eq("is_demo", true).order("submitted_at", { ascending: false }).limit(100),
      supabase.from("ai_evaluations")
        .select("submission_uuid,total_score,manual_review,submissions(project_title,teams(team_id,team_name,track))")
        .eq("is_demo", true).order("total_score", { ascending: false }).limit(100),
      supabase.from("evaluation_jobs")
        .select("status,progress_stage")
        .eq("is_demo", true).limit(500),
      supabase.from("final_rankings")
        .select("track,position,status,decision_reason")
        .eq("is_demo", true).order("track").order("position")
    ]);

    const failure = teamResult.error ?? submissionResult.error ?? evaluationResult.error ?? jobResult.error ?? finalResult.error;
    if (failure) {
      setErrorMessage(`Could not load demo preview data. Apply the evidence-evaluation migration and run the optional demo seed. ${failure.message}`);
    } else {
      setErrorMessage("");
      setTeams((teamResult.data ?? []) as DemoTeam[]);
      setSubmissions((submissionResult.data ?? []) as DemoSubmission[]);
      setEvaluations((evaluationResult.data ?? []) as DemoEvaluation[]);
      setJobs((jobResult.data ?? []) as DemoJob[]);
      setFinals((finalResult.data ?? []) as DemoFinal[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const countsByTrack = useMemo(() => Object.fromEntries(
    TRACKS.map((trackName) => [trackName, submissions.filter((submission) => first(submission.teams)?.track === trackName).length])
  ), [submissions]);
  const pendingJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing").length;
  const manualReviews = evaluations.filter((evaluation) => evaluation.manual_review).length;

  return (
    <>
      <div className="admin-title">
        <div>
          <span className="eyebrow">Safe walkthrough</span>
          <h1>Organizer demo preview</h1>
          <p>Explore the organizer workflow using synthetic records. No preview actions can change real event data.</p>
        </div>
        <button className="button secondary small" onClick={() => void load()} disabled={loading}>Refresh preview</button>
      </div>
      <div className="notice-bar demo-preview-notice">
        DEMO DATA ONLY — team names and scores are synthetic, not real registrations or AI results. The preview is read-only and available only to signed-in organizers.
      </div>
      {!loading && !errorMessage && teams.length === 0 && submissions.length === 0 && <div className="alert info demo-preview-setup" role="status">
        Preview data is not installed yet. Ask the Supabase project owner to apply both migrations, then run <code>supabase/demo_seed.sql</code> in the Supabase SQL Editor. Real event pages stay separate from these demo records.
      </div>}
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      <div className="filters demo-preview-tabs" aria-label="Demo preview sections">
        {tabs.map((item) => <button key={item.id} className={`button small ${tab === item.id ? "" : "secondary"}`} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>

      {tab === "overview" && <>
        <div className="stats-grid">
          {[
            ["Demo teams", teams.length],
            ["Demo submissions", submissions.length],
            ["Sample evaluations", evaluations.length],
            ["Manual-review flags", manualReviews],
            ["Evaluation jobs pending", pendingJobs],
            ["Sample final rankings", finals.length]
          ].map(([label, count]) => <article className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{loading ? "—" : String(count)}</strong></article>)}
        </div>
        <section className="panel">
          <div className="panel-header"><h2>Sample submissions by track</h2></div>
          <div className="dashboard-track-chart">{TRACKS.map((trackName) => {
            const count = countsByTrack[trackName] ?? 0;
            const maxCount = Math.max(...TRACKS.map((item) => countsByTrack[item] ?? 0), 1);
            return <div className="dashboard-track-row" key={trackName}><span>{trackName}</span><div className="dashboard-track-bar"><span style={{ width: `${(count / maxCount) * 100}%` }} /></div><strong>{loading ? "—" : count}</strong></div>;
          })}</div>
        </section>
      </>}

      {tab === "teams" && <section className="panel">
        <div className="panel-header"><h2>{teams.length} synthetic registered teams</h2></div>
        {loading ? <div className="loading">Loading demo teams…</div> : !teams.length ? <div className="empty">No demo teams found. Follow the setup note above.</div> : <div className="table-wrap"><table><thead><tr><th>Team ID</th><th>Team name</th><th>Leader</th><th>College</th><th>Branch</th><th>Size</th><th>Track</th></tr></thead><tbody>
          {teams.map((team) => <tr key={team.id}><td><strong>{team.team_id}</strong></td><td>{team.team_name}</td><td>{team.team_leader}</td><td>{team.college}</td><td>{team.branch}</td><td>{team.team_members?.[0]?.count ?? 0}</td><td>{team.track}</td></tr>)}
        </tbody></table></div>}
      </section>}

      {tab === "submissions" && <section className="panel">
        <div className="panel-header"><h2>{submissions.length} synthetic submissions</h2></div>
        {loading ? <div className="loading">Loading demo submissions…</div> : !submissions.length ? <div className="empty">No demo submissions found. Follow the setup note above.</div> : <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Team</th><th>Project</th><th>Track</th><th>Status</th></tr></thead><tbody>
          {submissions.map((submission) => {
            const team = first(submission.teams);
            return <tr key={submission.id}><td>{submission.reference}</td><td>{team?.team_id} · {team?.team_name}</td><td>{submission.project_title}</td><td>{team?.track}</td><td><span className="status">{submission.status}</span></td></tr>;
          })}
        </tbody></table></div>}
      </section>}

      {tab === "evaluation" && <section className="panel">
        <div className="panel-header"><h2>Sample AI evaluation workflow</h2><span className="status">SIMULATED</span></div>
        <p className="muted">These stored preview scores are synthetic fixtures, not generated by the AI pipeline. Starting real evaluation is only available in AI Evaluation after submissions are frozen.</p>
        {!evaluations.length ? <div className="empty">No sample evaluations found. Follow the setup note above.</div> : <div className="table-wrap"><table><thead><tr><th>Team</th><th>Project</th><th>Preview score</th><th>Review status</th></tr></thead><tbody>
          {evaluations.map((evaluation) => {
            const submission = first(evaluation.submissions);
            const team = first(submission?.teams);
            return <tr key={evaluation.submission_uuid}><td>{team?.team_id} · {team?.team_name}</td><td>{submission?.project_title}</td><td><strong>{Number(evaluation.total_score).toFixed(1)} / 100</strong></td><td>{evaluation.manual_review ? "Manual review" : "Sample"}</td></tr>;
          })}
        </tbody></table></div>}
      </section>}

      {tab === "rankings" && <section className="panel">
        <div className="panel-header"><h2>Preview final rankings</h2><span className="status">NOT APPROVED</span></div>
        <p className="muted">Synthetic preview positions are not awards and have not been approved by an organizer. Use the real Final Rankings section for event decisions.</p>
        {!finals.length ? <div className="empty">No sample rankings found. Follow the setup note above.</div> : <div className="table-wrap"><table><thead><tr><th>Track</th><th>Position</th><th>Status</th><th>Reason</th></tr></thead><tbody>
          {finals.map((ranking) => <tr key={`${ranking.track}-${ranking.position}`}><td>{ranking.track}</td><td>{ranking.position}</td><td><span className="status">{ranking.status}</span></td><td>{ranking.decision_reason}</td></tr>)}
        </tbody></table></div>}
      </section>}
    </>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ArrowRight, ClipboardList, Flag, RefreshCw, Users, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type Summary = {
  teams: number;
  submitted: number;
  pending: number;
  evaluated: number;
  failed: number;
  manualReview: number;
  shortlisted: number;
  trackCounts: Record<string, number>;
  evaluation: { status: string; total: number; completed: number; queued: number; processing: number; failed: number } | null;
  recent: Array<{ id: string; project_title: string; reference: string; submitted_at: string; status: string; team_id: string; team_name: string; track: string }>;
};

const blank: Summary = { teams: 0, submitted: 0, pending: 0, evaluated: 0, failed: 0, manualReview: 0, shortlisted: 0, trackCounts: {}, evaluation: null, recent: [] };

export default function AdminDashboard() {
  const pathname = usePathname();
  const basePath = pathname.startsWith("/organizer") ? "/organizer" : "/admin";
  const [summary, setSummary] = useState<Summary>(blank);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setErrorMessage("");
    const supabase = createClient();
    const [teams, submissions, evaluated, failed, reports, recent, batch, shortlist, trackResults] = await Promise.all([
      supabase.from("teams").select("id", { count: "exact", head: true }).eq("is_demo", false),
      supabase.from("submissions").select("id", { count: "exact", head: true }).eq("is_demo", false),
      supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "evaluated").eq("is_demo", false),
      supabase.from("submissions").select("id", { count: "exact", head: true }).eq("status", "failed").eq("is_demo", false),
      supabase.from("ai_evaluations").select("id", { count: "exact", head: true }).eq("manual_review", true).eq("is_demo", false),
      supabase.from("submissions").select("id,project_title,reference,submitted_at,status,teams(team_id,team_name,track)").eq("is_demo", false).order("submitted_at", { ascending: false }).limit(6),
      supabase.from("evaluation_batches").select("status,total_jobs,queued_jobs,processing_jobs,completed_jobs,failed_jobs").eq("is_demo", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("shortlisted_teams").select("id", { count: "exact", head: true }).eq("is_demo", false),
      Promise.all(TRACKS.map((track) => supabase.from("submissions")
        .select("id,teams!inner(track)", { count: "exact", head: true })
        .eq("is_demo", false).eq("teams.is_demo", false).eq("teams.track", track)))
    ]);
    const failure = teams.error ?? submissions.error ?? evaluated.error ?? failed.error ?? reports.error ?? recent.error ?? batch.error ?? shortlist.error ?? trackResults.find((result) => result.error)?.error;
    if (failure) {
      setErrorMessage(failure.message);
      setLoading(false);
      return;
    }
    const trackCounts = Object.fromEntries(TRACKS.map((track, index) => [track, trackResults[index].count ?? 0]));
    const submittedCount = submissions.count ?? 0;
    setSummary({
      teams: teams.count ?? 0,
      submitted: submittedCount,
      pending: Math.max((teams.count ?? 0) - submittedCount, 0),
      evaluated: evaluated.count ?? 0,
      failed: failed.count ?? 0,
      manualReview: reports.count ?? 0,
      shortlisted: shortlist.count ?? 0,
      trackCounts,
      evaluation: batch.data ? {
        status: batch.data.status,
        total: batch.data.total_jobs,
        completed: batch.data.completed_jobs,
        queued: batch.data.queued_jobs,
        processing: batch.data.processing_jobs,
        failed: batch.data.failed_jobs
      } : null,
      recent: (recent.data ?? []).map((item) => {
        const team = Array.isArray(item.teams) ? item.teams[0] : item.teams;
        return { id: item.id, project_title: item.project_title, reference: item.reference, submitted_at: item.submitted_at, status: item.status, team_id: team?.team_id ?? "—", team_name: team?.team_name ?? "—", track: team?.track ?? "—" };
      })
    });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const percentage = summary.teams ? Math.round((summary.submitted / summary.teams) * 100) : 0;

  return (
    <>
      <div className="admin-title">
        <div><span className="eyebrow">Event overview</span><h1>Good work starts here.</h1><p>Live status of registered teams and project submissions.</p></div>
        <button className="button secondary small" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={13} /> Refresh data</button>
      </div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      <div className="stats-grid">
        {[
          { label: "Registered teams", value: summary.teams, note: "From the registration roster", Icon: Users },
          { label: "Total submissions", value: summary.submitted, note: `${percentage}% team completion`, Icon: ClipboardList },
          { label: "Pending submissions", value: summary.pending, note: "Registered teams without a submission", Icon: Flag },
          { label: "AI evaluations complete", value: summary.evaluated, note: `${summary.failed} failed · ${summary.manualReview} need review`, Icon: Activity },
          { label: "Shortlisted teams", value: summary.shortlisted, note: "Organizer recommendations and decisions", Icon: UsersRound },
          { label: "Evaluation batch", value: summary.evaluation ? `${summary.evaluation.completed}/${summary.evaluation.total}` : "—", note: summary.evaluation ? `${summary.evaluation.status} · ${summary.evaluation.queued + summary.evaluation.processing} pending` : "No evaluation batch yet", Icon: Activity }
        ].map(({ label, value, note, Icon }) => (
          <article className="stat-card" key={label}><span><Icon size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />{label}</span><strong>{loading ? "—" : String(value)}</strong><small>{note}</small></article>
        ))}
      </div>
      <section className="panel">
        <div className="panel-header"><h2>Submissions by track</h2><Link className="button ghost small" href={`${basePath}/leaderboards`}>View leaderboards <ArrowRight size={13} /></Link></div>
        <div className="dashboard-track-chart">{TRACKS.map((track) => {
          const count = summary.trackCounts[track] ?? 0;
          const maxCount = Math.max(...TRACKS.map((item) => summary.trackCounts[item] ?? 0), 1);
          return <div className="dashboard-track-row" key={track}><span>{track}</span><div className="dashboard-track-bar"><span style={{ width: `${(count / maxCount) * 100}%` }} /></div><strong>{loading ? "—" : count}</strong></div>;
        })}</div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Recent submissions</h2><Link className="button ghost small" href={`${basePath}/submissions`}>All submissions <ArrowRight size={13} /></Link></div>
        {loading ? <div className="loading">Loading live event data…</div> : summary.recent.length === 0 ? <div className="empty">No project submissions have been received yet.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Team</th><th>Project</th><th>Track</th><th>Status</th></tr></thead><tbody>
            {summary.recent.map((submission) => <tr key={submission.id}><td><strong>{submission.reference}</strong></td><td>{submission.team_id} · {submission.team_name}</td><td>{submission.project_title}</td><td>{submission.track}</td><td><span className="status">{submission.status}</span></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}

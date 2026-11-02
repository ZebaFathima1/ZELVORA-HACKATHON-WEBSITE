"use client";

import { Download, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type LeaderboardRow = {
  id: string;
  rank: number;
  score: number;
  submission_uuid: string;
  track: string;
  submissions: {
    reference: string;
    project_title: string;
    status: string;
    deployed_url: string | null;
    teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null;
  } | Array<{
    reference: string;
    project_title: string;
    status: string;
    deployed_url: string | null;
    teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null;
  }> | null;
  presentation_status?: string;
  github_status?: string;
  deployment_status?: string;
  manual_review?: boolean;
};

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default function LeaderboardsPage() {
  const [track, setTrack] = useState<string>("Overall");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase.from("leaderboards")
      .select("id,rank,score,submission_uuid,track,submissions(reference,project_title,status,deployed_url,teams(team_id,team_name))")
      .eq("is_demo", false)
      .order("rank", { ascending: true });
    if (track !== "Overall") query = query.eq("track", track);
    const { data, error } = await query;
    if (error) setErrorMessage(error.message);
    else {
      setErrorMessage("");
      const sorted = ((data ?? []) as LeaderboardRow[])
        .sort((left, right) => Number(right.score) - Number(left.score) || left.rank - right.rank)
        .slice(0, track === "Overall" ? 5 : 5);
      const ids = sorted.map((row) => row.submission_uuid);
      if (!ids.length) { setRows([]); setLoading(false); return; }
      const [presentations, repositories, evaluations] = await Promise.all([
        supabase.from("presentation_analyses").select("submission_uuid,extraction_status,manual_review").eq("is_demo", false).in("submission_uuid", ids),
        supabase.from("github_analyses").select("submission_uuid,accessible,manual_review").eq("is_demo", false).in("submission_uuid", ids),
        supabase.from("ai_evaluations").select("submission_uuid,manual_review").eq("is_demo", false).in("submission_uuid", ids)
      ]);
      const analysisError = presentations.error ?? repositories.error ?? evaluations.error;
      if (analysisError) setErrorMessage(analysisError.message);
      const presentationById = new Map((presentations.data ?? []).map((item) => [item.submission_uuid, item]));
      const githubById = new Map((repositories.data ?? []).map((item) => [item.submission_uuid, item]));
      const evaluationById = new Map((evaluations.data ?? []).map((item) => [item.submission_uuid, item]));
      setRows(sorted.map((row, index) => {
        const presentation = presentationById.get(row.submission_uuid);
        const github = githubById.get(row.submission_uuid);
        const evaluation = evaluationById.get(row.submission_uuid);
        const submission = first(row.submissions);
        return {
          ...row,
          rank: index + 1,
          presentation_status: presentation?.extraction_status ?? "pending",
          github_status: github ? (github.accessible ? "analyzed" : "unavailable") : "pending",
          deployment_status: submission?.deployed_url ? "not fetched (manual check)" : "not provided",
          manual_review: Boolean(presentation?.manual_review || github?.manual_review || evaluation?.manual_review)
        };
      }));
    }
    setLoading(false);
  }, [track]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  function exportCsv() {
    const csv = [
      ["Rank", "Team ID", "Team name", "Project", "Score", "Status"],
      ...rows.map((row) => {
        const submission = first(row.submissions);
        const team = first(submission?.teams);
        return [row.rank, team?.team_id, team?.team_name, submission?.project_title, row.score, submission?.status];
      })
    ].map((line) => line.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `zelvora-leaderboard-${track.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Live track rankings</span><h1>Leaderboards</h1><p>AI rankings update automatically. Organizers make all final award decisions.</p></div><button className="button secondary small" disabled={!rows.length} onClick={exportCsv}><Download size={13} /> Export CSV</button></div>
      <div className="notice-bar"><Trophy size={16} /><strong>LIVE AI EVALUATION — PROVISIONAL RANKINGS</strong><span>Only completed evaluations are shown. Rankings refresh every 5 seconds and are not final.</span></div>
      <div className="filters">{["Overall", ...TRACKS].map((item) => <button key={item} className={`button small ${track === item ? "" : "secondary"}`} onClick={() => setTrack(item)}>{item === "Overall" ? "Overall Top 5" : item}</button>)}</div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      <section className="panel">
        <div className="panel-header"><h2><Trophy size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />{track === "Overall" ? "Overall Top 5" : `${track} · Top 5`}</h2><span className="muted" style={{ fontSize: 11 }}>{rows.length} completed evaluations · refreshed every 5 seconds</span></div>
        {loading ? <div className="loading">Loading rankings…</div> : !rows.length ? <div className="empty">No evaluations are available for this track yet.</div> : <div className="table-wrap">
          <table><thead><tr><th>Rank</th><th>Team ID</th><th>Team name</th><th>Project</th><th>Track</th><th>AI score</th><th>Presentation</th><th>GitHub</th><th>Deployment</th><th>Status</th></tr></thead><tbody>
            {rows.map((row) => {
              const submission = first(row.submissions);
              const team = first(submission?.teams);
              return <tr key={row.id}><td><strong>#{row.rank}</strong></td><td>{team?.team_id ?? "—"}</td><td>{team?.team_name ?? "—"}</td><td>{submission?.project_title ?? "—"}</td><td>{row.track}</td><td><strong>{Number(row.score).toFixed(1)}</strong> / 100</td><td>{row.presentation_status}</td><td>{row.github_status}</td><td>{row.deployment_status}</td><td><span className="status">{row.manual_review ? "Manual review required" : "Completed · provisional"}</span></td></tr>;
            })}
          </tbody></table>
        </div>}
      </section>
      <div className="notice-bar">Tie-breaking policy: higher score first; exact ties are ordered by earlier submission timestamp, then Team ID alphabetically. AI rankings are recommendations only; winners remain an organizer decision.</div>
    </>
  );
}

"use client";

import { Check, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type ShortlistRow = {
  id: string;
  track: string;
  submission_uuid: string;
  position: number | null;
  status: string;
  reason: string | null;
  submissions: {
    project_title: string;
    reference: string;
    teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null;
  } | Array<{
    project_title: string;
    reference: string;
    teams: { team_id: string; team_name: string } | { team_id: string; team_name: string }[] | null;
  }> | null;
};

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default function ShortlistPage() {
  const [track, setTrack] = useState<string>(TRACKS[0]);
  const [limit, setLimit] = useState(10);
  const [rows, setRows] = useState<ShortlistRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [positions, setPositions] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient().from("shortlisted_teams")
      .select("id,track,submission_uuid,position,status,reason,submissions(project_title,reference,teams(team_id,team_name))")
      .eq("track", track).eq("is_demo", false).order("updated_at", { ascending: false });
    if (error) setErrorMessage(error.message);
    else {
      const current = (data ?? []) as ShortlistRow[];
      setRows(current);
      setPositions(Object.fromEntries(current.map((item) => [item.id, item.position === null ? "" : String(item.position)])));
      setErrorMessage("");
    }
    setLoading(false);
  }, [track]);

  useEffect(() => { void load(); }, [load]);

  async function recommend() {
    setLoading(true);
    setErrorMessage("");
    setMessage("");
    const supabase = createClient();
    const { data: leaders, error } = await supabase.from("leaderboards")
      .select("submission_uuid,rank")
      .eq("track", track).eq("is_demo", false)
      .order("rank", { ascending: true })
      .limit(limit);
    if (error) { setErrorMessage(error.message); setLoading(false); return; }
    if (!leaders?.length) { setErrorMessage("No evaluated teams are available to recommend."); setLoading(false); return; }
    const suggestions = leaders.map((item) => ({
      track,
      submission_uuid: item.submission_uuid,
      position: null,
      status: "recommended",
      reason: `AI-score ranking recommendation within the top ${limit}. Organizer review required.`,
      is_demo: false
    }));
    const { error: saveError } = await supabase.from("shortlisted_teams").upsert(suggestions, {
      onConflict: "track,submission_uuid,is_demo",
      ignoreDuplicates: true
    });
    if (saveError) setErrorMessage(saveError.message);
    else setMessage(`${leaders.length} shortlist recommendations added. Existing organizer decisions were preserved.`);
    await load();
  }

  async function decide(id: string, status: "approved" | "rejected") {
    const reason = window.prompt(`Reason for ${status === "approved" ? "approving" : "rejecting"} this recommendation:`);
    if (reason === null) return;
    const { data: { user } } = await createClient().auth.getUser();
    const { error } = await createClient().from("shortlisted_teams").update({
      status,
      reason: reason.trim() || `Organizer ${status} after review.`,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString()
    }).eq("id", id);
    if (error) setErrorMessage(error.message);
    else setMessage(`Recommendation ${status}. This does not declare a winner.`);
    await load();
  }

  async function savePosition(id: string) {
    const raw = positions[id]?.trim() ?? "";
    const position = raw ? Number(raw) : null;
    if (position !== null && (!Number.isInteger(position) || position < 1)) {
      setErrorMessage("Award position must be a positive whole number, or left blank.");
      return;
    }
    const { data: { user } } = await createClient().auth.getUser();
    const { error } = await createClient().from("shortlisted_teams").update({
      position,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString()
    }).eq("id", id);
    if (error) setErrorMessage(error.message);
    else setMessage(position === null ? "Award position cleared." : `Award position ${position} saved.`);
    await load();
  }

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Organizer decisions</span><h1>Shortlisting</h1><p>AI rankings can suggest candidates. Organizers approve or reject each recommendation.</p></div><button className="button secondary small" onClick={() => void load()}><RefreshCw size={13} /> Refresh</button></div>
      <div className="notice-bar">AI never automatically declares winners. Final winner and runner-up choices remain with event organizers; record a reason for each manual decision.</div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      {message && <div className="alert success">{message}</div>}
      <section className="panel">
        <div className="form-grid" style={{ alignItems: "end" }}>
          <div className="form-row"><label className="form-label" htmlFor="track">Track</label><select className="field" id="track" value={track} onChange={(event) => setTrack(event.target.value)}>{TRACKS.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="form-row"><label className="form-label" htmlFor="limit">Custom recommendation count</label><input id="limit" className="field" type="number" min={1} max={250} value={limit} onChange={(event) => setLimit(Math.min(250, Math.max(1, Number(event.target.value))))} /></div>
        </div>
        <div className="inline-actions shortlist-presets" aria-label="Recommendation count presets">
          {[10, 12, 15].map((count) => <button key={count} type="button" className={`button small ${limit === count ? "" : "secondary"}`} aria-pressed={limit === count} onClick={() => setLimit(count)}>Top {count}</button>)}
        </div>
        <button className="button" disabled={loading} onClick={recommend}>{loading ? <><LoaderCircle size={14} /> Loading…</> : "Refresh recommendations"}</button>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>{track} · {rows.length} shortlisted</h2></div>
        {loading ? <div className="loading">Loading shortlist…</div> : !rows.length ? <div className="empty">No shortlist recommendations have been created for this track.</div> : <div className="table-wrap">
          <table><thead><tr><th>Team</th><th>Project</th><th>Organizer status</th><th>Award position</th><th>Decision reason</th><th>Action</th></tr></thead><tbody>
            {rows.map((row) => {
              const submission = first(row.submissions);
              const team = first(submission?.teams);
              return <tr key={row.id}>
                <td><strong>{team?.team_id}</strong><br />{team?.team_name}</td>
                <td>{submission?.project_title}</td>
                <td><span className="status">{row.status}</span></td>
                <td><div className="inline-actions"><input className="field" aria-label={`Award position for ${team?.team_id}`} type="number" min="1" style={{ width: 78 }} value={positions[row.id] ?? ""} onChange={(event) => setPositions({ ...positions, [row.id]: event.target.value })} /><button className="button secondary small" onClick={() => void savePosition(row.id)}>Save</button></div></td>
                <td>{row.reason ?? "—"}</td>
                <td>{row.status === "recommended" ? <div className="inline-actions"><button className="button small" onClick={() => void decide(row.id, "approved")}><Check size={12} /> Approve</button><button className="button danger small" onClick={() => void decide(row.id, "rejected")}><X size={12} /> Reject</button></div> : "—"}</td>
              </tr>;
            })}
          </tbody></table>
        </div>}
      </section>
    </>
  );
}

"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type TeamRow = {
  id: string;
  team_id: string;
  team_name: string;
  team_leader: string;
  college: string;
  branch: string;
  track: string;
  team_members: Array<{ count: number }> | null;
};

export default function RegisteredTeamsPage() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await createClient()
      .from("teams")
      .select("id,team_id,team_name,team_leader,college,branch,track,team_members(count)")
      .eq("is_demo", false)
      .order("team_id");
    if (error) setErrorMessage(error.message);
    else {
      setErrorMessage("");
      setTeams((data ?? []) as TeamRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => teams.filter((team) => {
    const haystack = `${team.team_id} ${team.team_name} ${team.team_leader} ${team.college} ${team.branch}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (!track || track === team.track);
  }), [teams, query, track]);

  return (
    <>
      <div className="admin-title">
        <div><span className="eyebrow">Registration roster</span><h1>Registered teams</h1><p>Team records and assigned tracks from the Supabase registration roster.</p></div>
      </div>
      <div className="filters">
        <label className="team-search"><Search size={14} /><input className="field" aria-label="Search registered teams" placeholder="Search ID, team, leader, college…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="field" aria-label="Filter teams by track" value={track} onChange={(event) => setTrack(event.target.value)}><option value="">All tracks</option>{TRACKS.map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      <section className="panel">
        <div className="panel-header"><h2>{visible.length} registered team{visible.length === 1 ? "" : "s"}</h2><button className="button secondary small" onClick={() => void load()}>Refresh</button></div>
        {loading ? <div className="loading">Loading registered teams…</div> : !visible.length ? <div className="empty">No registered teams match this search.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Team ID</th><th>Team name</th><th>Team leader</th><th>College</th><th>Branch</th><th>Size</th><th>Track</th></tr></thead><tbody>
            {visible.map((team) => <tr key={team.id}><td><strong>{team.team_id}</strong></td><td>{team.team_name}</td><td>{team.team_leader}</td><td>{team.college}</td><td>{team.branch}</td><td>{team.team_members?.[0]?.count ?? 0}</td><td><span className="status">{team.track}</span></td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}

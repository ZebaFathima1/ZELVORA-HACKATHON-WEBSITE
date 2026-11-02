"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Download, FileUp, LoaderCircle, Search, X } from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { TRACKS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type SubmissionRow = {
  id: string;
  reference: string;
  project_title: string;
  status: string;
  submitted_at: string;
  github_url: string;
  deployed_url: string | null;
  manual_review: boolean;
  teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (rows.length < 2) throw new Error("The CSV must include a header and at least one team.");
  const headers = rows[0].map((header) => header.toLowerCase().replace(/^\uFEFF/, ""));
  const required = ["team_id", "team_name", "team_leader", "college", "branch", "track", "members"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing CSV columns: ${missing.join(", ")}.`);
  return rows.slice(1).map((cells) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    const members = String(record.members).split("|").map((name) => name.trim()).filter(Boolean);
    if (!members.some((name) => name.toLowerCase() === String(record.team_leader).toLowerCase())) members.unshift(String(record.team_leader));
    return {
      team_id: String(record.team_id).toUpperCase(),
      team_name: String(record.team_name),
      team_leader: String(record.team_leader),
      college: String(record.college),
      branch: String(record.branch),
      track: String(record.track),
      members: members.map((full_name, index) => ({ full_name, role: index === 0 ? "Team member" : null }))
    };
  });
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function SubmissionsPage() {
  const pathname = usePathname();
  const basePath = pathname.startsWith("/organizer") ? "/organizer" : "/admin";
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [track, setTrack] = useState("");
  const [status, setStatus] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("submissions")
      .select("id,reference,project_title,status,submitted_at,github_url,deployed_url,manual_review,teams(team_id,team_name,track)")
      .eq("is_demo", false)
      .order("submitted_at", { ascending: false });
    if (error) setImportError(error.message);
    else setRows((data ?? []) as SubmissionRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => rows.filter((item) => {
    const team = Array.isArray(item.teams) ? item.teams[0] : item.teams;
    const text = `${item.reference} ${item.project_title} ${team?.team_id ?? ""} ${team?.team_name ?? ""}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) && (!track || team?.track === track) && (!status || item.status === status);
  }), [rows, query, track, status]);

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError("");
    setImportMessage("");
    try {
      const csvRows = parseCsv(await file.text());
      const { data, error } = await createClient().rpc("import_registered_teams", { p_rows: csvRows });
      if (error) throw error;
      setImportMessage(`${data} registered teams were imported successfully.`);
      await load();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The team roster could not be imported.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  function exportCsv() {
    const header = ["Reference", "Team ID", "Team name", "Project", "Track", "Status", "Submitted at", "GitHub", "Deployed URL", "Manual review"];
    const lines = visible.map((item) => {
      const team = Array.isArray(item.teams) ? item.teams[0] : item.teams;
      return [item.reference, team?.team_id, team?.team_name, item.project_title, team?.track, item.status, item.submitted_at, item.github_url, item.deployed_url, item.manual_review];
    });
    const contents = [header, ...lines].map((line) => line.map(csvEscape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "zelvora-submissions.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="admin-title">
        <div><span className="eyebrow">Project records</span><h1>Submissions</h1><p>Search registered submissions, inspect evidence, and export the current results.</p></div>
        <div className="inline-actions"><button className="button secondary small" onClick={exportCsv} disabled={!visible.length}><Download size={13} /> Export CSV</button><button className="button small" onClick={() => { setShowImport(true); setImportError(""); setImportMessage(""); }}><FileUp size={13} /> Import teams</button></div>
      </div>
      <div className="filters">
        <label style={{ position: "relative" }}><Search size={14} style={{ position: "absolute", left: 11, top: 12, color: "#89968d" }} /><input className="field" style={{ paddingLeft: 32, minWidth: 240 }} aria-label="Search submissions" placeholder="Search ID, team, project…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select className="field" aria-label="Filter by track" value={track} onChange={(event) => setTrack(event.target.value)}><option value="">All tracks</option>{TRACKS.map((item) => <option key={item}>{item}</option>)}</select>
        <select className="field" aria-label="Filter by submission status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{["submitted", "queued", "evaluating", "evaluated", "failed"].map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      {importError && !showImport && <div className="alert error">{importError}</div>}
      <section className="panel">
        <div className="panel-header"><h2>{visible.length} submission{visible.length === 1 ? "" : "s"}</h2></div>
        {loading ? <div className="loading">Loading submissions…</div> : !visible.length ? <div className="empty">No submissions match these filters.</div> : <div className="table-wrap">
          <table><thead><tr><th>Reference</th><th>Team</th><th>Project</th><th>Track</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>
            {visible.map((item) => {
              const team = Array.isArray(item.teams) ? item.teams[0] : item.teams;
              return <tr key={item.id}><td><strong>{item.reference}</strong></td><td>{team?.team_id}<br /><span className="muted">{team?.team_name}</span></td><td>{item.project_title}</td><td>{team?.track}</td><td>{new Date(item.submitted_at).toLocaleDateString()}</td><td><span className="status">{item.status}</span>{item.manual_review && <span className="status" style={{ marginLeft: 5 }}>Review</span>}</td><td><Link className="button ghost small" href={`${basePath}/submissions/${item.id}`}>View</Link></td></tr>;
            })}
          </tbody></table>
        </div>}
      </section>
      {showImport && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowImport(false); }}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <div className="panel-header"><h2 id="import-title">Import registered teams</h2><button className="button ghost small" aria-label="Close import dialog" onClick={() => setShowImport(false)}><X size={15} /></button></div>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>Upload a UTF-8 CSV with these exact headers: <code>team_id,team_name,team_leader,college,branch,track,members</code>. Use a pipe (|) between member names. Track values must match the four event tracks. Imports are atomic; duplicate IDs reject the full file.</p>
          <div className="file-box"><label className="form-label" htmlFor="csv-import">Team roster CSV</label><input id="csv-import" className="field" type="file" accept=".csv,text/csv" onChange={importCsv} disabled={importing} /></div>
          {importing && <div className="alert info"><LoaderCircle size={14} /> Importing teams…</div>}
          {importError && <div className="alert error">{importError}</div>}
          {importMessage && <div className="alert success">{importMessage}</div>}
          <div className="form-actions"><span className="muted" style={{ fontSize: 10 }}>Maximum 500 teams per import.</span><button className="button secondary" onClick={() => setShowImport(false)}>Close</button></div>
        </section>
      </div>}
    </>
  );
}

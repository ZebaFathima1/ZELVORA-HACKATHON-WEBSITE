"use client";

import { AlertTriangle, CheckCircle2, FileSearch, Github, ShieldCheck, Trophy } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TRACKS, type Track } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type RelatedTeam = { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
type RelatedSubmission = {
  reference: string;
  project_title: string;
  teams: RelatedTeam;
} | {
  reference: string;
  project_title: string;
  teams: RelatedTeam;
}[] | null;

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function countItems(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function TeamProject({ submission }: { submission: RelatedSubmission }) {
  const project = first(submission);
  const team = first(project?.teams);
  return <>{team?.team_id ?? "—"} · {team?.team_name ?? "—"}<small className="muted" style={{ display: "block" }}>{project?.project_title ?? "—"} · {team?.track ?? "—"}</small></>;
}

type PresentationRow = {
  id: string;
  submission_uuid: string;
  extraction_status: string;
  parser: string | null;
  slide_count: number | null;
  analysis: Record<string, unknown>;
  missing_sections: unknown;
  unsupported_claims: unknown;
  contradictory_claims: unknown;
  manual_review: boolean;
  created_at: string;
  submissions: RelatedSubmission;
};

export function PresentationAnalysisPage() {
  const [rows, setRows] = useState<PresentationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("presentation_analyses")
      .select("id,submission_uuid,extraction_status,parser,slide_count,analysis,missing_sections,unsupported_claims,contradictory_claims,manual_review,created_at,submissions(reference,project_title,teams(team_id,team_name,track))")
      .eq("is_demo", false).order("created_at", { ascending: false }).limit(500);
    if (error) setErrorMessage(error.message);
    else { setErrorMessage(""); setRows((data ?? []) as PresentationRow[]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const completed = rows.filter((row) => row.extraction_status === "completed").length;
  const failed = rows.filter((row) => row.extraction_status !== "completed").length;

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Evidence extraction</span><h1>Presentation analysis</h1><p>PDF and PowerPoint extraction results and AI feedback. Presentation scores support the fixed rubric; they are not bonus points.</p></div><button className="button secondary small" onClick={() => void load()}>Refresh</button></div>
      <div className="stats-grid">
        {[["Presentations analyzed", rows.length], ["Text extracted", completed], ["Missing or unreadable", failed], ["Manual review", rows.filter((row) => row.manual_review).length]].map(([label, count]) => <article className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{String(count)}</strong></article>)}
      </div>
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      <section className="panel">
        <div className="panel-header"><h2><FileSearch size={16} /> Presentation reports</h2></div>
        {loading ? <div className="loading">Loading presentation analyses…</div> : !rows.length ? <div className="empty">No real submission presentation analyses have been saved.</div> : <div className="table-wrap">
          <table><thead><tr><th>Team / project</th><th>Status</th><th>Parser</th><th>Slides/pages</th><th>Quality</th><th>Review flags</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}><td><TeamProject submission={row.submissions} /></td><td><span className="status">{row.extraction_status}</span></td><td>{row.parser ?? "—"}</td><td>{row.slide_count ?? "—"}</td><td>{typeof row.analysis.presentation_quality_score === "number" ? `${row.analysis.presentation_quality_score}/100` : "Not scored"}</td><td>{row.manual_review ? "Manual review required" : "No flag"}<small className="muted" style={{ display: "block" }}>{list(row.missing_sections).length} missing sections · {countItems(row.unsupported_claims)} unsupported claims · {countItems(row.contradictory_claims)} contradictions</small></td></tr>)}
          </tbody></table>
        </div>}
      </section>
    </>
  );
}

type GithubRow = {
  id: string;
  submission_uuid: string;
  repository_url: string;
  accessible: boolean;
  languages: Record<string, number>;
  frameworks: unknown;
  architecture_observations: unknown;
  code_quality_score: number | null;
  implementation_completeness: number | null;
  strengths: unknown;
  weaknesses: unknown;
  security_observations: unknown;
  missing_functionality: unknown;
  manual_review: boolean;
  analyzed_at: string;
  submissions: RelatedSubmission;
};

export function GithubAnalysisPage() {
  const [rows, setRows] = useState<GithubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("github_analyses")
      .select("id,submission_uuid,repository_url,accessible,languages,frameworks,architecture_observations,code_quality_score,implementation_completeness,strengths,weaknesses,security_observations,missing_functionality,manual_review,analyzed_at,submissions(reference,project_title,teams(team_id,team_name,track))")
      .eq("is_demo", false).order("analyzed_at", { ascending: false }).limit(500);
    if (error) setErrorMessage(error.message);
    else { setErrorMessage(""); setRows((data ?? []) as GithubRow[]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const accessible = rows.filter((row) => row.accessible).length;
  const failed = rows.length - accessible;

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Static source inspection</span><h1>GitHub analysis</h1><p>Public repository metadata, selected source snippets, and implementation evidence. Submitted code is never executed.</p></div><button className="button secondary small" onClick={() => void load()}>Refresh</button></div>
      <div className="stats-grid">
        {[["Repositories analyzed", rows.length], ["Accessible repositories", accessible], ["Failed or unavailable", failed], ["Manual review", rows.filter((row) => row.manual_review).length]].map(([label, count]) => <article className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{String(count)}</strong></article>)}
      </div>
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      <section className="panel">
        <div className="panel-header"><h2><Github size={16} /> Repository reports</h2></div>
        {loading ? <div className="loading">Loading repository analyses…</div> : !rows.length ? <div className="empty">No real submission repositories have been analyzed.</div> : <div className="table-wrap">
          <table><thead><tr><th>Team / project</th><th>Repository</th><th>Access</th><th>Languages</th><th>Frameworks</th><th>Implementation</th><th>Code quality</th><th>Security / review</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}>
              <td><TeamProject submission={row.submissions} /></td>
              <td><a href={row.repository_url} target="_blank" rel="noreferrer">{row.repository_url}</a></td>
              <td>{row.accessible ? "Accessible" : "Unavailable"}</td>
              <td>{Object.keys(row.languages ?? {}).join(", ") || "Not detected"}</td>
              <td>{list(row.frameworks).join(", ") || "Not verified"}</td>
              <td>{row.implementation_completeness == null ? "Not scored" : `${row.implementation_completeness}/100`}</td>
              <td>{row.code_quality_score == null ? "Not scored" : `${row.code_quality_score}/15`}</td>
              <td>{list(row.security_observations).length} observations · {row.manual_review ? "Manual review" : "No flag"}</td>
            </tr>)}
          </tbody></table>
        </div>}
      </section>
    </>
  );
}

type ConsistencyRow = {
  id: string;
  submission_uuid: string;
  verified_claims: unknown;
  unsupported_claims: unknown;
  contradictions: unknown;
  unavailable_sources: unknown;
  manual_review: boolean;
  submissions: RelatedSubmission;
};

export function EvidenceVerificationPage() {
  const [rows, setRows] = useState<ConsistencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("evidence_consistency_checks")
      .select("id,submission_uuid,verified_claims,unsupported_claims,contradictions,unavailable_sources,manual_review,submissions(reference,project_title,teams(team_id,team_name,track))")
      .eq("is_demo", false).order("checked_at", { ascending: false }).limit(500);
    if (error) setErrorMessage(error.message);
    else { setErrorMessage(""); setRows((data ?? []) as ConsistencyRow[]); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const totals = rows.reduce((acc, row) => ({
    verified: acc.verified + countItems(row.verified_claims),
    unsupported: acc.unsupported + countItems(row.unsupported_claims),
    contradictions: acc.contradictions + countItems(row.contradictions),
    manual: acc.manual + (row.manual_review ? 1 : 0)
  }), { verified: 0, unsupported: 0, contradictions: 0, manual: 0 });

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Cross-source claims</span><h1>Evidence verification</h1><p>Cross-checks between submitted claims, presentation text, and safely inspected GitHub evidence.</p></div><button className="button secondary small" onClick={() => void load()}>Refresh</button></div>
      <div className="stats-grid">
        {[["Claims verified", totals.verified], ["Claims unsupported", totals.unsupported], ["Contradictions detected", totals.contradictions], ["Manual review required", totals.manual]].map(([label, count]) => <article className="stat-card" key={String(label)}><span>{String(label)}</span><strong>{String(count)}</strong></article>)}
      </div>
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      <section className="panel">
        <div className="panel-header"><h2><ShieldCheck size={16} /> Evidence consistency checks</h2></div>
        {loading ? <div className="loading">Loading evidence checks…</div> : !rows.length ? <div className="empty">No real submission evidence checks have been saved.</div> : <div className="table-wrap">
          <table><thead><tr><th>Team / project</th><th>Verified</th><th>Unsupported</th><th>Contradictions</th><th>Unavailable evidence</th><th>Review</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}><td><TeamProject submission={row.submissions} /></td><td>{countItems(row.verified_claims)}</td><td>{countItems(row.unsupported_claims)}</td><td>{countItems(row.contradictions)}</td><td>{list(row.unavailable_sources).join("; ") || "None"}</td><td>{row.manual_review ? "Required" : "Not flagged"}</td></tr>)}
          </tbody></table>
        </div>}
      </section>
    </>
  );
}

type Candidate = {
  submission_uuid: string;
  rank: number;
  score: number;
  track: string;
  submissions: RelatedSubmission;
};

type ManualReview = {
  submission_uuid: string;
  submissions: RelatedSubmission;
};

type FinalRanking = {
  id: string;
  position: number;
  decision_reason: string;
  status: "recommended" | "approved";
  submissions: RelatedSubmission;
};

export function FinalRankingsPage() {
  const [track, setTrack] = useState<Track>(TRACKS[0]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reasons, setReasons] = useState<string[]>([]);
  const [finalRows, setFinalRows] = useState<FinalRanking[]>([]);
  const [stagedRows, setStagedRows] = useState<FinalRanking[]>([]);
  const [manualReviews, setManualReviews] = useState<ManualReview[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const selectionTrack = useRef(track);
  const loadVersion = useRef(0);

  const load = useCallback(async () => {
    const requestVersion = ++loadVersion.current;
    setLoading(true);
    const supabase = createClient();
    const [leaderboardResult, finalsResult, reviewsResult, resolutionsResult] = await Promise.all([
      supabase.from("leaderboards")
        .select("submission_uuid,rank,score,track,submissions(reference,project_title,teams(team_id,team_name,track))")
        .eq("track", track).eq("is_demo", false).order("rank", { ascending: true }),
      supabase.from("final_rankings")
        .select("id,position,decision_reason,status,submissions(reference,project_title,teams(team_id,team_name,track))")
        .eq("track", track).eq("is_demo", false).order("position", { ascending: true }),
      supabase.from("ai_evaluations")
        .select("submission_uuid,submissions(reference,project_title,teams(team_id,team_name,track))")
        .eq("manual_review", true).eq("is_demo", false),
      supabase.from("manual_review_resolutions").select("submission_uuid")
    ]);
    const failure = leaderboardResult.error ?? finalsResult.error ?? reviewsResult.error ?? resolutionsResult.error;
    if (requestVersion !== loadVersion.current) return;
    if (failure) {
      setErrorMessage(failure.message);
      setLoading(false);
      return;
    }
    const rows = (leaderboardResult.data ?? []) as Candidate[];
    setCandidates(rows);
    const rankings = (finalsResult.data ?? []) as FinalRanking[];
    setFinalRows(rankings.filter((row) => row.status === "approved"));
    setStagedRows(rankings.filter((row) => row.status === "recommended"));
    const resolved = new Set((resolutionsResult.data ?? []).map((item) => item.submission_uuid));
    const pending = ((reviewsResult.data ?? []) as ManualReview[]).filter((item) => !resolved.has(item.submission_uuid));
    setManualReviews(pending);
    if (selectionTrack.current !== track) {
      selectionTrack.current = track;
      setSelectedIds(rows.slice(0, 5).map((row) => row.submission_uuid));
      setReasons(rows.slice(0, 5).map(() => ""));
    } else {
      setSelectedIds((current) => current.length ? current.filter((id) => rows.some((row) => row.submission_uuid === id)).slice(0, 5) : rows.slice(0, 5).map((row) => row.submission_uuid));
      setReasons((current) => current.length ? current : rows.slice(0, 5).map(() => ""));
    }
    setErrorMessage("");
    setLoading(false);
  }, [track]);

  useEffect(() => { void load(); }, [load]);

  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.submission_uuid, candidate])), [candidates]);

  function setSelected(index: number, id: string) {
    setSelectedIds((current) => current.map((item, position) => position === index ? id : item));
  }

  function setReason(index: number, value: string) {
    setReasons((current) => current.map((item, position) => position === index ? value : item));
  }

  async function resolveReview(event: FormEvent<HTMLFormElement>, submissionId: string) {
    event.preventDefault();
    const resolution = reviewReasons[submissionId]?.trim() ?? "";
    if (resolution.length < 8) {
      setErrorMessage("Enter a clear manual-review resolution of at least 8 characters.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    const { error } = await createClient().rpc("resolve_manual_review", { p_submission: submissionId, p_resolution: resolution });
    if (error) setErrorMessage(error.message);
    else {
      setMessage("Manual review resolution was recorded in the audit log.");
      await load();
    }
    setBusy(false);
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    if (!selectedIds.length || selectedIds.length > 5 || new Set(selectedIds).size !== selectedIds.length) {
      setErrorMessage("Choose between one and five distinct evaluated submissions.");
      return;
    }
    if (selectedIds.some((id, index) => (reasons[index]?.trim().length ?? 0) < 8)) {
      setErrorMessage("Enter a recorded decision reason of at least 8 characters for every position.");
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().rpc("approve_track_top_five", {
      p_track: track,
      p_rows: selectedIds.map((submission_uuid, index) => ({
        submission_uuid,
        decision_reason: reasons[index].trim()
      }))
    });
    if (error) setErrorMessage(error.message);
    else {
      setMessage(`${data} final ${track} ranking${data === 1 ? "" : "s"} approved and recorded.`);
      await load();
    }
    setBusy(false);
  }

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Organizer decision required</span><h1>Final rankings</h1><p>AI rankings are recommendations only. Each final position requires organizer approval and a recorded reason.</p></div><button className="button secondary small" onClick={() => void load()}>Refresh</button></div>
      <div className="notice-bar"><AlertTriangle size={16} /> Finalization is blocked until every eligible submission in the track is evaluated and material manual reviews are resolved.</div>
      {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
      {message && <div className="alert success" role="status">{message}</div>}
      <div className="filters">{TRACKS.map((item) => <button key={item} className={`button small ${track === item ? "" : "secondary"}`} onClick={() => setTrack(item)}>{item}</button>)}</div>
      <section className="panel">
        <div className="panel-header"><h2><Trophy size={16} /> AI-recommended {track} Top 5</h2><span className="status">PROVISIONAL</span></div>
        {loading ? <div className="loading">Loading recommendations…</div> : !candidates.length ? <div className="empty">No completed real evaluations are available for this track.</div> : <form onSubmit={approve}>
          <p className="muted">Select up to five evaluated teams, order them by award position, and record a reason for each organizer decision.</p>
          {Array.from({ length: Math.min(5, candidates.length) }, (_, index) => {
            const selected = selectedIds[index] ?? "";
            const candidate = candidateById.get(selected);
            return <div className="form-grid" key={`rank-${index}`} style={{ gridTemplateColumns: "minmax(240px,1fr) minmax(220px,1fr)", marginBottom: 10 }}>
              <label className="form-row"><span className="form-label">Position {index + 1}</span><select className="field" value={selected} onChange={(event) => setSelected(index, event.target.value)}>
                <option value="">Select an evaluated submission</option>
                {candidates.map((item) => {
                  const submission = first(item.submissions);
                  const team = first(submission?.teams);
                  return <option key={item.submission_uuid} value={item.submission_uuid}>{team?.team_id} · {team?.team_name} · {Number(item.score).toFixed(1)} points</option>;
                })}
              </select>{candidate && <small className="muted">{first(candidate.submissions)?.project_title}</small>}</label>
              <label className="form-row"><span className="form-label">Decision reason</span><input className="field" value={reasons[index] ?? ""} onChange={(event) => setReason(index, event.target.value)} placeholder="Why is this rank approved?" minLength={8} required /></label>
            </div>;
          })}
          <button className="button" type="submit" disabled={busy || !selectedIds.length}><CheckCircle2 size={15} />{busy ? "Saving decision…" : "Approve final ranking"}</button>
        </form>}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Staged recommendations · {track}</h2><span className="status">AWAITING APPROVAL</span></div>
        {!stagedRows.length ? <div className="empty">No final recommendations have been staged for this track.</div> : <div className="table-wrap"><table><thead><tr><th>Position</th><th>Team / project</th><th>Reason</th></tr></thead><tbody>
          {stagedRows.map((row) => <tr key={row.id}><td>#{row.position}</td><td><TeamProject submission={row.submissions} /></td><td>{row.decision_reason}</td></tr>)}
        </tbody></table></div>}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Approved final results · {track}</h2></div>
        {!finalRows.length ? <div className="empty">No final rankings have been approved for this track.</div> : <div className="table-wrap"><table><thead><tr><th>Position</th><th>Team / project</th><th>Organizer reason</th></tr></thead><tbody>
          {finalRows.map((row) => <tr key={row.id}><td>#{row.position}</td><td><TeamProject submission={row.submissions} /></td><td>{row.decision_reason}</td></tr>)}
        </tbody></table></div>}
      </section>
      <section className="panel">
        <div className="panel-header"><h2>Unresolved manual reviews</h2></div>
        {!manualReviews.length ? <div className="empty">No unresolved AI manual-review flags are available.</div> : manualReviews.map((review) => {
          const submission = first(review.submissions);
          const team = first(submission?.teams);
          return <form key={review.submission_uuid} onSubmit={(event) => void resolveReview(event, review.submission_uuid)} className="form-row">
            <label className="form-label">{team?.team_id} · {team?.team_name} · {submission?.project_title}</label>
            <div className="inline-actions"><input className="field" value={reviewReasons[review.submission_uuid] ?? ""} onChange={(event) => setReviewReasons((current) => ({ ...current, [review.submission_uuid]: event.target.value }))} placeholder="Describe the organizer's review resolution" minLength={8} required /><button className="button secondary small" type="submit" disabled={busy}>Record resolution</button></div>
          </form>;
        })}
      </section>
    </>
  );
}

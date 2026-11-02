"use client";

import { Printer, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RUBRIC } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

type ReportRow = {
  id: string;
  total_score: number;
  criteria: Record<string, { score: number; explanation: string; evidence: string[]; missing_evidence: string[] }>;
  strengths: string[];
  weaknesses: string[];
  innovation_assessment: string;
  technical_assessment: string;
  github_assessment: string;
  deployment_assessment: string;
  missing_information: string[];
  confidence: string;
  manual_review: boolean;
  evaluated_at: string;
  submissions: {
    id: string;
    reference: string;
    project_title: string;
    teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
  } | Array<{
    id: string;
    reference: string;
    project_title: string;
    teams: { team_id: string; team_name: string; track: string } | { team_id: string; team_name: string; track: string }[] | null;
  }> | null;
};

function first<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("ai_evaluations")
      .select("id,total_score,criteria,strengths,weaknesses,innovation_assessment,technical_assessment,github_assessment,deployment_assessment,missing_information,confidence,manual_review,evaluated_at,submissions(id,reference,project_title,teams(team_id,team_name,track))")
      .eq("is_demo", false)
      .order("total_score", { ascending: false });
    if (error) setErrorMessage(error.message);
    else {
      setErrorMessage("");
      const result = (data ?? []) as ReportRow[];
      setReports(result);
      setSelected((current) => current && result.some((item) => item.id === current) ? current : result[0]?.id ?? "");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => reports.filter((report) => {
    const submission = first(report.submissions);
    const team = first(submission?.teams);
    return `${submission?.reference} ${submission?.project_title} ${team?.team_id} ${team?.team_name}`.toLowerCase().includes(query.toLowerCase());
  }), [reports, query]);
  const report = reports.find((item) => item.id === selected);
  const submission = first(report?.submissions);
  const team = first(submission?.teams);

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">AI-generated reports</span><h1>Evaluation reports</h1><p>Evidence and missing information are shown alongside scores for human review.</p></div><button className="button secondary small" onClick={() => window.print()} disabled={!report}><Printer size={13} /> Print / save PDF</button></div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      <div className="form-grid" style={{ gridTemplateColumns: "minmax(230px, .75fr) 1.5fr", alignItems: "start" }}>
        <section className="panel">
          <label style={{ position: "relative", display: "block", marginBottom: 14 }}><Search size={14} style={{ position: "absolute", left: 10, top: 12, color: "#89968d" }} /><input className="field" style={{ paddingLeft: 31 }} placeholder="Find a team…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {filtered.map((item) => {
            const submission = first(item.submissions);
            const rowTeam = first(submission?.teams);
            return <button key={item.id} onClick={() => setSelected(item.id)} className="field" style={{ textAlign: "left", marginBottom: 8, cursor: "pointer", borderColor: item.id === selected ? "var(--green)" : undefined }}>
              <strong>{rowTeam?.team_id}</strong><br /><span className="muted">{submission?.project_title}</span><br /><span style={{ color: "var(--green)", fontWeight: 700 }}>{Number(item.total_score).toFixed(1)} / 100</span>
            </button>;
          })}
          {!filtered.length && <div className="empty">No reports found.</div>}
        </section>
        {report ? <article className="panel" id="evaluation-report">
          <div className="panel-header"><div><span className="eyebrow">{team?.track} · {submission?.reference}</span><h2 style={{ marginTop: 10 }}>{submission?.project_title}</h2><span className="muted" style={{ fontSize: 11 }}>{team?.team_id} · {team?.team_name}</span></div><div className="report-score">{Number(report.total_score).toFixed(1)}<small style={{ fontSize: 13 }}>/100</small></div></div>
          <div className="inline-actions" style={{ marginBottom: 18 }}><span className="status">Confidence: {report.confidence}</span>{report.manual_review && <span className="status">Manual review required</span>}<span className="muted" style={{ fontSize: 10 }}>Evaluated {new Date(report.evaluated_at).toLocaleString()}</span></div>
          {RUBRIC.map((criterion) => {
            const item = report.criteria?.[criterion.key];
            return <section className="form-row" key={criterion.key}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, marginBottom: 7 }}><strong>{criterion.label}</strong><strong>{item?.score ?? 0} / {criterion.max}</strong></div>
              <div className="score-bar"><span style={{ width: `${Math.min(100, ((item?.score ?? 0) / criterion.max) * 100)}%` }} /></div>
              <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>{item?.explanation}</p>
              {!!item?.evidence?.length && <p style={{ fontSize: 10, lineHeight: 1.7 }}><strong>Evidence:</strong> {item.evidence.join(" · ")}</p>}
              {!!item?.missing_evidence?.length && <p style={{ fontSize: 10, lineHeight: 1.7, color: "var(--danger)" }}><strong>Not verified:</strong> {item.missing_evidence.join(" · ")}</p>}
            </section>;
          })}
          <h3 style={{ fontSize: 14 }}>Assessment</h3>
          {[["Strengths", report.strengths], ["Areas to improve", report.weaknesses], ["Missing information", report.missing_information]].map(([label, items]) => <div key={String(label)} className="form-row"><strong style={{ fontSize: 11 }}>{String(label)}</strong><ul className="member-list">{(items as string[]).map((text, index) => <li key={`${label}-${index}`}>{text}</li>)}</ul></div>)}
          <h3 style={{ fontSize: 14 }}>Evidence review</h3>
          {[["Innovation", report.innovation_assessment], ["Technical", report.technical_assessment], ["GitHub", report.github_assessment], ["Deployment", report.deployment_assessment]].map(([label, content]) => <p key={String(label)} style={{ fontSize: 11, lineHeight: 1.6 }}><strong>{String(label)}: </strong>{String(content)}</p>)}
          <div className="notice-bar">AI-generated assessments are advisory and must be reviewed by event organizers before awards are determined.</div>
        </article> : <div className="panel empty">No evaluation reports are available yet.</div>}
      </div>
    </>
  );
}

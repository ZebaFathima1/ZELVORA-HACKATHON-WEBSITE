"use client";

import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type SubmissionDetail = {
  id: string;
  reference: string;
  project_title: string;
  project_data: Record<string, string>;
  github_url: string;
  deployed_url: string | null;
  demo_video_url: string | null;
  deployment_exception: string | null;
  status: string;
  submitted_at: string;
  manual_review: boolean;
};

const fieldLabels: Record<string, string> = {
  problem_statement: "Problem statement",
  problem_description: "Problem description",
  proposed_solution: "Proposed solution",
  objectives: "Objectives",
  innovation: "Innovation",
  technical_implementation: "Technical implementation",
  technologies: "Technologies",
  real_world_applications: "Real-world applications",
  expected_impact: "Expected impact"
};

export default function SubmissionDetailPage() {
  const params = useParams<{ id?: string; section?: string[] }>();
  const pathname = usePathname();
  const basePath = pathname.startsWith("/organizer") ? "/organizer" : "/admin";
  const submissionId = params.id ?? params.section?.[1];
  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [team, setTeam] = useState<Record<string, unknown> | null>(null);
  const [members, setMembers] = useState<Array<Record<string, string>>>([]);
  const [files, setFiles] = useState<Array<Record<string, unknown>>>([]);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function load() {
      if (!submissionId) { setErrorMessage("Submission ID is missing from this URL."); return; }
      const supabase = createClient();
      const { data: item, error } = await supabase.from("submissions").select("*").eq("id", submissionId).eq("is_demo", false).maybeSingle();
      if (error || !item) { setErrorMessage(error?.message ?? "Submission not found."); return; }
      setSubmission(item as SubmissionDetail);
      const [teamResult, fileResult] = await Promise.all([
        supabase.from("teams").select("*").eq("id", item.team_uuid).eq("is_demo", false).single(),
        supabase.from("submission_files").select("*").eq("submission_uuid", item.id).eq("is_demo", false)
      ]);
      if (teamResult.error) setErrorMessage(teamResult.error.message);
      else {
        setTeam(teamResult.data);
        const memberResult = await supabase.from("team_members").select("*").eq("team_uuid", item.team_uuid).eq("is_demo", false);
        if (memberResult.error) setErrorMessage(memberResult.error.message);
        setMembers((memberResult.data ?? []) as Array<Record<string, string>>);
      }
      if (fileResult.error) setErrorMessage(fileResult.error.message);
      else setFiles((fileResult.data ?? []) as Array<Record<string, unknown>>);
    }
    void load();
  }, [submissionId]);

  async function download(path: string, name: string) {
    const { data, error } = await createClient().storage.from("submission-files").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) { setErrorMessage(error?.message ?? "Could not create a private download link."); return; }
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.download = name;
    link.rel = "noopener noreferrer";
    link.click();
  }

  if (errorMessage && !submission) return <><Link className="button ghost small" href={`${basePath}/submissions`}><ArrowLeft size={14} /> Submissions</Link><div className="alert error">{errorMessage}</div></>;
  if (!submission || !team) return <div className="loading">Loading submission details…</div>;
  return (
    <>
      <Link className="button ghost small" href={`${basePath}/submissions`}><ArrowLeft size={14} /> All submissions</Link>
      <div className="admin-title" style={{ marginTop: 22 }}><div><span className="eyebrow">{submission.reference} · {String(team.team_id)}</span><h1>{submission.project_title}</h1><p>{String(team.team_name)} · {String(team.track)} · Submitted {new Date(submission.submitted_at).toLocaleString()}</p></div><span className="status">{submission.status}</span></div>
      {errorMessage && <div className="alert error">{errorMessage}</div>}
      <section className="panel"><div className="panel-header"><h2>Registered team</h2></div><div className="info-grid">
        {["team_id", "team_name", "team_leader", "college", "branch", "track"].map((key) => <div className="info-cell" key={key}><small>{key.replaceAll("_", " ")}</small><strong>{String(team[key] ?? "—")}</strong></div>)}
      </div><strong style={{ fontSize: 12 }}>Team members</strong><ul className="member-list">{members.map((member, index) => <li key={`${member.full_name}-${index}`}>{member.full_name}{member.member_role ? ` · ${member.member_role}` : ""}{member.email ? ` · ${member.email}` : ""}</li>)}</ul></section>
      <section className="panel"><div className="panel-header"><h2>Project information</h2></div>
        {Object.entries(submission.project_data).map(([key, value]) => <div className="form-row" key={key}><strong style={{ fontSize: 12 }}>{fieldLabels[key] ?? key}</strong><p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.7 }}>{value}</p></div>)}
        <div className="inline-actions">{[[submission.github_url, "GitHub repository"], [submission.deployed_url, "Deployed application"], [submission.demo_video_url, "Demo video"]].filter((item) => item[0]).map(([url, label]) => <a key={String(label)} className="button secondary small" href={String(url)} target="_blank" rel="noopener noreferrer">{String(label)} <ExternalLink size={12} /></a>)}</div>
        {submission.deployment_exception && <div className="alert info">Deployment exception: {submission.deployment_exception}</div>}
      </section>
      <section className="panel"><div className="panel-header"><h2>Submitted files</h2></div>
        {!files.length ? <div className="empty">No files attached.</div> : files.map((file) => <div className="receipt-line" key={String(file.id)}><span><FileText size={13} style={{ verticalAlign: "middle", marginRight: 6 }} />{String(file.original_name)} · {String(file.file_kind)}</span><button className="button secondary small" onClick={() => void download(String(file.storage_path), String(file.original_name))}><Download size={12} /> Download</button></div>)}
      </section>
    </>
  );
}

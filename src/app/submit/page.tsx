"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LoaderCircle, Printer, UploadCloud } from "lucide-react";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getFunctionErrorMessage } from "@/lib/supabase/function-error";
import { MAX_FILE_BYTES, REQUIRED_UPLOAD_TYPES } from "@/lib/constants";
import type { Team } from "@/lib/types";
import { projectDetailsSchema, projectSchema } from "@/lib/validation";
import { ThemeToggle } from "@/app/theme-toggle";

type Verification = {
  team: Team;
  submission: { id?: string; reference: string; project_title: string; submitted_at: string } | null;
  can_submit: boolean;
  submission_message: string | null;
};

const projectFields = [
  ["problem_statement", "Problem statement", "What specific problem are you solving?", "short"],
  ["problem_description", "Detailed problem description", "Describe the context, who experiences this problem, and why it matters.", "long"],
  ["proposed_solution", "Proposed solution", "Explain how your project addresses the problem.", "long"],
  ["objectives", "Project objectives", "What outcomes did your team set out to achieve?", "long"],
  ["innovation", "Innovation and uniqueness", "What is new, different, or especially thoughtful about your approach?", "long"],
  ["technical_implementation", "Technical implementation", "Describe your architecture, core components, and implementation.", "long"],
  ["technologies", "Technologies used", "List your languages, frameworks, services, and tools.", "short"],
  ["real_world_applications", "Real-world applications", "Where and how could this project be used?", "long"],
  ["expected_impact", "Expected impact", "Describe the expected outcomes or measurable impact.", "long"]
] as const;

const emptyValues: Record<string, string> = Object.fromEntries(projectFields.map(([key]) => [key, ""]));

function TeamDetails({ team }: { team: Team }) {
  return (
    <div className="info-grid">
      {[
        ["Team ID", team.team_id], ["Team name", team.team_name], ["Team leader", team.team_leader],
        ["College", team.college], ["Branch", team.branch], ["Assigned track", team.track], ["Team size", String(team.team_size)]
      ].map(([label, value]) => <div className="info-cell" key={label}><small>{label}</small><strong>{value}</strong></div>)}
      <div className="info-cell"><small>Registered members</small><ul className="member-list">{(team.members ?? []).map((member, index) => <li key={`${member.full_name}-${index}`}>{member.full_name}{member.role ? ` · ${member.role}` : ""}</li>)}</ul></div>
    </div>
  );
}

export default function SubmitPage() {
  const [teamId, setTeamId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(emptyValues);
  const [githubUrl, setGithubUrl] = useState("");
  const [deployedUrl, setDeployedUrl] = useState("");
  const [demoVideoUrl, setDemoVideoUrl] = useState("");
  const [deploymentException, setDeploymentException] = useState("");
  const [presentation, setPresentation] = useState<File | null>(null);
  const [architecture, setArchitecture] = useState<File | null>(null);
  const [documentation, setDocumentation] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState<{ reference: string; projectTitle: string; submittedAt: string } | null>(null);

  async function verifyTeam(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");
    try {
      const { data, error } = await createClient().functions.invoke("verify-team", {
        body: { team_id: teamId.trim().toUpperCase() }
      });
      if (error) {
        throw new Error(await getFunctionErrorMessage(error));
      }
      setVerification(data as Verification);
      setStep(0);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Team verification failed.");
    } finally {
      setBusy(false);
    }
  }

  function validateStep(target: number) {
    setErrorMessage("");
    if (target === 2) {
      const parsed = projectDetailsSchema.safeParse(values);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = projectFields.find(([key]) => key === issue.path[0]);
        setErrorMessage(field ? `Please check “${field[1]}”: ${issue.message}` : issue.message);
        return false;
      }
    }
    if (target === 3) {
      const parsed = projectSchema.safeParse({
        ...values, github_url: githubUrl, deployed_url: deployedUrl, demo_video_url: demoVideoUrl,
        deployment_exception: deploymentException, confirmed: true
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = projectFields.find(([key]) => key === issue.path[0]);
        setErrorMessage(field ? `Please check “${field[1]}”: ${issue.message}` : issue.message);
        return false;
      }
      if (!githubUrl) { setErrorMessage("A valid GitHub repository URL is required."); return false; }
      if (presentation && (!REQUIRED_UPLOAD_TYPES.includes(presentation.type) || presentation.size > MAX_FILE_BYTES)) {
        setErrorMessage("The presentation must be a supported PDF, PPT, PPTX, PNG, or JPG file under 20 MB.");
        return false;
      }
      if (!presentation) {
        setErrorMessage("A project presentation is required.");
        return false;
      }
      for (const file of [architecture, documentation]) {
        if (file && (!REQUIRED_UPLOAD_TYPES.includes(file.type) || file.size > MAX_FILE_BYTES)) {
          setErrorMessage("Each file must be a supported PDF, PPT, PPTX, PNG, or JPG file under 20 MB.");
          return false;
        }
      }
    }
    setStep(target);
    return true;
  }

  async function submitProject() {
    if (!verification || !confirmed) return;
    setBusy(true);
    setErrorMessage("");
    setProgress(0);
    const form = new FormData();
    form.set("team_id", verification.team.team_id);
    form.set("project_title", values.project_title);
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    form.set("github_url", githubUrl);
    form.set("deployed_url", deployedUrl);
    form.set("demo_video_url", demoVideoUrl);
    form.set("deployment_exception", deploymentException);
    form.set("confirmed", "true");
    if (presentation) form.set("presentation", presentation);
    if (architecture) form.set("architecture", architecture);
    if (documentation) form.set("documentation", documentation);

    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/submit-project`;
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseKey) {
      setErrorMessage("Submission is unavailable until Supabase is configured.");
      setBusy(false);
      return;
    }
    xhr.setRequestHeader("apikey", supabaseKey);
    xhr.setRequestHeader("Authorization", `Bearer ${supabaseKey}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setBusy(false);
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(xhr.responseText); } catch { payload = {}; }
      if (xhr.status >= 200 && xhr.status < 300 && typeof payload.reference === "string" && typeof payload.submitted_at === "string") {
        setSuccess({ reference: payload.reference, projectTitle: values.project_title, submittedAt: payload.submitted_at });
      } else if (xhr.status === 409 && typeof payload.submission === "object" && payload.submission) {
        const existing = payload.submission as Verification["submission"];
        if (existing) {
          setVerification((current) => current ? {
            ...current,
            submission: existing,
            submission_message: String(payload.error ?? "Your team has already submitted its project. Multiple submissions are not allowed.")
          } : current);
        }
      } else {
        setErrorMessage(String(payload.error ?? "Submission could not be completed. Please try again."));
      }
    };
    xhr.onerror = () => {
      setBusy(false);
      setErrorMessage("Network error while submitting. Check your connection and try again.");
    };
    xhr.send(form);
  }

  const stepTitles = ["Team", "Project", "Files & links", "Review"];
  return (
    <main className="portal-wrap">
      <div className="container">
        <div className="portal-header">
          <Link className="brand" href="/"><span className="brand-mark">Z</span><span>ZELVORA<small>HACKATHON PORTAL</small></span></Link>
          <div className="inline-actions"><ThemeToggle /><Link href="/" className="muted" style={{ fontSize: 12 }}>Back to home</Link></div>
        </div>
        {success ? (
          <section className="portal-card" id="print-receipt">
            <div className="success-mark"><CheckCircle2 size={26} /></div>
            <span className="eyebrow" style={{ marginTop: 24 }}>Submission received</span>
            <h1>Your work is in.</h1>
            <p>Your team’s final project has been securely submitted. Keep this reference for your records.</p>
            <div className="receipt">
              <div className="receipt-line"><span>Submission reference</span><strong>{success.reference}</strong></div>
              <div className="receipt-line"><span>Team ID</span><strong>{verification?.team.team_id}</strong></div>
              <div className="receipt-line"><span>Project title</span><strong>{success.projectTitle}</strong></div>
              <div className="receipt-line"><span>Submitted</span><strong>{new Date(success.submittedAt).toLocaleString()}</strong></div>
            </div>
            <div className="alert success">Your submission is now read-only. Multiple submissions are not allowed.</div>
            <button className="button secondary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>
          </section>
        ) : !verification ? (
          <section className="portal-card">
            <span className="eyebrow">Participant portal</span>
            <h1>Find your team.</h1>
            <p>Enter the Team ID provided during registration. Your team profile and assigned track will be confirmed before you begin.</p>
            <form onSubmit={verifyTeam}>
              <div className="form-row">
                <label className="form-label" htmlFor="team-id">Team ID</label>
                <input id="team-id" className="field" placeholder="e.g. ZYL001" value={teamId} onChange={(event) => setTeamId(event.target.value)} required autoComplete="off" />
              </div>
              {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
              <button className="button" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" /> Verifying…</> : <>Verify team <ArrowRight size={15} /></>}</button>
            </form>
            <div className="notice-bar" style={{ marginTop: 24 }}>Team ID access is designed for this event’s registration flow. A Team ID is not a strong secret; please do not share it publicly. The platform is prepared for a future private submission token.</div>
          </section>
        ) : verification.submission ? (
          <section className="portal-card">
            <span className="eyebrow">Submission locked</span>
            <h1>Your team has already submitted.</h1>
            <p>{verification.submission_message ?? "Your team has already submitted its project. Multiple submissions are not allowed."}</p>
            <div className="receipt">
              <div className="receipt-line"><span>Submission reference</span><strong>{verification.submission.reference}</strong></div>
              <div className="receipt-line"><span>Project title</span><strong>{verification.submission.project_title}</strong></div>
              <div className="receipt-line"><span>Team ID</span><strong>{verification.team.team_id}</strong></div>
              <div className="receipt-line"><span>Submitted</span><strong>{new Date(verification.submission.submitted_at).toLocaleString()}</strong></div>
            </div>
            <button className="button secondary" onClick={() => window.print()}><Printer size={15} /> Print receipt</button>
          </section>
        ) : (
          <section className="portal-card">
            <span className="eyebrow">Final project submission</span>
            <h1>{step === 0 ? "Confirm your team." : step === 1 ? "Tell us about your project." : step === 2 ? "Add your project links." : "One last review."}</h1>
            <p>{step === 0 ? "Please verify these details are correct before proceeding. Registered information cannot be changed here." : "A single, final submission is allowed for each registered team."}</p>
            <div className="steps-progress" aria-label={`Step ${step + 1} of 4`}>
              {stepTitles.map((title, index) => <div className={`progress-segment ${index <= step ? "active" : ""}`} key={title} title={title} />)}
            </div>
            <div className="progress-labels">{stepTitles.map((title) => <span key={title}>{title}</span>)}</div>
            {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
            {step === 0 && <>
              <TeamDetails team={verification.team} />
              {!verification.can_submit && <div className="alert info">The submission window is currently closed. Your registered team is valid, but submission is not available at this time.</div>}
            </>}
            {step === 1 && <>
              <div className="form-row"><label className="form-label" htmlFor="project_title">Project title *</label><input id="project_title" className="field" value={values.project_title} maxLength={160} onChange={(event) => setValues({ ...values, project_title: event.target.value })} placeholder="A clear, memorable project name" /></div>
              {projectFields.map(([key, label, placeholder, type]) => (
                <div className="form-row" key={key}>
                  <label className="form-label" htmlFor={key}>{label} *</label>
                  {type === "long"
                    ? <textarea id={key} className="field" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} placeholder={placeholder} maxLength={8000} />
                    : <input id={key} className="field" value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.target.value })} placeholder={placeholder} maxLength={1000} />}
                </div>
              ))}
            </>}
            {step === 2 && <>
              <div className="form-row"><label className="form-label" htmlFor="github">GitHub repository URL *</label><input id="github" className="field" type="url" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/team/project" /></div>
              <div className="form-row"><label className="form-label" htmlFor="deployed">Deployed application URL</label><input id="deployed" className="field" type="url" value={deployedUrl} onChange={(event) => setDeployedUrl(event.target.value)} placeholder="https://your-project.example" /></div>
              {!deployedUrl && <div className="form-row"><label className="form-label" htmlFor="deployment-exception">Why can’t the project reasonably be deployed? *</label><textarea id="deployment-exception" className="field" value={deploymentException} onChange={(event) => setDeploymentException(event.target.value)} placeholder="Explain any practical or technical constraints (at least 20 characters)." /></div>}
              <div className="form-row"><label className="form-label" htmlFor="video">Video demonstration URL (optional)</label><input id="video" className="field" type="url" value={demoVideoUrl} onChange={(event) => setDemoVideoUrl(event.target.value)} placeholder="https://…" /></div>
              {[
                { key: "presentation", label: "Project presentation *", file: presentation, setFile: setPresentation },
                { key: "architecture", label: "Architecture diagram (optional)", file: architecture, setFile: setArchitecture },
                { key: "documentation", label: "Additional documentation (optional)", file: documentation, setFile: setDocumentation }
              ].map(({ key, label, file, setFile }) => (
                <div className="file-box" key={key}>
                  <label className="form-label" htmlFor={key}><UploadCloud size={14} style={{ verticalAlign: "middle", marginRight: 5 }} />{label}</label>
                  <input id={key} className="field" type="file" accept=".pdf,.ppt,.pptx,.png,.jpg,.jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                  <small>{file ? `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB` : "PDF, PPT, PPTX, PNG, JPG · up to 20 MB"}</small>
                </div>
              ))}
            </>}
            {step === 3 && <>
              <div className="info-grid">
                <div className="info-cell"><small>Team</small><strong>{verification.team.team_name} · {verification.team.team_id}</strong></div>
                <div className="info-cell"><small>Track</small><strong>{verification.team.track}</strong></div>
                <div className="info-cell"><small>Project</small><strong>{values.project_title}</strong></div>
                <div className="info-cell"><small>GitHub</small><strong style={{ overflowWrap: "anywhere" }}>{githubUrl}</strong></div>
                <div className="info-cell"><small>Presentation</small><strong>{presentation?.name}</strong></div>
                <div className="info-cell"><small>Deployment</small><strong>{deployedUrl || "Manual review requested"}</strong></div>
              </div>
              <details><summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Review project description</summary><div style={{ marginTop: 12 }}>{projectFields.map(([key, label]) => <p key={key} style={{ fontSize: 12, lineHeight: 1.65 }}><strong>{label}: </strong>{values[key]}</p>)}</div></details>
              <label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm that all submitted information is accurate and that this is my team&apos;s final project submission.</span></label>
              <div className="alert info">After successful submission, the project is read-only. You will not be able to edit or resubmit it.</div>
              {busy && <div className="alert info">Uploading and saving: {progress}%</div>}
            </>}
            <div className="form-actions">
              {step === 0 ? <Link className="button secondary" href="/"><ArrowLeft size={15} /> Cancel</Link> : <button className="button secondary" onClick={() => { setErrorMessage(""); setStep(step - 1); }}><ArrowLeft size={15} /> Back</button>}
              {step < 3
                ? <button className="button" disabled={step === 0 && !verification.can_submit} onClick={() => validateStep(step + 1)}>Continue <ArrowRight size={15} /></button>
                : <button className="button" disabled={busy || !confirmed} onClick={submitProject}>{busy ? <><LoaderCircle size={15} /> Submitting…</> : <><Check size={15} /> Submit final project</>}</button>}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

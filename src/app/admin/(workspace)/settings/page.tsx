"use client";

import { LoaderCircle, Save } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Settings = { opens_at: string | null; deadline_at: string | null; submissions_enabled: boolean; frozen: boolean };

function toLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ opens_at: null, deadline_at: null, submissions_enabled: false, frozen: false });
  const [opensAt, setOpensAt] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data, error } = await createClient().from("event_settings").select("opens_at,deadline_at,submissions_enabled,frozen").eq("id", true).single();
      if (error) setErrorMessage(error.message);
      else {
        setSettings(data);
        setOpensAt(toLocal(data.opens_at));
        setDeadlineAt(toLocal(data.deadline_at));
        setEnabled(data.submissions_enabled);
        setFrozen(data.frozen);
      }
      setLoading(false);
    }
    void load();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    const opens = opensAt ? new Date(opensAt) : null;
    const deadline = deadlineAt ? new Date(deadlineAt) : null;
    if (opens && deadline && deadline <= opens) {
      setErrorMessage("The submission deadline must be later than the opening date.");
      setBusy(false);
      return;
    }
    const { data: auth } = await createClient().auth.getUser();
    const updated = {
      opens_at: opens?.toISOString() ?? null,
      deadline_at: deadline?.toISOString() ?? null,
      submissions_enabled: enabled,
      frozen,
      updated_at: new Date().toISOString(),
      updated_by: auth.user?.id
    };
    const { error } = await createClient().from("event_settings").update(updated).eq("id", true);
    if (error) setErrorMessage(error.message);
    else {
      setSettings(updated);
      setMessage("Event settings saved. The change was written to the audit log.");
    }
    setBusy(false);
  }

  async function quickAction(action: "open" | "freeze" | "reopen" | "disable") {
    if (action === "freeze" && !window.confirm("Freeze all submissions? Participants will be unable to submit until reopened.")) return;
    if (action === "reopen" && !window.confirm("Reopen submissions? The event deadline will still be enforced.")) return;
    if (action === "open" && !window.confirm("Enable submissions now? Configured opening and deadline times still apply.")) return;
    const nextEnabled = action === "open" || action === "reopen" ? true
      : action === "disable" ? false : enabled;
    const nextFrozen = action === "freeze" ? true
      : action === "open" || action === "reopen" ? false : frozen;
    const patch = { submissions_enabled: nextEnabled, frozen: nextFrozen };
    setBusy(true);
    setErrorMessage("");
    const { data: auth } = await createClient().auth.getUser();
    const { error } = await createClient().from("event_settings").update({ ...patch, updated_at: new Date().toISOString(), updated_by: auth.user?.id }).eq("id", true);
    if (error) setErrorMessage(error.message);
    else {
      setEnabled(nextEnabled);
      setFrozen(nextFrozen);
      setSettings((current) => ({ ...current, ...patch }));
      setMessage("Submission controls updated and recorded in the audit log.");
    }
    setBusy(false);
  }

  return (
    <>
      <div className="admin-title"><div><span className="eyebrow">Event configuration</span><h1>Submission settings</h1><p>Submission eligibility is checked by the database at the moment each submission is saved.</p></div></div>
      {loading ? <div className="loading">Loading event settings…</div> : <>
        {errorMessage && <div className="alert error">{errorMessage}</div>}
        {message && <div className="alert success">{message}</div>}
        <section className="panel">
          <div className="panel-header"><h2>Submission window</h2><span className="status">{settings.frozen ? "Frozen" : settings.submissions_enabled ? "Enabled" : "Disabled"}</span></div>
          <form onSubmit={save}>
            <div className="form-grid">
              <div className="form-row"><label className="form-label" htmlFor="opens-at">Opening date and time</label><input className="field" id="opens-at" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} /></div>
              <div className="form-row"><label className="form-label" htmlFor="deadline-at">Submission deadline</label><input className="field" id="deadline-at" type="datetime-local" value={deadlineAt} onChange={(event) => setDeadlineAt(event.target.value)} /></div>
            </div>
            <label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Enable participant submissions. Opening/deadline limits still apply.</span></label>
            <label className="check-row"><input type="checkbox" checked={frozen} onChange={(event) => setFrozen(event.target.checked)} /><span>Freeze submissions. Use this when creating an evaluation snapshot.</span></label>
            <button type="submit" className="button" disabled={busy}>{busy ? <><LoaderCircle size={14} /> Saving…</> : <><Save size={14} /> Save settings</>}</button>
          </form>
        </section>
        <section className="panel">
          <div className="panel-header"><h2>Quick controls</h2></div>
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.7 }}>Reopening does not change the stored deadline. Every update is included in the database audit trail.</p>
          <div className="inline-actions">
            <button className="button small" disabled={busy} onClick={() => void quickAction("open")}>Enable submissions</button>
            <button className="button secondary small" disabled={busy} onClick={() => void quickAction("freeze")}>Freeze submissions</button>
            <button className="button secondary small" disabled={busy} onClick={() => void quickAction("reopen")}>Reopen submissions</button>
            <button className="button danger small" disabled={busy} onClick={() => void quickAction("disable")}>Disable submissions</button>
          </div>
        </section>
      </>}
    </>
  );
}

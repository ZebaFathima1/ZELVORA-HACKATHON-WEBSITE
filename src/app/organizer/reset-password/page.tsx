"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function OrganizerResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setErrorMessage("");
    try {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setMessage("Password updated. You can now sign in to the organizer portal.");
      setPassword("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="organizer-login-page">
      <section className="organizer-login-card">
        <div className="organizer-login-brand"><span className="brand-mark">Z</span><span><strong>ZELVORA</strong><small>TECHNOLOGIES PVT. LTD.</small></span></div>
        <span className="eyebrow">Account recovery</span>
        <h1>Set a new password.</h1>
        <p className="organizer-login-intro">Choose a new password for your organizer account.</p>
        <form onSubmit={updatePassword}>
          <div className="form-row"><label htmlFor="new-password" className="form-label">New password</label><input id="new-password" className="field" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
          {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
          {message && <div className="alert success" role="status">{message}</div>}
          <button className="button organizer-signin-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} /> Updating…</> : <><LockKeyhole size={16} /> Update password</>}</button>
        </form>
        <div className="organizer-login-footer"><Link href="/organizer">Back to organizer sign in</Link></div>
      </section>
    </main>
  );
}

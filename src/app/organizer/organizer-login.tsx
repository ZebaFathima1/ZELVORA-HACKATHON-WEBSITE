"use client";

import Link from "next/link";
import { Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function OrganizerLogin({ initialError = "" }: { initialError?: string }) {
  const router = useRouter();
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState(initialError);
  const [successMessage, setSuccessMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setErrorMessage("Enter your name to create an account.");
      return;
    }
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() } }
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (data.session) {
        router.replace("/organizer");
        router.refresh();
        return;
      }

      setSuccessMessage("Account created. Check your email to confirm your account, then sign in.");
      setIsSigningUp(false);
      setPassword("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error || !data.user) {
        setErrorMessage(error?.message ?? "Sign-in failed. Check your email and password.");
        return;
      }

      const { data: organizer, error: roleError } = await supabase
        .from("admin_users")
        .select("role")
        .eq("user_uuid", data.user.id)
        .maybeSingle();

      if (roleError || !organizer) {
        if (roleError) console.error("Could not verify the organizer account:", roleError);
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) console.error("Could not clear unauthorized organizer session:", signOutError);
        setErrorMessage(roleError
          ? `Could not verify organizer access. Confirm the latest database migration is applied. ${roleError.message}`
          : "Could not find your organizer account. Confirm the latest database migration is applied, then try again.");
        return;
      }

      router.replace("/organizer");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    setErrorMessage("");
    setSuccessMessage("");
    const address = email.trim();
    if (!address) {
      setErrorMessage("Enter your organizer email first, then choose Forgot password.");
      return;
    }
    setResetBusy(true);
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/organizer/reset-password`
      });
      if (error) setErrorMessage(error.message);
      else setSuccessMessage("If an account exists for that email, Supabase will send a password reset link.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not request a password reset.");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <main className="organizer-login-page">
      <section className="organizer-login-card">
        <div className="organizer-login-brand">
          <span className="brand-mark">Z</span>
          <span><strong>ZELVORA</strong><small>TECHNOLOGIES PVT. LTD.</small></span>
        </div>
        <span className="eyebrow">Organizer workspace</span>
        <h1>{isSigningUp ? "Create your account." : "Welcome back."}</h1>
        <p className="organizer-login-intro">{isSigningUp ? "Create an account with your name, email, and password." : "Sign in with the email and password for your organizer account in Supabase."}</p>
        {initialError && <div className="alert info" role="status">{initialError}</div>}
        <form onSubmit={isSigningUp ? signUp : signIn}>
          {isSigningUp && <div className="form-row">
            <label htmlFor="organizer-name" className="form-label">Name</label>
            <div className="organizer-input-wrap"><UserRound size={16} /><input id="organizer-name" className="field" type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
          </div>}
          <div className="form-row">
            <label htmlFor="organizer-email" className="form-label">Email address</label>
            <div className="organizer-input-wrap"><Mail size={16} /><input id="organizer-email" className="field" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          </div>
          <div className="form-row">
            <label htmlFor="organizer-password" className="form-label">Password</label>
            <div className="organizer-input-wrap"><KeyRound size={16} /><input id="organizer-password" className="field" type={showPassword ? "text" : "password"} autoComplete={isSigningUp ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
          </div>
          {!isSigningUp && <div className="organizer-forgot-row"><button type="button" className="text-button" onClick={() => void sendPasswordReset()} disabled={resetBusy}>{resetBusy ? "Sending reset link…" : "Forgot password?"}</button></div>}
          {errorMessage && <div className="alert error" role="alert">{errorMessage}</div>}
          {successMessage && <div className="alert success" role="status">{successMessage}</div>}
          <button className="button organizer-signin-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} /> {isSigningUp ? "Creating account…" : "Signing in…"}</> : <><LockKeyhole size={16} /> {isSigningUp ? "Create account" : "Sign In"}</>}</button>
        </form>
        <div className="organizer-login-footer"><Link href="/">Return to participant portal</Link><button type="button" className="text-button" onClick={() => { setIsSigningUp((current) => !current); setErrorMessage(""); setSuccessMessage(""); }}>{isSigningUp ? "Already have an account? Sign in" : "Create an account"}</button></div>
      </section>
    </main>
  );
}

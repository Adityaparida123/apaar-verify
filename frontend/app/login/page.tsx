"use client";

import { useState } from "react";
import { BookOpenCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { errorMessage } from "@/lib/api";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="brand" style={{ padding: 0 }}>
          <span className="brand-mark"><ShieldCheck size={22} /></span>
          <span><span className="brand-name">APAAR Verify</span><span className="brand-sub">Academic records</span></span>
        </div>
        <div>
          <p className="eyebrow" style={{ color: "var(--butter)" }}>A careful record, a clear history</p>
          <h1>Trust is built one correction at a time.</h1>
          <p>Review proposed changes, understand their possible impact, and keep every decision accountable.</p>
          <BookOpenCheck size={48} strokeWidth={1} color="#f0d98a" aria-hidden="true" />
        </div>
        <p style={{ fontSize: 11, margin: 0 }}>Prototype platform · Not an official APAAR or AICTE service</p>
      </section>
      <section className="auth-form-side">
        <div style={{ position: "fixed", top: 20, right: 20 }}><ThemeToggle /></div>
        <div className="auth-card">
          <p className="eyebrow">Secure workspace</p>
          <h2>Welcome back</h2>
          <p className="lede" style={{ marginBottom: 25 }}>Sign in with your provisioned account.</p>
          {error && <div className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
          <form onSubmit={submit}>
            <div className="field"><label htmlFor="email">Email address</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            <button className="button" style={{ width: "100%", marginTop: 7 }} disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="field-help" style={{ marginTop: 20 }}>Accounts are provisioned by an administrator. Self-service registration is not available.</p>
          <p className="field-help" style={{ marginTop: 12 }}>Have a verification token? <Link href="/verify" style={{ color: "var(--ink)", fontWeight: 700 }}>Check it publicly</Link></p>
        </div>
      </section>
    </main>
  );
}

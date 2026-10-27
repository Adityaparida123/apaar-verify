"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoadError, Notice, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function PublicVerifyPage() {
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ valid: boolean; status?: string; claims: Record<string, unknown>; notice: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try { setResult(await api.verifyToken(token.trim())); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  return <main className="auth-page">
    <section className="auth-art">
      <Link href="/login" className="brand" style={{ padding: 0 }}>
        <span className="brand-mark"><ShieldCheck size={22} /></span>
        <span><span className="brand-name">APAAR Verify</span><span className="brand-sub">Public credential check</span></span>
      </Link>
      <div>
        <p className="eyebrow">A bounded claim</p>
        <h1>Check a credential, not a person's whole record.</h1>
        <p>This public check returns only the claims exposed by the backend verification endpoint.</p>
      </div>
      <p style={{ fontSize: 11, margin: 0 }}>Prototype database · Not an official APAAR or AICTE service</p>
    </section>
    <section className="auth-form-side">
      <div style={{ position: "fixed", top: 20, right: 20 }}><ThemeToggle /></div>
      <div className="auth-card">
        <p className="eyebrow">Public verification</p><h2>Enter your token</h2>
        <p className="lede" style={{ marginBottom: 20 }}>No account is required for this token check. A failed request is not the same as an invalid credential.</p>
        {error && <div style={{ marginBottom: 15 }}><LoadError>{error}</LoadError></div>}
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="token">Verification token</label><input id="token" className="input" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" required /></div>
          <button className="button" style={{ width: "100%" }} disabled={loading}>{loading ? "Checking…" : "Verify token"}</button>
        </form>
        {result && <section style={{ marginTop: 20 }} aria-live="polite">
          <div className="row" style={{ flexDirection: "row", justifyContent: "flex-start" }}><h3 style={{ margin: 0 }}>Result</h3><StatusBadge value={result.valid ? "valid" : result.status ?? "invalid"} /></div>
          <p className="field-help" style={{ marginTop: 8 }}>{result.notice}</p>
          {Object.keys(result.claims).length > 0 && <dl>{Object.entries(result.claims).map(([key, value]) => <div className="row" style={{ flexDirection: "row", padding: "7px 0", borderBottom: "1px solid var(--line)" }} key={key}><dt className="field-help">{key.replaceAll("_", " ")}</dt><dd style={{ margin: 0, fontSize: 12 }}>{String(value)}</dd></div>)}</dl>}
        </section>}
        <div style={{ marginTop: 18 }}><Notice>Only token status and backend-permitted claims are shown. This does not contact an external registry.</Notice></div>
        <p className="field-help" style={{ marginTop: 16 }}><Link href="/login" style={{ color: "var(--ink)", fontWeight: 700 }}>Return to staff sign-in</Link></p>
      </div>
    </section>
  </main>;
}

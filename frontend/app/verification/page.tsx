"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { LoadError, Notice, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function VerificationPage() {
  const { user } = useAuth();
  const canIssue = user?.role === "institution_admin" || user?.role === "aicte_official";
  const [recordId, setRecordId] = useState("");
  const [expires, setExpires] = useState(30);
  const [token, setToken] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [verifyValue, setVerifyValue] = useState("");
  const [verification, setVerification] = useState<{ valid: boolean; status?: string; claims: Record<string, unknown>; notice: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.issueToken(recordId.trim(), expires);
      setToken(result.token); setTokenId(result.token_id); setVerifyValue(result.token); setVerification(null);
      setMessage(`Credential issued; expires ${new Date(result.expires_at).toLocaleString()}. Copy it now; the backend does not provide a token-list endpoint.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function verify() {
    if (!verifyValue.trim()) return;
    setBusy(true); setError(""); setVerification(null);
    try { setVerification(await api.verifyToken(verifyValue.trim())); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!tokenId || !window.confirm("Revoke the credential issued in this session?")) return;
    setBusy(true); setError(""); setMessage("");
    try { await api.revokeToken(tokenId); setToken(""); setTokenId(""); setMessage("Credential revoked."); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <AppShell>
    <PageHeading eyebrow="Credential verification" title="A claim with a clear boundary." description="Issue and verify prototype credentials against this application's database. This is not official APAAR or AICTE verification." />
    {error && <LoadError>{error}</LoadError>}{message && <div style={{ marginTop: 14 }}><Notice kind="success">{message}</Notice></div>}
    <div className="split" style={{ marginTop: 18 }}>
      {canIssue ? <section className="panel panel-pad">
        <p className="eyebrow">Authorized issuance</p><h2>Issue a verification token</h2>
        <form onSubmit={issue}>
          <div className="field"><label htmlFor="record-id">Record ID</label><input className="input" id="record-id" value={recordId} onChange={(event) => setRecordId(event.target.value)} required /></div>
          <div className="field"><label htmlFor="expires">Expires in days</label><input className="input" id="expires" type="number" min="1" max="365" value={expires} onChange={(event) => setExpires(Number(event.target.value))} required /></div>
          <button className="button button-accent" disabled={busy}>Issue token</button>
        </form>
        {token && <div style={{ marginTop: 20 }}><p className="section-label">Copy the one-time token</p><div className="token-box">{token}</div><button className="button button-secondary button-small" style={{ marginTop: 10 }} onClick={() => navigator.clipboard.writeText(token)}>Copy token</button><button className="button button-danger button-small" style={{ marginTop: 10, marginLeft: 8 }} disabled={busy} onClick={revoke}>Revoke this token</button></div>}
      </section> : <section className="panel panel-pad"><p className="eyebrow">Credential issuance</p><h2>Issuer permission required</h2><p className="lede">Your role can check a credential, but token issuance and revocation require an institution administrator or AICTE official.</p></section>}
      <section className="panel panel-pad" style={{ background: "var(--lavender)" }}>
        <p className="eyebrow">Public token check</p><h2>Verify a credential</h2>
        <div className="field"><label htmlFor="verify-token">Verification token</label><input className="input" id="verify-token" value={verifyValue} onChange={(event) => setVerifyValue(event.target.value)} /></div>
        <button className="button" onClick={verify} disabled={busy || !verifyValue.trim()}>Check credential</button>
        {verification && <div style={{ marginTop: 18 }}><div className="row" style={{ flexDirection: "row", justifyContent: "flex-start" }}><StatusBadge value={verification.valid ? "valid" : verification.status ?? "invalid"} /></div><p className="field-help" style={{ marginTop: 10 }}>{verification.notice}</p>{Object.keys(verification.claims).length > 0 && <dl>{Object.entries(verification.claims).map(([key, value]) => <div className="row" style={{ flexDirection: "row", padding: "7px 0", borderBottom: "1px solid var(--line)" }} key={key}><dt className="field-help">{key.replaceAll("_", " ")}</dt><dd style={{ margin: 0, fontSize: 12 }}>{String(value)}</dd></div>)}</dl>}</div>}
      </section>
    </div>
    <div style={{ marginTop: 18 }}><Notice>Credentials are issued/revoked transactionally by the backend. Only a token issued in this page session can be revoked here; there is no token-list endpoint.</Notice></div>
  </AppShell>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpenCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { ApiError, errorMessage, loginErrorMessage } from "@/lib/api";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: {
            theme: "outline";
            size: "large";
            text: "signin_with";
            shape: "rectangular";
            width: number;
          }) => void;
        };
      };
    };
  }
}

export default function LoginPage() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleScriptFailed, setGoogleScriptFailed] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  const handleGoogleCredential = useCallback((response: { credential?: string }) => {
    if (submitting.current) return;
    if (!response.credential) {
      setError("Google sign-in did not return a credential. Please try again.");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    void signInWithGoogle(response.credential).catch((cause: unknown) => {
      setError(cause instanceof ApiError && cause.status === 401
        ? "Google sign-in was not accepted. Use an authorized account or sign in with your password."
        : errorMessage(cause));
    }).finally(() => {
      submitting.current = false;
      setPending(false);
    });
  }, [signInWithGoogle]);

  useEffect(() => {
    if (!googleReady || !googleClientId || !googleButton.current || !window.google) return;
    googleButton.current.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: handleGoogleCredential,
    });
    window.google.accounts.id.renderButton(googleButton.current, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
      width: Math.max(200, Math.floor(googleButton.current.clientWidth)),
    });
  }, [googleReady, googleClientId, handleGoogleCredential]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    setPending(true);
    try {
      await signIn(email, password);
    } catch (cause) {
      setError(loginErrorMessage(cause));
    } finally {
      submitting.current = false;
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
          <p className="eyebrow">A careful record, a clear history</p>
          <h1>Trust is built one correction at a time.</h1>
          <p>Review proposed changes, understand their possible impact, and keep every decision accountable.</p>
          <BookOpenCheck className="auth-art-icon" size={48} strokeWidth={1} aria-hidden="true" />
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
          {googleClientId && <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onReady={() => setGoogleReady(true)}
            onError={() => setGoogleScriptFailed(true)}
          />}
          <div className="google-signin-button" ref={googleButton} aria-label="Sign in with Google" aria-busy={pending} />
          {!googleClientId && <p className="field-help">Google sign-in is not configured. Use your email and password.</p>}
          {googleClientId && !googleReady && !googleScriptFailed && <p className="field-help" role="status">Loading Google sign-in…</p>}
          {googleScriptFailed && <p className="field-help" role="status">Google sign-in could not load. Use your email and password.</p>}
          {pending && <p className="field-help" role="status">Completing sign-in…</p>}
          {googleClientId && <div className="auth-divider"><span>or sign in with email</span></div>}
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

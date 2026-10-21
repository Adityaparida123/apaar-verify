"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, FileSearch, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, PageHeading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.dashboard().then(setSummary).catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false)); }, []);
  return <AppShell>
    <PageHeading eyebrow="Today in the registry" title="A clearer view of the record." description="A live overview from your authorized APAAR Verify workspace. Nothing here is inferred from unavailable data." />
    {error && <LoadError>{error}</LoadError>}
    {loading ? <p className="lede">Loading dashboard data…</p> : summary && <>
      <section className="editorial-grid" style={{ marginBottom: 22 }}>
        <div className="panel hero-panel">
          <p className="eyebrow" style={{ color: "var(--butter)" }}>Attention, with context</p>
          <h2>{summary.records_needing_review} record{summary.records_needing_review === 1 ? "" : "s"} need a closer look.</h2>
          <p>{summary.open_review_tasks} open review task{summary.open_review_tasks === 1 ? "" : "s"} from recorded assessment workflows.</p>
          <Link href="/review" className="button button-accent">Open review queue <ArrowUpRight size={15} /></Link>
          <svg className="hero-stamp" viewBox="0 0 120 120" fill="none" aria-hidden="true"><path d="M25 13h46l25 25v67H25z" stroke="#f7f4ec" strokeWidth="2"/><path d="M71 14v25h24M40 56h39M40 68h26" stroke="#f7f4ec" strokeWidth="2"/><path d="m43 88 9 9 23-23" stroke="#f0d98a" strokeWidth="4"/><circle cx="25" cy="13" r="4" fill="#e66b4e"/><circle cx="96" cy="38" r="4" fill="#e66b4e"/></svg>
        </div>
        <div className="panel panel-pad" style={{ background: "var(--lavender)" }}>
          <p className="eyebrow">Next step</p>
          <h2>Review before you revise.</h2>
          <p className="lede" style={{ marginBottom: 21 }}>The impact detector previews deterministic checks before an authorized correction is committed.</p>
          <Link className="button" href="/impact">Start an assessment <FileSearch size={15} /></Link>
        </div>
      </section>
      <section className="metric-grid" style={{ marginBottom: 28 }} aria-label="Workspace metrics">
        {[
          ["Active records", summary.total_active_students],
          ["Institutions", summary.total_registered_institutions],
          ["Enrolment", summary.actual_enrolment],
          ["Approved intake", summary.approved_intake],
        ].map(([label, value]) => <div key={label} className="panel-flat metric"><span className="metric-label">{label}</span><strong className="metric-value">{Number(value).toLocaleString()}</strong><span className="metric-label">Current API result</span></div>)}
      </section>
      <section className="editorial-grid">
        <div>
          <p className="section-label">Recent audit activity</p>
          {summary.recent_changes.length ? <div className="panel panel-pad activity-list">{summary.recent_changes.map((event, index) => <div className="activity-item" key={`${event.timestamp}-${index}`}><span className="timeline-dot" /><div><div className="activity-action">{event.action.replaceAll(".", " ")}{event.target_record_id ? ` · ${event.target_record_id}` : ""}</div><div className="field-help">{event.actor_role.replaceAll("_", " ")} · {event.outcome}</div></div><time className="activity-time">{new Date(event.timestamp).toLocaleString()}</time></div>)}</div> : <div className="panel-flat"><EmptyState title="No audit events returned">The API returned no recent activity for this scope.</EmptyState></div>}
        </div>
        <div className="panel panel-pad">
          <p className="section-label">Quick access</p>
          <Link className="row" href="/students" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}><span><UsersRound size={16} style={{ marginRight: 9, verticalAlign: "middle" }} />Browse student records</span><ArrowUpRight size={15} /></Link>
          <Link className="row" href="/audit" style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}><span><Clock3 size={16} style={{ marginRight: 9, verticalAlign: "middle" }} />Explore audit log</span><ArrowUpRight size={15} /></Link>
          <p className="field-help" style={{ marginTop: 17 }}>This prototype does not query official APAAR or AICTE systems.</p>
        </div>
      </section>
    </>}
  </AppShell>;
}

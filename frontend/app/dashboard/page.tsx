"use client";

import Link from "next/link";
import { ArrowUpRight, Clock3, FileSearch, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadError, PageHeading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loadStartedAt = useRef<number | null>(null);
  useEffect(() => {
    loadStartedAt.current = performance.now();
    api.dashboard()
      .then(setSummary)
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!loading && loadStartedAt.current !== null) {
      performance.measure("apaar.dashboard.initial_load", {
        start: loadStartedAt.current,
        end: performance.now(),
      });
      loadStartedAt.current = null;
    }
  }, [loading]);
  return <AppShell>
    <PageHeading eyebrow="Today in the registry" title="A clearer view of the record." description="A live overview from your authorized APAAR Verify workspace. Nothing here is inferred from unavailable data." />
    {error && <LoadError>{error}</LoadError>}
    {loading ? <p className="lede">Loading dashboard data…</p> : summary && <>
      <section className="editorial-grid" style={{ marginBottom: 22 }}>
        <div className="panel hero-panel">
          <p className="eyebrow">Attention, with context</p>
          <h2>{summary.records_needing_review} record{summary.records_needing_review === 1 ? "" : "s"} need a closer look.</h2>
          <p>{summary.open_review_tasks} open review task{summary.open_review_tasks === 1 ? "" : "s"} from recorded assessment workflows.</p>
          <Link href="/review" className="button button-accent">Open review queue <ArrowUpRight size={15} /></Link>
          <svg className="hero-stamp" viewBox="0 0 120 120" fill="none" aria-hidden="true"><path d="M25 13h46l25 25v67H25z" stroke="currentColor" strokeWidth="2"/><path d="M71 14v25h24M40 56h39M40 68h26" stroke="currentColor" strokeWidth="2"/><path d="m43 88 9 9 23-23" stroke="var(--primary)" strokeWidth="4"/><circle cx="25" cy="13" r="4" fill="var(--primary)"/><circle cx="96" cy="38" r="4" fill="var(--primary)"/></svg>
        </div>
        <div className="panel panel-pad" style={{ background: "var(--surface-tint)" }}>
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
      <section className="panel panel-pad dashboard-quick-access" aria-labelledby="quick-access-title">
        <h2 className="section-label dashboard-quick-access-title" id="quick-access-title">Quick access</h2>
        <div className="dashboard-quick-access-links">
          <Link className="dashboard-quick-access-link" href="/students">
            <UsersRound size={18} aria-hidden="true" />
            <span>Browse student records</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
          <Link className="dashboard-quick-access-link" href="/audit">
            <Clock3 size={18} aria-hidden="true" />
            <span>Explore audit log</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>}
  </AppShell>;
}

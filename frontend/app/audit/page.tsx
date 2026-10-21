"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, PageHeading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { AuditEvent } from "@/lib/types";

export default function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.audit(page).then((result) => { setItems(result.items); setTotal(result.total); setError(""); }).catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false)); }, [page]);
  return <AppShell>
    <PageHeading eyebrow="Accountability record" title="Actions, in sequence." description="Audit events returned by the backend for your authorized scope. Event text is shown as recorded." />
    {error && <LoadError>{error}</LoadError>}
    {loading ? <p className="lede">Loading audit events…</p> : items.length === 0 ? <div className="panel-flat"><EmptyState title="No audit events returned">The API returned no events for this page.</EmptyState></div> : <section className="panel panel-pad activity-list">
      {items.map((event, index) => <article className="activity-item" key={`${event.timestamp}-${index}`}><span className="timeline-dot" /><div><div className="activity-action">{event.action.replaceAll(".", " ")}</div><div className="field-help">Actor {event.actor_id} · {event.actor_role.replaceAll("_", " ")} · {event.outcome}</div><div className="field-help">Target {event.target_record_id ?? "—"} · Institution {event.institution_id ?? "—"}</div>{event.changed_fields.length > 0 && <div className="field-help">Fields: {event.changed_fields.join(", ")}</div>}{event.reason && <div className="field-help">Reason: {event.reason}</div>}</div><time className="activity-time">{new Date(event.timestamp).toLocaleString()}</time></article>)}
    </section>}
    <div className="row" style={{ marginTop: 16, flexDirection: "row" }}><button className="button button-secondary button-small" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((n) => n - 1); }}>Previous</button><span className="field-help">{total.toLocaleString()} events · page {page}</span><button className="button button-secondary button-small" disabled={page * 50 >= total || loading} onClick={() => { setLoading(true); setPage((n) => n + 1); }}>Next</button></div>
  </AppShell>;
}

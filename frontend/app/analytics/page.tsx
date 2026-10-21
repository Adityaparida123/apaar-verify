"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { IntakeComparison } from "@/lib/types";

export default function AnalyticsPage() {
  const [items, setItems] = useState<IntakeComparison[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.intake().then((response) => setItems(response.items)).catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false)); }, []);
  const maxValue = Math.max(1, ...items.map((item) => item.approved_intake ?? item.actual_enrolment));
  return <AppShell>
    <PageHeading eyebrow="Institution reporting" title="Intake, without guesswork." description="Programme and year comparisons returned by the backend. The approved intake may be unconfigured; such values remain visibly unavailable." />
    {error && <LoadError>{error}</LoadError>}
    {loading ? <p className="lede">Loading intake comparisons…</p> : items.length === 0 ? <div className="panel-flat"><EmptyState title="No intake comparisons returned">No configured institution or programme data is available in this API response.</EmptyState></div> : <>
      <section className="panel panel-pad" style={{ marginBottom: 20 }}>
        <p className="section-label">Actual enrolment against configured approved intake</p>
        <div className="chart-list" role="list" aria-label="Intake comparisons">
          {items.map((item, index) => {
            const width = Math.min(100, (item.actual_enrolment / maxValue) * 100);
            return <div className="chart-row" key={`${item.institution_id}-${item.programme}-${item.academic_year}`} role="listitem">
              <span title={`${item.institution_id} · ${item.programme}`}>{item.programme}<small style={{ display: "block", color: "var(--muted)" }}>{item.academic_year}</small></span>
              <div className="bar-track" aria-label={`${item.actual_enrolment} actual enrolment`}><div className={`bar-fill ${index % 2 ? "alt" : ""}`} style={{ width: `${width}%` }} /></div>
              <strong>{item.actual_enrolment} / {item.approved_intake ?? "Not set"}</strong>
            </div>;
          })}
        </div>
      </section>
      <div className="table-wrap"><table><thead><tr><th>Institution</th><th>Programme</th><th>Year</th><th>Approved</th><th>Enrolment</th><th>Remaining</th><th>Excess</th><th>Supernumerary</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.institution_id}-${item.programme}-${item.academic_year}`}><td>{item.institution_id}</td><td>{item.programme}</td><td>{item.academic_year}</td><td>{item.approved_intake ?? <StatusBadge value="unconfigured" />}</td><td>{item.actual_enrolment}</td><td>{item.remaining_capacity ?? "—"}</td><td>{item.excess_enrolment}</td><td>{item.supernumerary_enrolment}{item.supernumerary_limit !== null ? ` / ${item.supernumerary_limit}` : " · no limit configured"}</td></tr>)}</tbody></table></div>
    </>}
  </AppShell>;
}

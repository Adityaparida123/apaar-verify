"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, Notice, PageHeading } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { IntakeComparison } from "@/lib/types";

type AttentionItem = {
  key: string;
  groupKey: string;
  title: string;
  detail: string;
  nextStep: string;
  kind: "confirmed" | "unverified";
};

function comparisonKey(item: IntakeComparison): string {
  return JSON.stringify([item.institution_id, item.programme, item.academic_year]);
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function programmeYear(item: IntakeComparison): string {
  return item.academic_year ?? "Year not specified";
}

function attentionItems(items: IntakeComparison[]): AttentionItem[] {
  const attention: AttentionItem[] = [];

  for (const item of items) {
    const scope = `${item.programme} · ${programmeYear(item)} · ${item.institution_id}`;
    if (item.excess_enrolment !== null && item.excess_enrolment > 0 && item.approved_intake !== null) {
      attention.push({
        key: `${comparisonKey(item)}-intake-excess`,
        groupKey: comparisonKey(item),
        title: "Enrolment exceeds configured intake",
        detail: `${scope}: ${formatNumber(item.actual_enrolment)} enrolled against ${formatNumber(item.approved_intake)} approved, a difference of ${formatNumber(item.excess_enrolment)}.`,
        nextStep: "Check the active student records and confirm that the approved intake value is current. This is a numerical comparison, not a compliance determination.",
        kind: "confirmed",
      });
    }

    if (item.approved_intake === null) {
      attention.push({
        key: `${comparisonKey(item)}-intake-missing`,
        groupKey: comparisonKey(item),
        title: "Approved intake not configured",
        detail: `${scope}: approved intake is unavailable, so remaining capacity cannot be verified.`,
        nextStep: "Check the institution’s approval information and configure the applicable intake value.",
        kind: "unverified",
      });
    }

    if (item.supernumerary_excess !== null && item.supernumerary_excess > 0 && item.supernumerary_limit !== null) {
      attention.push({
        key: `${comparisonKey(item)}-supernumerary-excess`,
        groupKey: comparisonKey(item),
        title: "Supernumerary allocation exceeds configured limit",
        detail: `${scope}: ${formatNumber(item.supernumerary_enrolment)} supernumerary places are recorded against a limit of ${formatNumber(item.supernumerary_limit)}.`,
        nextStep: "Review the seat-category records and confirm that the configured supernumerary limit is current.",
        kind: "confirmed",
      });
    } else if (item.supernumerary_enrolment > 0 && item.supernumerary_limit === null) {
      attention.push({
        key: `${comparisonKey(item)}-supernumerary-unverified`,
        groupKey: comparisonKey(item),
        title: "Supernumerary limit not configured",
        detail: `${scope}: ${formatNumber(item.supernumerary_enrolment)} supernumerary places are recorded, but no limit is available for comparison.`,
        nextStep: "Check the applicable seat-allocation policy and configure the limit if one applies.",
        kind: "unverified",
      });
    }
  }

  return attention;
}

export default function AnalyticsPage() {
  const [items, setItems] = useState<IntakeComparison[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    api.intake()
      .then((response) => {
        if (active) setItems(response.items);
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [retryCount]);

  const comparisons = useMemo(() => {
    const unique = new Map<string, IntakeComparison>();
    for (const item of items) unique.set(comparisonKey(item), item);
    return Array.from(unique.values());
  }, [items]);

  const totals = useMemo(() => {
    const allIntakeConfigured = comparisons.length > 0
      && comparisons.every((item) => item.approved_intake !== null);
    const configuredIntakeCount = comparisons.filter((item) => item.approved_intake !== null).length;
    const allRemainingKnown = comparisons.length > 0
      && comparisons.every((item) => item.remaining_capacity !== null);

    return {
      enrolled: comparisons.reduce((sum, item) => sum + item.actual_enrolment, 0),
      approvedIntake: allIntakeConfigured
        ? comparisons.reduce((sum, item) => sum + (item.approved_intake ?? 0), 0)
        : null,
      configuredIntakeCount,
      missingIntakeCount: comparisons.length - configuredIntakeCount,
      remainingSeats: allRemainingKnown
        ? comparisons.reduce((sum, item) => sum + (item.remaining_capacity ?? 0), 0)
        : null,
    };
  }, [comparisons]);

  const attention = useMemo(() => attentionItems(comparisons), [comparisons]);
  const attentionEntries = useMemo(() => {
    const keys = new Set(attention.map((item) => item.groupKey));
    return keys.size;
  }, [attention]);

  return (
    <AppShell>
      <PageHeading
        eyebrow="Institution reporting"
        title="Intake, without guesswork."
        description="Understand enrolment against approved intake and identify programmes that need review."
      />

      {loading ? (
        <section className="panel panel-pad analytics-loading" role="status">Loading intake comparisons…</section>
      ) : error ? (
        <section className="analytics-error">
          <LoadError>{error}</LoadError>
          <button className="button button-secondary" type="button" onClick={() => setRetryCount((count) => count + 1)}>
            Retry intake data
          </button>
        </section>
      ) : comparisons.length === 0 ? (
        <section className="panel-flat">
          <EmptyState title="No intake comparisons returned">
            No institution, programme, or enrolment comparisons are available in the data accessible to your account.
          </EmptyState>
        </section>
      ) : (
        <>
          <section className="analytics-metrics" aria-label="Intake summary">
            <article className="analytics-metric enrolled">
              <span className="analytics-metric-label">Enrolled students</span>
              <strong>{formatNumber(totals.enrolled)}</strong>
              <span>Across the returned programme and year comparisons</span>
            </article>
            <article className={`analytics-metric ${totals.approvedIntake === null ? "unavailable" : "approved"}`}>
              <span className="analytics-metric-label">Total approved intake</span>
              <strong>{totals.approvedIntake === null ? "Unavailable" : formatNumber(totals.approvedIntake)}</strong>
              <span>
                {totals.approvedIntake === null
                  ? totals.configuredIntakeCount === 0
                    ? "No approved intake is configured."
                    : `Missing for ${totals.missingIntakeCount} programme-year comparison${totals.missingIntakeCount === 1 ? "" : "s"}.`
                  : "Sum across configured programme-year comparisons"}
              </span>
            </article>
            <article className={`analytics-metric ${totals.remainingSeats === null ? "unavailable" : "remaining"}`}>
              <span className="analytics-metric-label">Remaining seats</span>
              <strong>{totals.remainingSeats === null ? "Unavailable" : formatNumber(totals.remainingSeats)}</strong>
              <span>
                {totals.remainingSeats === null
                  ? "Cannot total capacity while intake is missing."
                  : "Configured approved intake less enrolment, floored at zero"}
              </span>
            </article>
            <article className={`analytics-metric ${attentionEntries > 0 ? "attention" : "clear"}`}>
              <span className="analytics-metric-label">Programme-year entries to review</span>
              <strong>{formatNumber(attentionEntries)}</strong>
              <span>Based on returned capacity and supernumerary comparisons</span>
            </article>
          </section>

          <section className="analytics-section" aria-labelledby="programme-comparison-title">
            <div className="analytics-section-heading">
              <div>
                <p className="eyebrow">Programme and year</p>
                <h2 id="programme-comparison-title">Enrolment against approved intake</h2>
              </div>
              <p className="field-help">Each bar compares one institution, programme, and academic-year entry.</p>
            </div>
            <div className="analytics-comparison-list">
              {comparisons.map((item) => {
                const ratio = item.approved_intake !== null && item.approved_intake > 0
                  ? item.actual_enrolment / item.approved_intake
                  : null;
                const barPercent = ratio === null ? 0 : Math.min(100, ratio * 100);
                const overCapacity = item.excess_enrolment !== null && item.excess_enrolment > 0;
                const label = `${item.institution_id}, ${item.programme}, ${programmeYear(item)}`;

                return (
                  <article className="analytics-comparison" key={comparisonKey(item)}>
                    <div className="analytics-comparison-heading">
                      <div>
                        <h3>{item.programme}</h3>
                        <p>{programmeYear(item)} <span aria-hidden="true">·</span> {item.institution_id}</p>
                      </div>
                      <div className="analytics-comparison-numbers">
                        <strong>{formatNumber(item.actual_enrolment)}</strong>
                        <span>enrolled</span>
                        <span className="analytics-number-divider" aria-hidden="true">/</span>
                        <strong>{item.approved_intake === null ? "Not configured" : formatNumber(item.approved_intake)}</strong>
                        <span>{item.approved_intake === null ? "" : "approved"}</span>
                      </div>
                    </div>
                    {item.approved_intake !== null && item.approved_intake > 0 ? (
                      <>
                        <div
                          className={`analytics-progress ${overCapacity ? "over" : ""}`}
                          role="progressbar"
                          aria-label={`${label}: enrolled against approved intake`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(barPercent)}
                          aria-valuetext={`${formatNumber(item.actual_enrolment)} enrolled of ${formatNumber(item.approved_intake)} approved${overCapacity ? `; exceeds by ${formatNumber(item.excess_enrolment ?? 0)}` : ""}`}
                        >
                          <span style={{ width: `${barPercent}%` }} />
                        </div>
                        <div className="analytics-progress-caption">
                          <span>{Math.round((ratio ?? 0) * 100)}% filled</span>
                          {overCapacity && <strong className="analytics-over-warning">Exceeds intake by {formatNumber(item.excess_enrolment ?? 0)}</strong>}
                        </div>
                      </>
                    ) : item.approved_intake === 0 ? (
                      <Notice kind="info">
                        Approved intake is zero; a fill percentage cannot be calculated.
                        {overCapacity && ` Enrolment exceeds this value by ${formatNumber(item.excess_enrolment ?? 0)}.`}
                      </Notice>
                    ) : (
                      <Notice kind="info">Approved intake is not configured; percentage filled and remaining seats cannot be verified.</Notice>
                    )}
                    {(item.supernumerary_enrolment > 0 || item.supernumerary_limit !== null) && (
                      <p className="analytics-supernumerary">
                        Supernumerary: {formatNumber(item.supernumerary_enrolment)} enrolled
                        {item.supernumerary_limit === null ? " · limit not configured" : ` · limit ${formatNumber(item.supernumerary_limit)}`}
                        {item.supernumerary_excess !== null && item.supernumerary_excess > 0
                          ? ` · exceeds by ${formatNumber(item.supernumerary_excess)}`
                          : ""}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="analytics-section analytics-attention-section" aria-labelledby="attention-title">
            <div className="analytics-section-heading">
              <div>
                <p className="eyebrow">Next steps</p>
                <h2 id="attention-title">Items to review</h2>
              </div>
              <p className="field-help">Returned comparisons only; these are not regulatory determinations.</p>
            </div>
            {attention.length > 0 ? (
              <div className="analytics-attention-list">
                {attention.map((item) => (
                  <article className={`analytics-attention-item ${item.kind}`} key={item.key}>
                    <span className={`analytics-attention-label ${item.kind}`}>
                      {item.kind === "confirmed" ? "Numerical difference" : "Unable to verify"}
                    </span>
                    <h3>{item.title}</h3>
                    <p>{item.detail}</p>
                    <p className="analytics-next-step"><strong>What to check:</strong> {item.nextStep}</p>
                  </article>
                ))}
              </div>
            ) : (
              <Notice kind="success">No capacity or supernumerary issues were flagged in the returned comparisons. This is not a general compliance assessment.</Notice>
            )}
          </section>

          <section className="analytics-section" aria-labelledby="comparison-table-title">
            <div className="analytics-section-heading">
              <div>
                <p className="eyebrow">Detailed comparison</p>
                <h2 id="comparison-table-title">Programme intake records</h2>
              </div>
              <p className="field-help">Scroll horizontally to see all columns.</p>
            </div>
            <div className="table-wrap analytics-table-wrap">
              <table className="analytics-table">
                <caption className="visually-hidden">Enrolment and approved intake by institution, programme, and academic year.</caption>
                <thead>
                  <tr>
                    <th scope="col">Institution</th>
                    <th scope="col">Programme</th>
                    <th scope="col">Academic year</th>
                    <th scope="col" className="numeric">Approved intake</th>
                    <th scope="col" className="numeric">Actual enrolment</th>
                    <th scope="col" className="numeric">Remaining seats</th>
                    <th scope="col" className="numeric">Excess enrolment</th>
                    <th scope="col" className="numeric">Supernumerary</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((item) => (
                    <tr key={comparisonKey(item)}>
                      <th scope="row">{item.institution_id}</th>
                      <td>{item.programme}</td>
                      <td>{programmeYear(item)}</td>
                      <td className="numeric">{item.approved_intake === null ? <span className="analytics-unconfigured">Not configured</span> : formatNumber(item.approved_intake)}</td>
                      <td className="numeric">{formatNumber(item.actual_enrolment)}</td>
                      <td className="numeric">{item.remaining_capacity === null ? "Unavailable" : formatNumber(item.remaining_capacity)}</td>
                      <td className="numeric">{item.excess_enrolment === null ? "—" : formatNumber(item.excess_enrolment)}</td>
                      <td className="numeric">
                        {formatNumber(item.supernumerary_enrolment)}
                        {item.supernumerary_limit === null ? " · limit not configured" : ` / ${formatNumber(item.supernumerary_limit)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="analytics-footnote">Enrolment counts are from active records included in the backend’s configured institution and programme comparisons.</p>
        </>
      )}
    </AppShell>
  );
}

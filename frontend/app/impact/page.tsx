"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, Search } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, Notice, PageHeading } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { Assessment, Finding, ReviewTask, Student, StudentChanges } from "@/lib/types";

const fieldGroups = [
  {
    title: "Student and programme",
    fields: [
      ["full_name", "Full name", "text"],
      ["institution_id", "Institution ID", "text"],
      ["programme", "Programme", "text"],
      ["academic_year", "Academic year", "text"],
    ],
  },
  {
    title: "Admission details",
    fields: [
      ["admission_date", "Admission date", "date"],
      ["admission_category", "Admission category", "text"],
      ["status", "Record status", "select"],
    ],
  },
  {
    title: "Residency and seat category",
    fields: [
      ["nri_status", "NRI status", "boolean"],
      ["oci_status", "OCI status", "boolean"],
      ["foreign_national_status", "Foreign national", "boolean"],
      ["supernumerary_seat_status", "Supernumerary seat", "boolean"],
    ],
  },
] as const;

type FieldKey = typeof fieldGroups[number]["fields"][number][0] | "apaar_identifier";
type PreviewResponse = Awaited<ReturnType<typeof api.previewCorrection>>;
type PreviewState = PreviewResponse & { submittedChanges: StudentChanges; expectedVersion: number };
type FindingView = {
  key: string;
  title: string;
  explanation: string;
  action: string;
  severity: Finding["severity"];
  certainty: string;
  confirmed: boolean;
  humanReviewRequired: boolean;
  affectedRecords: string[];
  category: "confirmed" | "review" | "unverified";
  ruleId?: string;
};

const labels: Record<FieldKey, string> = {
  full_name: "Full name",
  institution_id: "Institution ID",
  programme: "Programme",
  academic_year: "Academic year",
  admission_date: "Admission date",
  admission_category: "Admission category",
  status: "Record status",
  nri_status: "NRI status",
  oci_status: "OCI status",
  foreign_national_status: "Foreign national",
  supernumerary_seat_status: "Supernumerary seat",
  apaar_identifier: "APAAR identifier",
};

const reviewChecklist = (preview: PreviewResponse) => preview.checklist.map((item) => ({
  ...item,
  used: false,
}));

function findingViews(preview: PreviewResponse): FindingView[] {
  const checklist = reviewChecklist(preview);
  const views: FindingView[] = preview.assessment.findings.map((finding): FindingView => {
    const matchingTask = checklist.find((task) =>
      !task.used && task.title === finding.title && task.explanation === finding.explanation,
    );
    if (matchingTask) matchingTask.used = true;
    const certainty = finding.certainty.trim();
    const unverified = /unknown|unavailable|not verified|unverified/i.test(certainty);

    const category: FindingView["category"] = unverified
      ? "unverified"
      : finding.confirmed ? "confirmed" : "review";
    return {
      key: finding.rule_id,
      title: finding.title,
      explanation: finding.explanation,
      action: matchingTask?.suggested_action ?? finding.recommended_action,
      severity: finding.severity,
      certainty,
      confirmed: finding.confirmed,
      humanReviewRequired: finding.human_review_required,
      affectedRecords: finding.affected_records,
      category,
      ruleId: finding.rule_id,
    };
  });

  checklist.filter((task) => !task.used).forEach((task, index) => {
    views.push({
      key: `checklist-${index}-${task.title}`,
      title: task.title,
      explanation: task.explanation,
      action: task.suggested_action,
      severity: task.severity,
      certainty: "Not provided by the preview response",
      confirmed: false,
      humanReviewRequired: true,
      affectedRecords: [],
      category: "review",
    });
  });

  return views;
}

function validateField(field: FieldKey, value: string | boolean): string | null {
  if (field === "apaar_identifier") {
    return typeof value === "string" && !/^\d{12}$/.test(value)
      ? "Enter exactly 12 digits, or leave this optional replacement blank."
      : null;
  }
  if (typeof value === "boolean") return null;
  if (!value) return `${labels[field]} is required.`;

  switch (field) {
    case "full_name":
      return value.length > 160 ? "Use 160 characters or fewer." : null;
    case "institution_id":
      if (value.length > 64) return "Use 64 characters or fewer.";
      return /^[A-Za-z0-9._-]+$/.test(value)
        ? null
        : "Use only letters, numbers, dots, underscores, or hyphens.";
    case "programme":
      return value.length > 120 ? "Use 120 characters or fewer." : null;
    case "academic_year": {
      const match = /^(\d{4})-(\d{2})$/.exec(value);
      if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
        return "Enter consecutive years in YYYY-YY format, such as 2025-26.";
      }
      return null;
    }
    case "admission_date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
        && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
        ? null
        : "Enter a valid admission date.";
    case "admission_category":
      return value.length > 64 ? "Use 64 characters or fewer." : null;
    case "status":
      return ["active", "archived", "suspended"].includes(value)
        ? null
        : "Choose a valid record status.";
    default:
      return null;
  }
}

function safeErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 422) {
    return "The proposed change did not pass validation. Review the highlighted fields and try again.";
  }
  return errorMessage(cause);
}

function displayValue(value: unknown, field?: string): string {
  if (field === "apaar_identifier" && (value === "[REDACTED]" || typeof value === "string")) {
    return "Replacement provided (masked)";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value ?? "—");
}

export default function ImpactPage() {
  const { user } = useAuth();
  const canCorrect = user?.role === "institution_admin" || user?.role === "aicte_official";
  const [records, setRecords] = useState<Student[]>([]);
  const [recordQuery, setRecordQuery] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [recordsRetry, setRecordsRetry] = useState(0);
  const [studentLoading, setStudentLoading] = useState(false);
  const [recordId, setRecordId] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [changes, setChanges] = useState<Partial<Record<FieldKey, string | boolean>>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ student: Student; assessment: Assessment; review_tasks: ReviewTask[] } | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(1);
  const applying = useRef(false);

  const normalizedChanges = useMemo(() => {
    const filtered: Partial<Record<FieldKey, string | boolean>> = {};
    if (!student) return filtered;
    for (const [field, rawValue] of Object.entries(changes) as [FieldKey, string | boolean][]) {
      const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      if (field === "apaar_identifier" && value === "") continue;
      const current = field === "apaar_identifier" ? "" : student[field];
      if (String(current ?? "") !== String(value)) filtered[field] = value;
    }
    return filtered;
  }, [changes, student]);

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<FieldKey, string>> = {};
    for (const [field, value] of Object.entries(normalizedChanges) as [FieldKey, string | boolean][]) {
      const message = validateField(field, value);
      if (message) errors[field] = message;
    }
    return errors;
  }, [normalizedChanges]);

  const findings = useMemo(() => preview ? findingViews(preview) : [], [preview]);
  const invalidPreviewVersion = Boolean(
    preview && student
    && (preview.expectedVersion !== student.version
      || preview.assessment.triggering_version !== preview.expectedVersion + 1),
  );

  useEffect(() => {
    if (!canCorrect) {
      setRecordsLoading(false);
      return;
    }
    let active = true;
    setRecordsLoading(true);
    setRecordsError("");
    const params = new URLSearchParams({ page: "1", page_size: "100" });
    if (recordQuery.trim()) params.set("q", recordQuery.trim());
    api.students(params).then((response) => {
      if (active) setRecords(response.items);
    }).catch((cause) => {
      if (active) setRecordsError(safeErrorMessage(cause));
    }).finally(() => {
      if (active) setRecordsLoading(false);
    });
    return () => { active = false; };
  }, [canCorrect, recordQuery, recordsRetry]);

  useEffect(() => {
    if (!recordId) return;
    let active = true;
    setStudentLoading(true);
    api.student(recordId).then((item) => {
      if (!active) return;
      setStudent(item);
      setChanges({});
      setPreview(null);
      setResult(null);
      setReason("");
      setError("");
      setConflict(false);
    }).catch((cause) => {
      if (active) setError(safeErrorMessage(cause));
    }).finally(() => {
      if (active) setStudentLoading(false);
    });
    return () => { active = false; };
  }, [recordId]);

  function updateField(field: FieldKey, value: string | boolean) {
    setChanges((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setError("");
    setConflict(false);
  }

  function buildChanges(): StudentChanges {
    const payload: StudentChanges = {};
    if (normalizedChanges.full_name !== undefined) payload.full_name = String(normalizedChanges.full_name);
    if (normalizedChanges.institution_id !== undefined) payload.institution_id = String(normalizedChanges.institution_id);
    if (normalizedChanges.programme !== undefined) payload.programme = String(normalizedChanges.programme);
    if (normalizedChanges.academic_year !== undefined) payload.academic_year = String(normalizedChanges.academic_year);
    if (normalizedChanges.admission_date !== undefined) payload.admission_date = String(normalizedChanges.admission_date);
    if (normalizedChanges.admission_category !== undefined) payload.admission_category = String(normalizedChanges.admission_category);
    if (normalizedChanges.status === "active" || normalizedChanges.status === "archived" || normalizedChanges.status === "suspended") {
      payload.status = normalizedChanges.status;
    }
    if (normalizedChanges.nri_status !== undefined) payload.nri_status = normalizedChanges.nri_status === true;
    if (normalizedChanges.oci_status !== undefined) payload.oci_status = normalizedChanges.oci_status === true;
    if (normalizedChanges.foreign_national_status !== undefined) {
      payload.foreign_national_status = normalizedChanges.foreign_national_status === true;
    }
    if (normalizedChanges.supernumerary_seat_status !== undefined) {
      payload.supernumerary_seat_status = normalizedChanges.supernumerary_seat_status === true;
    }
    if (normalizedChanges.apaar_identifier !== undefined) {
      payload.apaar_identifier = String(normalizedChanges.apaar_identifier);
    }
    return payload;
  }

  async function runPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCorrect || !student || loading || Object.keys(normalizedChanges).length === 0
      || Object.keys(fieldErrors).length > 0) return;
    setLoading(true);
    setError("");
    setConflict(false);
    setPreview(null);
    const submittedChanges = buildChanges();
    const expectedVersion = student.version;
    try {
      const response = await api.previewCorrection(student.record_id, submittedChanges, expectedVersion);
      setPreview({ ...response, submittedChanges, expectedVersion });
      setReason("");
      setStage(2);
    } catch (cause) {
      setError(safeErrorMessage(cause));
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally {
      setLoading(false);
    }
  }

  async function applyCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCorrect || !student || !preview || loading || applying.current
      || invalidPreviewVersion || reason.trim().length < 3 || reason.trim().length > 1000) return;
    applying.current = true;
    setLoading(true);
    setError("");
    setConflict(false);
    try {
      const applied = await api.applyCorrection(
        student.record_id,
        preview.submittedChanges,
        preview.expectedVersion,
        reason.trim(),
      );
      setResult(applied);
      setStudent(applied.student);
      setPreview(null);
      setStage(3);
    } catch (cause) {
      setError(safeErrorMessage(cause));
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally {
      applying.current = false;
      setLoading(false);
    }
  }

  async function reloadCurrentRecord() {
    if (!student || loading) return;
    setLoading(true);
    setError("");
    try {
      const currentStudent = await api.student(student.record_id);
      setStudent(currentStudent);
      setChanges({});
      setPreview(null);
      setReason("");
      setConflict(false);
      setStage(1);
    } catch (cause) {
      setError(safeErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  const oldValue = (field: string): string => {
    const value = field === "apaar_identifier" ? student?.masked_apaar_identifier : student?.[field as keyof Student];
    return displayValue(value, field);
  };

  return (
    <AppShell>
      <PageHeading
        eyebrow="Record correction"
        title="Review a change before it is made."
        description="Choose a student record, understand the possible impact, then authorize any correction with a reason."
      />

      {!canCorrect ? (
        <Notice kind="error">Your account is not authorized to create or confirm a correction.</Notice>
      ) : result ? (
        <section className="impact-success" aria-live="polite">
          <CheckCircle2 size={28} aria-hidden="true" />
          <p className="eyebrow">Correction applied</p>
          <h2>The record is now at version {result.student.version}.</h2>
          <p>The backend confirmed the correction. Linked records were not changed automatically.</p>
          <button
            className="button button-accent"
            type="button"
            onClick={() => {
              setResult(null);
              setPreview(null);
              setChanges({});
              setReason("");
              setRecordId("");
              setStudent(null);
              setStage(1);
            }}
          >
            Start another correction
          </button>
        </section>
      ) : (
        <>
          <ol className="impact-steps" aria-label="Correction steps">
            {["Choose and propose", "Review impact", "Confirm correction"].map((label, index) => (
              <li className={stage === index + 1 ? "current" : ""} aria-current={stage === index + 1 ? "step" : undefined} key={label}>
                <span>{index + 1}</span>{label}
              </li>
            ))}
          </ol>

          {error && (
            <div className="impact-error" role="alert">
              <LoadError>{conflict ? "This record changed after the preview. Nothing was applied. Reload the record and create a new preview before confirming." : error}</LoadError>
              {conflict && student && (
                <button className="button button-secondary button-small" type="button" disabled={loading} onClick={reloadCurrentRecord}>
                  {loading ? "Reloading…" : "Reload current record"}
                </button>
              )}
            </div>
          )}

          {stage === 1 && (
            <div className="impact-layout">
              <section className="impact-main">
                <h2>Choose a student record</h2>
                <div className="field">
                  <label htmlFor="record-search">Search authorized records</label>
                  <div className="impact-search">
                    <Search size={17} aria-hidden="true" />
                    <input
                      id="record-search"
                      className="input"
                      type="search"
                      value={recordQuery}
                      onChange={(event) => setRecordQuery(event.target.value)}
                      placeholder="Search by student name or ID"
                    />
                  </div>
                  <span className="field-help">Results are limited to records your account is permitted to access.</span>
                </div>

                {recordsError ? (
                  <div className="impact-record-error" role="alert">
                    <LoadError>{recordsError}</LoadError>
                    <button className="button button-secondary button-small" type="button" onClick={() => setRecordsRetry((count) => count + 1)}>
                      Retry search
                    </button>
                  </div>
                ) : recordsLoading ? (
                  <p className="field-help" role="status">Searching records…</p>
                ) : records.length > 0 ? (
                  <div className="impact-record-list" aria-label="Matching student records">
                    {records.map((record) => (
                      <button
                        className={`impact-record ${recordId === record.record_id ? "selected" : ""}`}
                        type="button"
                        key={record.record_id}
                        onClick={() => {
                          setRecordId(record.record_id);
                          setStudent(null);
                          setChanges({});
                          setPreview(null);
                          setResult(null);
                          setReason("");
                          setError("");
                          setConflict(false);
                        }}
                        aria-pressed={recordId === record.record_id}
                      >
                        <span><strong>{record.full_name}</strong><small>Student ID · {record.student_id}</small></span>
                        <span className="impact-record-meta">Institution {record.institution_id}<small>Version {record.version}</small></span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={recordQuery ? "No matching records" : "No records available"}>
                    {recordQuery ? "Try another name or student ID." : "No student records were returned for your account."}
                  </EmptyState>
                )}

                {studentLoading && <p className="field-help" role="status">Loading the selected record…</p>}

                {student && !studentLoading && (
                  <form className="impact-proposal" onSubmit={runPreview} noValidate>
                    <div className="impact-student-summary">
                      <p className="eyebrow">Selected student</p>
                      <h3>{student.full_name}</h3>
                      <p>Student ID {student.student_id} <span aria-hidden="true">·</span> Institution {student.institution_id}</p>
                      <span className="impact-version">Current record version {student.version}</span>
                    </div>

                    {fieldGroups.map((group) => (
                      <fieldset className="impact-fieldset" key={group.title}>
                        <legend>{group.title}</legend>
                        <div className="impact-fields">
                          {group.fields.map(([field, label, kind]) => {
                            const key = field as FieldKey;
                            const message = fieldErrors[key];
                            const value = changes[key] ?? (key === "apaar_identifier" ? "" : student[key]);
                            return (
                              <div className="field" key={field}>
                                <label htmlFor={`field-${field}`}>{label}</label>
                                {kind === "boolean" ? (
                                  <select
                                    id={`field-${field}`}
                                    className="select"
                                    value={String(value)}
                                    onChange={(event) => updateField(key, event.target.value === "true")}
                                    aria-invalid={Boolean(message)}
                                    aria-describedby={message ? `error-${field}` : undefined}
                                  >
                                    <option value="false">No</option><option value="true">Yes</option>
                                  </select>
                                ) : kind === "select" ? (
                                  <select
                                    id={`field-${field}`}
                                    className="select"
                                    value={String(value)}
                                    onChange={(event) => updateField(key, event.target.value)}
                                    aria-invalid={Boolean(message)}
                                    aria-describedby={message ? `error-${field}` : undefined}
                                  >
                                    <option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option>
                                  </select>
                                ) : (
                                  <input
                                    id={`field-${field}`}
                                    className="input"
                                    type={kind}
                                    maxLength={field === "full_name" ? 160 : field === "institution_id" ? 64 : field === "programme" ? 120 : field === "admission_category" ? 64 : undefined}
                                    value={String(value ?? "")}
                                    onChange={(event) => updateField(key, event.target.value)}
                                    aria-invalid={Boolean(message)}
                                    aria-describedby={message ? `error-${field}` : undefined}
                                  />
                                )}
                                {message && <span className="impact-field-error" id={`error-${field}`}>{message}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}

                    <div className="field impact-apaar-field">
                      <label htmlFor="field-apaar_identifier">APAAR identifier (optional replacement)</label>
                      <input
                        id="field-apaar_identifier"
                        className="input"
                        type="password"
                        inputMode="numeric"
                        maxLength={12}
                        autoComplete="off"
                        value={String(changes.apaar_identifier ?? "")}
                        onChange={(event) => updateField("apaar_identifier", event.target.value)}
                        aria-invalid={Boolean(fieldErrors.apaar_identifier)}
                        aria-describedby={fieldErrors.apaar_identifier ? "apaar-error" : "apaar-help"}
                      />
                      <span className="field-help" id="apaar-help">The stored identifier stays masked. Leave this blank to keep it unchanged; a replacement must contain exactly 12 digits.</span>
                      {fieldErrors.apaar_identifier && <span className="impact-field-error" id="apaar-error">{fieldErrors.apaar_identifier}</span>}
                    </div>

                    <div className="impact-proposal-footer">
                      <p className="field-help" aria-live="polite">{Object.keys(normalizedChanges).length} changed field{Object.keys(normalizedChanges).length === 1 ? "" : "s"}</p>
                      <button
                        className="button button-accent"
                        type="submit"
                        disabled={loading || Object.keys(normalizedChanges).length === 0 || Object.keys(fieldErrors).length > 0}
                      >
                        {loading ? "Preparing preview…" : "Preview changes"} <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <aside className="impact-aside">
                <p className="eyebrow">A careful process</p>
                <h2>Preview is not approval.</h2>
                <p>Review the backend’s findings first. A correction is only applied after an authorized person confirms it with a reason.</p>
                <p className="impact-aside-note">Linked student records are never changed automatically.</p>
              </aside>
            </div>
          )}

          {stage === 2 && preview && student && (
            <section className="impact-results" aria-labelledby="impact-results-title">
              <header className="impact-results-heading">
                <div>
                  <p className="eyebrow">Step 2 · Preview complete</p>
                  <h2 id="impact-results-title">{findings.length ? "Review needed before this change" : "No findings returned for this change"}</h2>
                  <p className="lede">This is the backend’s preview, not approval to apply the correction.</p>
                </div>
                <span className="impact-version">Record version {preview.expectedVersion}</span>
              </header>

              <div className="impact-results-grid">
                <section className="impact-findings" aria-label="Impact findings">
                  {findings.length ? findings.map((finding) => (
                    <article className={`impact-finding ${finding.category}`} key={finding.key}>
                      <div className="impact-finding-heading">
                        <span className={`impact-category ${finding.category}`}>
                          {finding.category === "confirmed" ? "Confirmed issue" : finding.category === "unverified" ? "Not verified" : "Needs review"}
                        </span>
                        <span className="impact-severity">Severity · {finding.severity}</span>
                      </div>
                      <h3>{finding.title}</h3>
                      <p>{finding.explanation}</p>
                      <p className="impact-action"><strong>Next step:</strong> {finding.action}</p>
                      {finding.affectedRecords.length > 0 && (
                        <p className="impact-count">{finding.affectedRecords.length} affected record{finding.affectedRecords.length === 1 ? "" : "s"}</p>
                      )}
                      {finding.humanReviewRequired && <p className="impact-review-required"><AlertTriangle size={14} aria-hidden="true" /> Human review required</p>}
                      {(finding.ruleId || finding.affectedRecords.length > 0 || finding.certainty) && (
                        <details className="impact-details">
                          <summary>Authorized reviewer details <ChevronDown size={14} aria-hidden="true" /></summary>
                          <dl>
                            <div><dt>Backend certainty</dt><dd>{finding.certainty}</dd></div>
                            <div><dt>Confirmed by backend</dt><dd>{finding.confirmed ? "Yes" : "No"}</dd></div>
                            {finding.ruleId && <div><dt>Finding reference</dt><dd>{finding.ruleId}</dd></div>}
                          </dl>
                          {finding.affectedRecords.length > 0 && (
                            <ul aria-label="Affected record references">{finding.affectedRecords.map((reference) => <li key={reference}>{reference}</li>)}</ul>
                          )}
                        </details>
                      )}
                    </article>
                  )) : (
                    <Notice kind="info">The preview returned no findings. This does not approve or apply the proposed change.</Notice>
                  )}
                </section>

                <aside className="impact-change-summary">
                  <p className="section-label">Proposed change</p>
                  <p className="impact-summary-name">{student.full_name} · {student.student_id}</p>
                  <p className="field-help">Institution {student.institution_id} · Current version {student.version}</p>
                  <div className="impact-change-head"><span>Field</span><span>Current</span><span>Proposed</span></div>
                  {Object.entries(preview.proposed_changes).map(([field, value]) => (
                    <div className="impact-change-row" key={field}>
                      <strong>{labels[field as FieldKey] ?? "Record field"}</strong>
                      <span>{oldValue(field)}</span>
                      <span>{displayValue(value, field)}</span>
                    </div>
                  ))}
                  <details className="impact-details impact-preview-details">
                    <summary>Preview reference <ChevronDown size={14} aria-hidden="true" /></summary>
                    <p>{preview.assessment.assessment_id}</p>
                  </details>
                </aside>
              </div>

              <footer className="impact-actions">
                <button className="button button-secondary" type="button" onClick={() => { setStage(1); setError(""); setConflict(false); }}>
                  <ArrowLeft size={15} aria-hidden="true" /> Edit proposed changes
                </button>
                <button className="button button-accent" type="button" onClick={() => { setStage(3); setError(""); setConflict(false); }} disabled={invalidPreviewVersion}>
                  Continue to confirmation <ArrowRight size={15} aria-hidden="true" />
                </button>
              </footer>
              {invalidPreviewVersion && <Notice kind="error">The preview version does not match the selected record. Reload the record and create a new preview.</Notice>}
            </section>
          )}

          {stage === 3 && preview && student && (
            <section className="impact-confirmation" aria-labelledby="confirm-title">
              <p className="eyebrow">Step 3 · Authorized confirmation</p>
              <h2 id="confirm-title">Confirm this correction</h2>
              <p className="lede">Check the record, version, and unresolved findings before authorizing the change.</p>

              <div className="impact-confirm-grid">
                <div className="impact-confirm-section">
                  <h3>Student record</h3>
                  <dl className="impact-student-facts">
                    <div><dt>Student</dt><dd>{student.full_name}</dd></div>
                    <div><dt>Student ID</dt><dd>{student.student_id}</dd></div>
                    <div><dt>Institution</dt><dd>{student.institution_id}</dd></div>
                    <div><dt>Current version</dt><dd>{student.version}</dd></div>
                  </dl>
                </div>

                <div className="impact-confirm-section">
                  <h3>Unresolved findings</h3>
                  {findings.length ? (
                    <ul className="impact-unresolved-list">
                      {findings.map((finding) => <li key={finding.key}>{finding.title} <span>· {finding.category === "confirmed" ? "Confirmed issue" : finding.category === "unverified" ? "Not verified" : "Needs review"}</span></li>)}
                    </ul>
                  ) : <p className="field-help">No findings were returned. This preview is still not an approval.</p>}
                </div>

                <div className="impact-confirm-section impact-confirm-changes">
                  <h3>Proposed changes</h3>
                  {Object.entries(preview.proposed_changes).map(([field, value]) => (
                    <div className="impact-confirm-change" key={field}>
                      <strong>{labels[field as FieldKey] ?? "Record field"}</strong>
                      <span>{oldValue(field)} <ArrowRight size={13} aria-hidden="true" /> {displayValue(value, field)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <form className="impact-reason-form" onSubmit={applyCorrection} noValidate>
                <div className="field">
                  <label htmlFor="correction-reason">Reason for correction <span aria-hidden="true">*</span></label>
                  <textarea
                    id="correction-reason"
                    className="textarea"
                    minLength={3}
                    maxLength={1000}
                    required
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    aria-describedby="reason-help"
                    placeholder="Briefly explain why this correction is needed."
                  />
                  <span className="field-help" id="reason-help">Required · 3–1,000 characters. This reason is recorded with the correction.</span>
                  {reason.length > 0 && reason.trim().length < 3 && <span className="impact-field-error">Enter at least 3 non-space characters.</span>}
                  {reason.trim().length > 1000 && <span className="impact-field-error">The reason must be 1,000 characters or fewer.</span>}
                </div>

                <Notice kind="info">Confirming authorizes an update to this student record and creates the audit record. Linked records will not be changed automatically.</Notice>
                {invalidPreviewVersion && <Notice kind="error">The record version changed since preview. Reload the record and review a new preview before confirming.</Notice>}

                <div className="impact-actions">
                  <button className="button button-secondary" type="button" onClick={() => { setStage(2); setError(""); setConflict(false); }} disabled={loading}>
                    <ArrowLeft size={15} aria-hidden="true" /> Go back
                  </button>
                  <button
                    className="button button-accent"
                    type="submit"
                    disabled={loading || invalidPreviewVersion || reason.trim().length < 3 || reason.trim().length > 1000}
                  >
                    {loading ? "Applying correction…" : "Confirm and apply correction"}
                  </button>
                </div>
              </form>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}

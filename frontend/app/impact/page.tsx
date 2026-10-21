"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, CircleHelp } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, Notice, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Assessment, Finding, ReviewTask, Student, StudentChanges } from "@/lib/types";

const fields = [
  ["full_name", "Full name", "text"],
  ["institution_id", "Institution ID", "text"],
  ["programme", "Programme", "text"],
  ["academic_year", "Academic year", "text"],
  ["admission_date", "Admission date", "date"],
  ["admission_category", "Admission category", "text"],
  ["status", "Record status", "select"],
  ["nri_status", "NRI status", "boolean"],
  ["oci_status", "OCI status", "boolean"],
  ["foreign_national_status", "Foreign national", "boolean"],
  ["supernumerary_seat_status", "Supernumerary seat", "boolean"],
] as const;
type FieldKey = typeof fields[number][0] | "apaar_identifier";

export default function ImpactPage() {
  const [records, setRecords] = useState<Student[]>([]);
  const [recordQuery, setRecordQuery] = useState("");
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordId, setRecordId] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [changes, setChanges] = useState<Partial<Record<FieldKey, string | boolean>>>({});
  const [preview, setPreview] = useState<{ assessment: Assessment; proposed_changes: Record<string, unknown>; checklist: Array<Pick<ReviewTask, "title" | "explanation" | "suggested_action" | "severity" | "priority">> } | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ student: Student; assessment: Assessment; review_tasks: ReviewTask[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(1);
  const normalizedChanges = useMemo(() => {
    const filtered: Partial<Record<FieldKey, string | boolean>> = {};
    if (!student) return filtered;
    for (const key of Object.keys(changes) as FieldKey[]) {
      const value = changes[key];
      if (value === undefined) continue;
      const current = key === "apaar_identifier" ? "" : student[key];
      if (String(current ?? "") !== String(value)) filtered[key] = value;
    }
    return filtered;
  }, [changes, student]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: "1", page_size: "100" });
    if (recordQuery.trim()) params.set("q", recordQuery.trim());
    api.students(params).then((response) => {
      if (active) {
        setRecords(response.items);
        setRecordsLoading(false);
      }
    }).catch((cause) => {
      if (active) {
        setError(errorMessage(cause));
        setRecordsLoading(false);
      }
    });
    return () => { active = false; };
  }, [recordQuery]);
  useEffect(() => {
    if (!recordId) return;
    let active = true;
    api.student(recordId).then((item) => {
      if (!active) return;
      setStudent(item); setChanges({}); setPreview(null); setResult(null); setError("");
    }).catch((cause) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [recordId]);

  function updateField(field: FieldKey, value: string | boolean) {
    setChanges((current) => ({ ...current, [field]: value }));
    setPreview(null);
  }

  function buildChanges(): StudentChanges {
    const result: StudentChanges = {};
    if (normalizedChanges.full_name !== undefined) result.full_name = String(normalizedChanges.full_name);
    if (normalizedChanges.institution_id !== undefined) result.institution_id = String(normalizedChanges.institution_id);
    if (normalizedChanges.programme !== undefined) result.programme = String(normalizedChanges.programme);
    if (normalizedChanges.academic_year !== undefined) result.academic_year = String(normalizedChanges.academic_year);
    if (normalizedChanges.admission_date !== undefined) result.admission_date = String(normalizedChanges.admission_date);
    if (normalizedChanges.admission_category !== undefined) result.admission_category = String(normalizedChanges.admission_category);
    if (normalizedChanges.status === "active" || normalizedChanges.status === "archived" || normalizedChanges.status === "suspended") result.status = normalizedChanges.status;
    if (normalizedChanges.nri_status !== undefined) result.nri_status = normalizedChanges.nri_status === true;
    if (normalizedChanges.oci_status !== undefined) result.oci_status = normalizedChanges.oci_status === true;
    if (normalizedChanges.foreign_national_status !== undefined) result.foreign_national_status = normalizedChanges.foreign_national_status === true;
    if (normalizedChanges.supernumerary_seat_status !== undefined) result.supernumerary_seat_status = normalizedChanges.supernumerary_seat_status === true;
    if (normalizedChanges.apaar_identifier !== undefined) result.apaar_identifier = String(normalizedChanges.apaar_identifier);
    return result;
  }

  async function runPreview() {
    if (!student || Object.keys(normalizedChanges).length === 0) return;
    setLoading(true); setError(""); setResult(null);
    try {
      setPreview(await api.previewCorrection(student.record_id, buildChanges(), student.version));
      setStage(3);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  async function apply() {
    if (!student || !preview || reason.trim().length < 3) return;
    if (!window.confirm("Apply this correction to the selected record? Linked records will not be changed automatically.")) return;
    setLoading(true); setError("");
    try {
      const applied = await api.applyCorrection(student.record_id, buildChanges(), student.version, reason.trim());
      setResult(applied); setStudent(applied.student); setPreview(null); setStage(4);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setLoading(false); }
  }

  const oldValue = (key: string): string => {
    const value = key === "apaar_identifier" ? student?.masked_apaar_identifier : student?.[key as keyof Student];
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value ?? "—");
  };
  const showValue = (value: unknown): string => typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—");
  const findings = preview?.assessment.findings ?? [];
  const invalidApaar = typeof normalizedChanges.apaar_identifier === "string"
    && !/^\d{12}$/.test(normalizedChanges.apaar_identifier);

  return <AppShell>
    <PageHeading eyebrow="Signature workflow · deterministic review" title="Before the record changes." description="Preview the correction, examine the backend's rule-based findings, then confirm the write. Linked records are never silently modified." />
    {error && <div style={{ marginBottom: 18 }}><LoadError>{error}</LoadError></div>}
    {result ? <section className="panel panel-pad">
      <p className="eyebrow">Correction applied</p><h2>Version {result.student.version} is now current.</h2>
      <p className="lede" style={{ marginBottom: 18 }}>The API applied the correction and returned {result.review_tasks.length} review task{result.review_tasks.length === 1 ? "" : "s"}. No linked records were automatically updated.</p>
      <div className="row" style={{ flexDirection: "row" }}><StatusBadge value={result.assessment.status} /><span className="field-help">Assessment {result.assessment.assessment_id}</span></div>
      {result.review_tasks.length > 0 && <div style={{ marginTop: 20 }}>{result.review_tasks.map((task) => <div className="finding" key={task.task_id}><div className="finding-title"><AlertTriangle size={15} />{task.title}</div><p>{task.explanation}</p></div>)}</div>}
      <button className="button" onClick={() => { setResult(null); setPreview(null); setChanges({}); setStage(1); }}>Start another assessment</button>
    </section> : <>
      <ol className="stage-list" aria-label="Correction workflow stages">
        {["Select record", "Propose change", "Review impact", "Confirm"].map((label, index) => <li className={`stage ${stage === index + 1 ? "active" : ""}`} key={label}><span className="stage-number">{index + 1}</span>{label}</li>)}
      </ol>
      <section className="split">
        <div className="panel panel-pad">
          <div className="field"><label htmlFor="record-search">1 · Find a record by student ID or name</label><input id="record-search" className="input" value={recordQuery} onChange={(event) => { setRecordsLoading(true); setRecordQuery(event.target.value); }} placeholder="Search the authorized record set" /><span className="field-help">Search uses the backend's student ID/name query and displays up to 100 matching results.</span></div>
          <div className="field"><label htmlFor="record">Select an existing record</label><select id="record" className="select" value={recordId} onChange={(event) => { setStudent(null); setChanges({}); setPreview(null); setResult(null); setError(""); setRecordId(event.target.value); setStage(1); }}><option value="">{recordsLoading ? "Searching records…" : "Choose a student record"}</option>{records.map((record) => <option key={record.record_id} value={record.record_id}>{record.full_name} · {record.student_id} · v{record.version}</option>)}</select></div>
          {student && <>
            <div className="notice"><strong>{student.full_name}</strong> · {student.student_id} · {student.institution_id} · version {student.version}. Proposed changes are not applied until the final confirmation.</div>
            <hr className="divider" />
            <p className="section-label">2 · Proposed values</p>
            <div className="form-grid">
              {fields.map(([key, label, kind]) => <div className="field" key={key}>
                <label htmlFor={`field-${key}`}>{label}</label>
                {kind === "boolean" ? <select id={`field-${key}`} className="select" value={String(changes[key] ?? student[key])} onChange={(event) => updateField(key, event.target.value === "true")}><option value="false">No</option><option value="true">Yes</option></select>
                  : kind === "select" ? <select id={`field-${key}`} className="select" value={String(changes[key] ?? student[key])} onChange={(event) => updateField(key, event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option></select>
                    : <input id={`field-${key}`} className="input" type={kind} value={String(changes[key] ?? student[key] ?? "")} onChange={(event) => updateField(key, event.target.value)} />}
              </div>)}
            </div>
            <div className="field"><label htmlFor="field-apaar_identifier">APAAR identifier (optional replacement)</label><input id="field-apaar_identifier" className="input" type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={String(changes.apaar_identifier ?? "")} onChange={(event) => updateField("apaar_identifier", event.target.value)} aria-describedby="apaar-help" aria-invalid={invalidApaar} /><span className="field-help" id="apaar-help">The stored identifier is masked. Leave blank to keep it unchanged; an entered value is sent only to the backend for validation and is not saved in browser storage. Enter exactly 12 digits to replace it.</span>{invalidApaar && <span className="field-help" style={{ color: "var(--danger)" }}>Enter exactly 12 digits.</span>}</div>
            <div className="row" style={{ flexDirection: "row" }}><span className="field-help">{Object.keys(normalizedChanges).length} changed field(s)</span><button className="button button-accent" disabled={loading || invalidApaar || !Object.keys(normalizedChanges).length} onClick={runPreview}>{loading ? "Checking…" : "Preview impact"} <ArrowRight size={15} /></button></div>
          </>}
        </div>
        <aside className="panel panel-pad" style={{ background: "var(--lavender)" }}>
          <p className="eyebrow">What this check means</p><h2>Rules first. People decide.</h2>
          <p className="lede">Deterministic backend rules identify possible inconsistencies. Confirmed findings and potential impacts are labeled separately.</p>
          <div className="notice" style={{ marginTop: 17 }}><CircleHelp size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />A preview is read-only. Applying requires the observed record version and a reason.</div>
          <p className="field-help" style={{ marginTop: 18 }}>Gemini is not integrated. No AI-generated assessment is shown.</p>
        </aside>
      </section>
      {preview && <section className="panel panel-pad" style={{ marginTop: 20 }}>
        <div className="row" style={{ flexDirection: "row", alignItems: "flex-start" }}><div><p className="eyebrow">3 · Actual API preview</p><h2>Assessment findings</h2><p className="lede">Preview ID {preview.assessment.assessment_id} · status: {preview.assessment.status}</p></div><StatusBadge value={preview.assessment.status} /></div>
        <div style={{ marginTop: 20 }}><p className="section-label">Changed values</p>{Object.entries(preview.proposed_changes).map(([key, value]) => <div className="change-row" key={key}><strong>{key.replaceAll("_", " ")}</strong><span>{oldValue(key)}</span><span className="change-proposed">{showValue(value)}</span></div>)}</div>
        <div style={{ marginTop: 22 }}><p className="section-label">Impact findings · actual API response</p>{findings.length ? findings.map((finding: Finding) => <div className="finding" key={finding.rule_id}>
          <div className="finding-title"><AlertTriangle size={15} />{finding.title}<StatusBadge value={finding.severity} /><StatusBadge value={finding.confirmed ? "confirmed" : "potential"} /></div>
          <p>{finding.explanation}</p><p><strong>Recommended check:</strong> {finding.recommended_action}</p>
          <span className="field-help">Certainty: {finding.certainty} · Human review required: {finding.human_review_required ? "Yes" : "No"}</span>
          {finding.affected_records.length > 0 && <div className="record-map" aria-label={`Affected records for ${finding.title}`}><span className="map-node primary">Selected · {student?.record_id}</span><span className="map-line" />{finding.affected_records.map((item) => <span className="map-node" key={item}>{item}</span>)}</div>}
        </div>) : <Notice kind="success"><Check size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />The API returned no findings for this proposed change.</Notice>}</div>
        {preview.checklist.length > 0 && <div style={{ marginTop: 22 }}><p className="section-label">Review checklist returned by the API</p>{preview.checklist.map((task, index) => <div className="finding" key={`${task.title}-${index}`}><div className="finding-title">{task.title}<StatusBadge value={task.severity} /></div><p>{task.explanation}</p><p><strong>Suggested action:</strong> {task.suggested_action}</p></div>)}</div>}
        <div className="notice" style={{ marginTop: 18 }}>Potentially affected linked records are review leads only. The backend will not automatically change them.</div>
        <div style={{ marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 19 }}>
          <p className="eyebrow">4 · Authorized confirmation</p><div className="field"><label htmlFor="reason">Reason for correction</label><textarea id="reason" className="textarea" minLength={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Document why this change is being requested." /></div>
          <div className="row" style={{ flexDirection: "row" }}><span className="field-help">Applying writes a new version, assessment, audit event, and returned review tasks in a transaction.</span><button className="button button-accent" disabled={loading || reason.trim().length < 3} onClick={apply}>{loading ? "Applying…" : "Confirm and apply"}</button></div>
        </div>
      </section>}
      {!student && records.length === 0 && <div className="panel-flat" style={{ marginTop: 18 }}><EmptyState title="No selectable records">No records were returned for this account. Confirm your role and backend availability.</EmptyState></div>}
    </>}
  </AppShell>;
}

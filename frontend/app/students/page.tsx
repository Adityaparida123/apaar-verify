"use client";

import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import type { Student, StudentCreateRequest } from "@/lib/types";

const emptyStudent = (): StudentCreateRequest => ({
  student_id: "",
  apaar_identifier: null,
  full_name: "",
  institution_id: "",
  programme: "",
  academic_year: "",
  admission_date: "",
  admission_category: "regular",
  nri_status: false,
  oci_status: false,
  foreign_national_status: false,
  supernumerary_seat_status: false,
  status: "active",
});

export default function StudentsPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<StudentCreateRequest>(emptyStudent);
  const [createBusy, setCreateBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: "50" });
    if (query.trim()) params.set("q", query.trim());
    api.students(params).then((result) => { setStudents(result.items); setTotal(result.total); setError(""); })
      .catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false));
  }, [query, page, refresh]);

  async function createRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const apaar = createForm.apaar_identifier?.trim() || null;
    if (apaar && !/^\d{12}$/.test(apaar)) {
      setError("APAAR identifier must contain exactly 12 digits.");
      return;
    }
    const institutionId = user?.role === "institution_admin"
      ? user.institution_id ?? ""
      : createForm.institution_id.trim();
    setCreateBusy(true);
    try {
      const created = await api.createStudent({
        ...createForm,
        student_id: createForm.student_id.trim(),
        full_name: createForm.full_name.trim(),
        institution_id: institutionId,
        programme: createForm.programme.trim(),
        academic_year: createForm.academic_year.trim(),
        admission_category: createForm.admission_category.trim(),
        apaar_identifier: apaar,
      });
      setCreateForm(emptyStudent());
      setCreateOpen(false);
      setPage(1);
      setQuery(created.student_id);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setCreateBusy(false);
    }
  }

  function updateForm<K extends keyof StudentCreateRequest>(key: K, value: StudentCreateRequest[K]) {
    setCreateForm((current) => ({ ...current, [key]: value }));
  }

  return <AppShell>
    <PageHeading eyebrow="Student records" title="The record, in context." description="Search by student ID or name. Institution access is restricted by the backend to your assigned scope." action={<button className="button button-accent" onClick={() => setCreateOpen((value) => !value)}><Plus size={15} />{createOpen ? "Close form" : "Add student"}</button>} />
    {createOpen && <section className="panel panel-pad" style={{ marginBottom: 20 }}>
      <p className="eyebrow">New record · API-backed</p><h2>Register a student</h2>
      <p className="lede" style={{ marginBottom: 17 }}>The backend validates institution/programme configuration and commits the record, initial version, and audit event transactionally. An unsuccessful request is shown as an error.</p>
      <form onSubmit={createRecord}>
        <div className="form-grid">
          <div className="field"><label htmlFor="new-student-id">Student ID</label><input className="input" id="new-student-id" minLength={1} maxLength={64} pattern="[A-Za-z0-9._-]+" value={createForm.student_id} onChange={(event) => updateForm("student_id", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-name">Full name</label><input className="input" id="new-name" maxLength={160} value={createForm.full_name} onChange={(event) => updateForm("full_name", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-institution">Institution ID</label>{user?.role === "institution_admin" ? <input className="input" id="new-institution" value={user.institution_id ?? ""} readOnly /> : <input className="input" id="new-institution" maxLength={64} pattern="[A-Za-z0-9._-]+" value={createForm.institution_id} onChange={(event) => updateForm("institution_id", event.target.value)} required />}</div>
          <div className="field"><label htmlFor="new-programme">Programme</label><input className="input" id="new-programme" maxLength={120} value={createForm.programme} onChange={(event) => updateForm("programme", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-year">Academic year</label><input className="input" id="new-year" placeholder="2025-26" pattern="[0-9]{4}-[0-9]{2}" value={createForm.academic_year} onChange={(event) => updateForm("academic_year", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-admission-date">Admission date</label><input className="input" id="new-admission-date" type="date" value={createForm.admission_date} onChange={(event) => updateForm("admission_date", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-category">Admission category</label><input className="input" id="new-category" maxLength={64} value={createForm.admission_category} onChange={(event) => updateForm("admission_category", event.target.value)} required /></div>
          <div className="field"><label htmlFor="new-apaar">APAAR identifier (optional)</label><input className="input" id="new-apaar" type="password" inputMode="numeric" maxLength={12} autoComplete="off" value={createForm.apaar_identifier ?? ""} onChange={(event) => updateForm("apaar_identifier", event.target.value || null)} /><span className="field-help">Stored as a keyed hash; never displayed in full.</span></div>
        </div>
        <div className="form-grid">
          {([
            ["nri_status", "NRI"],
            ["oci_status", "OCI"],
            ["foreign_national_status", "Foreign national"],
            ["supernumerary_seat_status", "Supernumerary seat"],
          ] as const).map(([key, label]) => <label key={key} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14, fontSize: 12 }}><input type="checkbox" checked={createForm[key]} onChange={(event) => updateForm(key, event.target.checked)} />{label}</label>)}
        </div>
        <button className="button" disabled={createBusy}>{createBusy ? "Saving…" : "Create record"}</button>
      </form>
    </section>}
    <div className="toolbar"><div style={{ flex: "1 1 260px", position: "relative" }}><Search size={16} style={{ position: "absolute", top: 13, left: 12, color: "var(--muted)" }} /><input className="input" style={{ paddingLeft: 36 }} aria-label="Search records" placeholder="Search student ID or name" value={query} onChange={(event) => { setLoading(true); setPage(1); setQuery(event.target.value); }} /></div><span className="field-help">{total.toLocaleString()} matching records · page {page}</span></div>
    {error && <LoadError>{error}</LoadError>}
    {loading ? <p className="lede">Loading records…</p> : students.length === 0 ? <div className="panel-flat"><EmptyState title="No records found">{query ? "Try a different student ID or name." : "No student records were returned for this account."}</EmptyState></div> :
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Student ID</th><th>Institution</th><th>Programme</th><th>Year</th><th>Status</th><th>Version</th><th /></tr></thead><tbody>
        {students.map((student) => <tr key={student.record_id}><td><Link href={`/students/${encodeURIComponent(student.record_id)}`} style={{ color: "var(--ink)", fontWeight: 700 }}>{student.full_name}</Link></td><td>{student.student_id}</td><td>{student.institution_id}</td><td>{student.programme}</td><td>{student.academic_year}</td><td><StatusBadge value={student.status} /></td><td>v{student.version}</td><td><Link href={`/students/${encodeURIComponent(student.record_id)}`} className="button button-secondary button-small">View</Link></td></tr>)}
      </tbody></table></div>}
    <div className="row" style={{ marginTop: 16, flexDirection: "row" }}><button className="button button-secondary button-small" disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPage((n) => n - 1); }}>Previous</button><span className="field-help">Showing up to 50 per page</span><button className="button button-secondary button-small" disabled={page * 50 >= total || loading} onClick={() => { setLoading(true); setPage((n) => n + 1); }}>Next</button></div>
  </AppShell>;
}

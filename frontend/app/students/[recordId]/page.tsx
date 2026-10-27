"use client";

import Link from "next/link";
import { ArrowLeft, FileSearch } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadError, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Student } from "@/lib/types";

export default function StudentDetailsPage() {
  const params = useParams<{ recordId: string }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.student(params.recordId).then(setStudent).catch((cause) => setError(errorMessage(cause))); }, [params.recordId]);
  return <AppShell>
    <PageHeading eyebrow="Student record" title={student?.full_name ?? "Record details"} description="Current record details returned by the API. The record ID is used for API routes; student ID is not used as a URL key." action={<Link className="button button-secondary" href="/students"><ArrowLeft size={15} />All records</Link>} />
    {error && <LoadError>{error}</LoadError>}
    {!student && !error && <p className="lede">Loading record…</p>}
    {student && <>
      <div className="split">
        <section className="panel panel-pad">
          <div className="row" style={{ flexDirection: "row", marginBottom: 12 }}><h2 style={{ margin: 0 }}>Current record</h2><StatusBadge value={student.status} /></div>
          <div className="form-grid">
            {([
              ["Student ID", student.student_id],
              ["Institution", student.institution_id],
              ["Programme", student.programme],
              ["Academic year", student.academic_year],
              ["Admission date", student.admission_date],
              ["Admission category", student.admission_category],
              ["Version", `v${student.version}`],
              ["APAAR identifier", student.masked_apaar_identifier ?? "Not supplied"],
              ["NRI", student.nri_status ? "Yes" : "No"],
              ["OCI", student.oci_status ? "Yes" : "No"],
              ["Foreign national", student.foreign_national_status ? "Yes" : "No"],
              ["Supernumerary seat", student.supernumerary_seat_status ? "Yes" : "No"],
            ] as Array<[string, string]>).map(([label, value]) => <div className="field" key={label}><label>{label}</label><div>{value}</div></div>)}
          </div>
          <Link href="/impact" className="button button-accent"><FileSearch size={15} />Review a proposed correction</Link>
        </section>
        <section className="panel panel-pad" style={{ background: "var(--surface-tint)" }}>
          <p className="eyebrow">Record history</p><h2>History is not exposed here.</h2>
          <p className="lede" style={{ marginBottom: 14 }}>The backend preserves record versions internally but does not currently provide a version-history listing endpoint. No history is simulated in this view.</p>
          <div className="notice">Current version: v{student.version}. Use the impact detector to preview a proposed update against this version.</div>
        </section>
      </div>
    </>}
  </AppShell>;
}

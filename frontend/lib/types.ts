export type Role = "institution_admin" | "aicte_official" | "verifier";

export interface User {
  user_id: string;
  email: string;
  role: Role;
  institution_id: string | null;
}

export interface Student {
  record_id: string;
  student_id: string;
  full_name: string;
  institution_id: string;
  programme: string;
  academic_year: string;
  admission_date: string;
  admission_category: string;
  nri_status: boolean;
  oci_status: boolean;
  foreign_national_status: boolean;
  supernumerary_seat_status: boolean;
  status: "active" | "archived" | "suspended";
  version: number;
  masked_apaar_identifier?: string | null;
}

export interface StudentCreateRequest {
  student_id: string;
  apaar_identifier?: string | null;
  full_name: string;
  institution_id: string;
  programme: string;
  academic_year: string;
  admission_date: string;
  admission_category: string;
  nri_status: boolean;
  oci_status: boolean;
  foreign_national_status: boolean;
  supernumerary_seat_status: boolean;
  status: Student["status"];
}

export interface Finding {
  rule_id: string;
  title: string;
  explanation: string;
  affected_records: string[];
  severity: "low" | "medium" | "high" | "critical";
  certainty: string;
  recommended_action: string;
  human_review_required: boolean;
  confirmed: boolean;
}

export interface Assessment {
  assessment_id: string;
  record_id: string;
  institution_id: string;
  triggering_version: number;
  changed_fields: string[];
  findings: Finding[];
  status: string;
  created_at: string;
}

export interface ReviewTask {
  task_id: string;
  assessment_id: string;
  affected_record_id: string | null;
  institution_id: string;
  title: string;
  explanation: string;
  suggested_action: string;
  severity: Finding["severity"];
  priority: number;
  status: string;
  assigned_reviewer: string | null;
  review_note: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

export interface DashboardSummary {
  total_active_students: number;
  total_registered_institutions: number;
  approved_intake: number;
  actual_enrolment: number;
  remaining_capacity: number;
  excess_enrolment: number;
  records_needing_review: number;
  open_review_tasks: number;
  intake_comparisons: IntakeComparison[];
  recent_changes: AuditEvent[];
}

export interface IntakeComparison {
  institution_id: string;
  programme: string;
  academic_year: string | null;
  approved_intake: number | null;
  actual_enrolment: number;
  remaining_capacity: number | null;
  excess_enrolment: number | null;
  regular_enrolment: number;
  supernumerary_enrolment: number;
  supernumerary_limit: number | null;
  supernumerary_excess: number | null;
}

export interface AuditEvent {
  actor_id: string;
  actor_role: Role;
  action: string;
  target_record_id: string | null;
  institution_id: string | null;
  changed_fields: string[];
  timestamp: string;
  outcome: string;
  reason: string | null;
}

export type StudentChanges = Partial<Pick<
  Student,
  | "full_name"
  | "institution_id"
  | "programme"
  | "academic_year"
  | "admission_date"
  | "admission_category"
  | "nri_status"
  | "oci_status"
  | "foreign_national_status"
  | "supernumerary_seat_status"
  | "status"
>> & { apaar_identifier?: string | null };

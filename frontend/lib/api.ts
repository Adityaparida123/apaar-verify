import type {
  Assessment,
  AuditEvent,
  DashboardSummary,
  IntakeComparison,
  PageResult,
  ReviewTask,
  Student,
  StudentCreateRequest,
  StudentChanges,
  User,
} from "@/lib/types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    const message = typeof detail === "string" ? detail : "The request could not be completed.";
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("apaar_access_token");
}

export function storeToken(token: string): void {
  window.sessionStorage.setItem("apaar_access_token", token);
}

export function clearToken(): void {
  window.sessionStorage.removeItem("apaar_access_token");
}

async function request<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined) headers.set("Content-Type", "application/json");
  const token = authenticated ? getStoredToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch {
    throw new Error(`Cannot reach the backend at ${API_URL}. Check that it is running and that CORS allows this frontend origin.`);
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated && typeof window !== "undefined") {
      clearToken();
      window.dispatchEvent(new Event("apaar:unauthorized"));
    }
    let detail: unknown;
    try {
      const body: unknown = await response.json();
      detail = typeof body === "object" && body !== null && "detail" in body
        ? (body as { detail: unknown }).detail
        : body;
    } catch {
      detail = response.statusText || "Request failed";
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string; token_type: string; expires_in: number }>(
      "/api/v1/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      false,
    ),
  googleLogin: (credential: string) =>
    request<{ access_token: string; token_type: string; expires_in: number }>(
      "/api/v1/auth/google",
      { method: "POST", body: JSON.stringify({ credential }) },
      false,
    ),
  me: () => request<User>("/api/v1/auth/me"),
  students: (params: URLSearchParams) =>
    request<PageResult<Student>>(`/api/v1/students?${params.toString()}`),
  createStudent: (payload: StudentCreateRequest) =>
    request<Student>("/api/v1/students", { method: "POST", body: JSON.stringify(payload) }),
  student: (recordId: string) => request<Student>(`/api/v1/students/${encodeURIComponent(recordId)}`),
  previewCorrection: (recordId: string, changes: StudentChanges, expectedVersion: number) =>
    request<{
      assessment: Assessment;
      proposed_changes: Record<string, string | number | boolean | null>;
      checklist: Array<Pick<ReviewTask, "title" | "explanation" | "suggested_action" | "severity" | "priority">>;
    }>(`/api/v1/students/${encodeURIComponent(recordId)}/correction-preview`, {
      method: "POST",
      body: JSON.stringify({ changes, expected_version: expectedVersion }),
    }),
  applyCorrection: (recordId: string, changes: StudentChanges, expectedVersion: number, reason: string) =>
    request<{ student: Student; assessment: Assessment; review_tasks: ReviewTask[] }>(
      `/api/v1/students/${encodeURIComponent(recordId)}/corrections`,
      { method: "POST", body: JSON.stringify({ changes, expected_version: expectedVersion, reason }) },
    ),
  dashboard: () => request<DashboardSummary>("/api/v1/dashboard/summary"),
  intake: () => request<{ items: IntakeComparison[] }>("/api/v1/dashboard/intake"),
  reviewTasks: (params: URLSearchParams) => request<PageResult<ReviewTask>>(`/api/v1/review-tasks?${params}`),
  updateReviewTask: (taskId: string, payload: { status: "in_progress" | "resolved" | "dismissed"; review_note: string; outcome?: string }) =>
    request<ReviewTask>(`/api/v1/review-tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  audit: (page: number) => request<PageResult<AuditEvent>>(`/api/v1/audit?page=${page}&page_size=50`),
  issueToken: (recordId: string, expiresInDays: number) =>
    request<{ token_id: string; token: string; expires_at: string; notice: string }>(
      "/api/v1/verification-tokens",
      { method: "POST", body: JSON.stringify({ record_id: recordId, expires_in_days: expiresInDays }) },
    ),
  verifyToken: (token: string) =>
    request<{ valid: boolean; status?: string; claims: Record<string, unknown>; notice: string }>(
      `/api/v1/verify/${encodeURIComponent(token)}`,
      {},
      false,
    ),
  revokeToken: (tokenId: string) =>
    request<{ status: string }>(`/api/v1/verification-tokens/${encodeURIComponent(tokenId)}/revoke`, { method: "POST" }),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session is missing or expired. Sign in again.";
    if (error.status === 403) return "Your account does not have permission for this action.";
    if (error.status === 409) return "The record changed since it was loaded. Refresh it and create a new preview.";
    if (error.status === 422 && typeof error.detail === "object" && error.detail !== null) {
      return JSON.stringify(error.detail);
    }
    return error.message;
  }
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

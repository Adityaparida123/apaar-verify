import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, FileText } from "lucide-react";

export function PageHeading({ eyebrow, title, description, action }: {
  eyebrow: string; title: string; description: string; action?: ReactNode;
}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="lede">{description}</p></div>{action}</div>;
}

export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "error" | "success" }) {
  return <div className={`notice ${kind === "error" ? "notice-error" : kind === "success" ? "notice-success" : ""}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty-state"><FileText size={24} /><h3>{title}</h3><p>{children}</p></div>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const kind = ["active", "resolved", "complete", "valid", "success"].includes(normalized)
    ? "status-good" : ["open", "pending", "in_progress", "preview", "requires_revalidation", "medium", "potential"].includes(normalized)
      ? "status-warning" : ["archived", "revoked", "expired", "dismissed", "invalid", "high", "critical", "confirmed"].includes(normalized)
        ? "status-danger" : "status-neutral";
  return <span className={`status ${kind}`}>{value.replaceAll("_", " ")}</span>;
}

export function LoadError({ children }: { children: ReactNode }) {
  return <Notice kind="error"><AlertCircle size={15} style={{ verticalAlign: "middle", marginRight: 6 }} />{children}</Notice>;
}

export function SuccessIcon() {
  return <CheckCircle2 size={17} aria-hidden="true" />;
}

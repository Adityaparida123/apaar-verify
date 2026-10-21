"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, LoadError, Notice, PageHeading, StatusBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { ReviewTask } from "@/lib/types";

export default function ReviewPage() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(() => {
    api.reviewTasks(new URLSearchParams({ page: "1", page_size: "100" })).then((response) => { setTasks(response.items); setError(""); })
      .catch((cause) => setError(errorMessage(cause))).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function update(task: ReviewTask, status: "in_progress" | "resolved" | "dismissed") {
    const note = (notes[task.task_id] ?? "").trim();
    if (!note) { setError("Add a review note before updating a task."); return; }
    if (status === "resolved" && !(outcomes[task.task_id] ?? "").trim()) { setError("A resolved task requires an outcome."); return; }
    setBusy(task.task_id); setError(""); setSuccess("");
    try {
      await api.updateReviewTask(task.task_id, { status, review_note: note, ...(status === "resolved" ? { outcome: outcomes[task.task_id].trim() } : {}) });
      setSuccess(`Task updated to ${status.replaceAll("_", " ")}.`);
      load();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  }
  return <AppShell>
    <PageHeading eyebrow="Human review" title="A queue for considered decisions." description="Review tasks created by real correction assessments. Status changes and findings are submitted to the backend audit trail." />
    {error && <LoadError>{error}</LoadError>}{success && <div style={{ marginTop: 14 }}><Notice kind="success">{success}</Notice></div>}
    {loading ? <p className="lede">Loading review tasks…</p> : tasks.length === 0 ? <div className="panel-flat"><EmptyState title="No review tasks returned">The API reports no tasks in this page of results.</EmptyState></div> : <div className="panel panel-pad" style={{ marginTop: 19 }}>
      {tasks.map((task) => <article className="review-task" key={task.task_id}>
        <div><div className="row" style={{ flexDirection: "row", justifyContent: "flex-start", marginBottom: 5 }}><div className="task-title">{task.title}</div><StatusBadge value={task.severity} /><StatusBadge value={task.status} /></div>
          <p className="task-copy">{task.explanation}</p><p className="field-help">Suggested action: {task.suggested_action}</p>
          <p className="field-help">Record: {task.affected_record_id ?? "Not specified"} · Assessment: {task.assessment_id} · Priority {task.priority}</p>
          {task.review_note && <p className="field-help">Existing note: {task.review_note}</p>}
          {task.status !== "resolved" && task.status !== "dismissed" && <>
            <div className="field" style={{ marginTop: 12 }}><label htmlFor={`note-${task.task_id}`}>Review note</label><textarea id={`note-${task.task_id}`} className="textarea" value={notes[task.task_id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [task.task_id]: event.target.value }))} /></div>
            <div className="field"><label htmlFor={`outcome-${task.task_id}`}>Outcome (required to resolve)</label><input id={`outcome-${task.task_id}`} className="input" value={outcomes[task.task_id] ?? ""} onChange={(event) => setOutcomes((current) => ({ ...current, [task.task_id]: event.target.value }))} /></div>
            <div className="toolbar"><button className="button button-secondary button-small" disabled={busy === task.task_id} onClick={() => update(task, "in_progress")}>Mark in progress</button><button className="button button-accent button-small" disabled={busy === task.task_id} onClick={() => update(task, "resolved")}>{busy === task.task_id ? "Saving…" : "Resolve with outcome"}</button><button className="button button-secondary button-small" disabled={busy === task.task_id} onClick={() => update(task, "dismissed")}>Dismiss</button></div>
          </>}
        </div>
      </article>)}
    </div>}
  </AppShell>;
}

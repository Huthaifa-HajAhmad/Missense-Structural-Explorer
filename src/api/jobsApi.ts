/**
 * jobsApi.ts — the browser side of the queue's per-person routes (`server/routes/biophysics/polling.ts`):
 * `GET /my-jobs` and `POST /jobs/:id/cancel`. Same transport and error type as `accountApi.ts`: the
 * session cookie identifies the person, and a failure's `message` is the server's own sentence.
 */
import { AccountError } from "./accountApi";
import type { JobRunsOn } from "../shared/jobPlacement";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface JobSummary {
  id: string;
  type: "foldx" | "p2rank";
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error?: string;
  /** The caller's own id when they own it; null for a job they only joined. */
  ownerId: string | null;
  mine: boolean;
  /** Jobs ahead while waiting; null otherwise. */
  queuedAhead: number | null;
  /** Estimated wait before it starts, while waiting; null when the server cannot estimate it. */
  etaMs: number | null;
  /**
   * How long it has been running, measured on the server that started it; null when it is not running.
   * A duration rather than a timestamp, so the client never subtracts its own clock from the server's.
   */
  elapsedMs: number | null;
  /** Mutation or protein the job is about, when its input names one. */
  label: string | null;
  /**
   * How many people are waiting on it, the caller included. More than one means somebody else asked
   * for the same result, so cancelling only removes this person's interest and the work continues.
   */
  watchers: number;
  /**
   * Where it runs (or ran) and why, once live routing has had a say; null when it is simply the shared
   * server's. Optional: a server from before live routing does not send it.
   */
  runsOn?: JobRunsOn | null;
}

export interface CancelResult {
  cancelled: boolean;
  stillRunningForOthers: boolean;
  remainingWatchers: number;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountError("Could not reach the server. Check your connection and try again.", 0, "NETWORK");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error;
    throw new AccountError(
      typeof error?.message === "string" ? error.message : `The server answered ${res.status}.`,
      res.status,
      typeof error?.code === "string" ? error.code : "HTTP_ERROR",
    );
  }
  return data as T;
}

export const jobsApi = {
  myJobs: () => request<{ jobs: JobSummary[] }>("GET", "/my-jobs"),
  cancel: (id: string) => request<CancelResult>("POST", `/jobs/${encodeURIComponent(id)}/cancel`, {}),
};

/** Jobs that still occupy the queue (the badge count). */
export function activeJobs(jobs: JobSummary[]): JobSummary[] {
  return jobs.filter((j) => j.status === "queued" || j.status === "running");
}

/**
 * The browser-side signal that the queue changed for this person.
 *
 * The jobs panel's own triggers are mount, its poll interval (which only runs while something is
 * already active) and `window.focus`. None of them fires when the person submits their FIRST job and
 * stays in the window, so the badge silently missed precisely the moment it is looked for. Submitting
 * announces instead, and the panel reloads at once.
 */
export const JOBS_CHANGED_EVENT = "mse:jobs-changed";

export function announceJobsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
}

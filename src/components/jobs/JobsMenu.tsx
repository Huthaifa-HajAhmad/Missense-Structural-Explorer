/**
 * JobsMenu — the header's "My jobs" control (WP-G1).
 *
 * A button with the number of the reader's jobs still waiting or running, opening a panel that lists
 * them: what each is, where it stands (queue place and the server's wait estimate, or how long it has
 * run), and Cancel. A job shared with someone who asked for the same result says so, and cancelling it
 * only removes it from this reader's list (the server keeps it for the others).
 *
 * Shown only to a signed-in person: without an account there is no "mine". It is a dialog, not a menu,
 * because rows hold their own buttons; it uses the same native popover and anchoring as the account menu
 * (`AccountMenu.tsx`), so it opens in the top layer under its trigger.
 *
 * Polling is proportionate: every 4 s while the panel is open, every 30 s in the background only while
 * something is active (so the badge stays honest), and never while the tab is hidden.
 */
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Cpu, Loader2, RefreshCw, Users, X } from "lucide-react";
import { useOptionalAccount } from "../../context/AccountContext";
import { useSettings } from "../../context/SettingsContext";
import { CHROME_ICON_BUTTON } from "../ui/chrome";
import { activeJobs, jobsApi, JOBS_CHANGED_EVENT, type JobSummary } from "../../api/jobsApi";
import { AccountError } from "../../api/accountApi";
import {
  cancelActionLabel,
  describeCancelOutcome,
  describeJobError,
  describeJobStatus,
  describeJobTiming,
  describeJobTool,
  isSharedJob,
  SHARED_JOB_NOTE,
} from "../../shared/jobsCopy";

const SUPPORTS_POPOVER =
  typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.showPopover === "function";

const OPEN_POLL_MS = 4_000;
const BACKGROUND_POLL_MS = 30_000;
/** Finished jobs shown under the active ones; the server keeps more, but the panel is for "now". */
const RECENT_LIMIT = 8;

export function JobsMenu() {
  const account = useOptionalAccount();
  if (!account || !account.accountsEnabled || !account.user) return null;
  return <JobsMenuInner />;
}

function JobsMenuInner() {
  const { isDark } = useSettings();
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: "ok" | "error" } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const { jobs: list } = await jobsApi.myJobs();
      setJobs(list);
      setLoadError(null);
      setNow(Date.now());
    } catch (err) {
      setLoadError(err instanceof AccountError ? err.message : "Could not load your jobs.");
    }
  }, []);

  const active = jobs ? activeJobs(jobs) : [];
  const activeCount = active.length;

  // First load, then poll: fast while open, slow in the background only while something is active.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!open && activeCount === 0) return;
    const t = setInterval(() => void load(), open ? OPEN_POLL_MS : BACKGROUND_POLL_MS);
    return () => clearInterval(t);
  }, [open, activeCount, load]);
  // A started job from anywhere in the app should appear without waiting for the next background tick.
  useEffect(() => {
    const onFocus = () => void load();
    const onChanged = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(JOBS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(JOBS_CHANGED_EVENT, onChanged);
    };
  }, [load]);
  // The other half of "never in a hidden tab": the guard in `load` stops requests while hidden, so
  // nothing refreshed when the person came back. A same-window tab switch fires no `focus` event.
  useEffect(() => {
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);
  // "Running for 3 min" keeps moving between polls.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [open]);

  const close = useCallback((refocus: boolean) => {
    const panel = panelRef.current;
    if (panel && typeof panel.hidePopover === "function" && panel.matches(":popover-open")) panel.hidePopover();
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "closed") return;
      setOpen(false);
      // The browser closed it (Escape, outside click). If focus was inside the panel, or was left on
      // <body> because the row that held it re-rendered, give it back to the button rather than
      // stranding a keyboard user at the top of the page.
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) buttonRef.current?.focus();
    };
    panel.addEventListener("toggle", onToggle);
    if (typeof panel.showPopover === "function" && !panel.matches(":popover-open")) {
      try { panel.showPopover(); } catch { /* unsupported or already open */ }
    }
    panel.focus();
    void load();
    if (typeof panel.showPopover !== "function") {
      const onDown = (e: MouseEvent) => {
        if (!panel.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
      };
      document.addEventListener("mousedown", onDown);
      return () => {
        panel.removeEventListener("toggle", onToggle);
        document.removeEventListener("mousedown", onDown);
      };
    }
    return () => panel.removeEventListener("toggle", onToggle);
  }, [open, close, load]);

  const cancel = async (job: JobSummary) => {
    setBusyId(job.id);
    setNotice(null);
    try {
      const outcome = await jobsApi.cancel(job.id);
      setNotice({ id: job.id, text: describeCancelOutcome(outcome), tone: "ok" });
      await load();
    } catch (err) {
      setNotice({ id: job.id, text: err instanceof AccountError ? err.message : "Could not cancel this job.", tone: "error" });
    } finally {
      setBusyId(null);
      // The Cancel button disabled itself while working, which drops focus to <body>; keep the
      // keyboard user in the panel, where the outcome is announced.
      if (document.activeElement === document.body) panelRef.current?.focus();
    }
  };

  const recent = jobs ? jobs.filter((j) => j.status !== "queued" && j.status !== "running").slice(0, RECENT_LIMIT) : [];
  const buttonLabel = activeCount > 0 ? `My jobs (${activeCount} active)` : "My jobs";

  return (
    <div className="acct-menu-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={`${CHROME_ICON_BUTTON} jobs-btn`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Cpu className="w-4 h-4" aria-hidden />
        {activeCount > 0 && <span className="jobs-badge" aria-hidden>{activeCount}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          {...(SUPPORTS_POPOVER ? { popover: "auto" as const } : {})}
          className={`acct-menu jobs-panel${isDark ? " dark" : ""}`}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close(true);
            }
          }}
        >
          <div className="jobs-head">
            <div>
              <h2 id={titleId} className="jobs-title">My jobs</h2>
              <p className="jobs-sub">
                {activeCount === 0 ? "Nothing waiting or running." : `${activeCount} waiting or running on the shared server.`}
              </p>
            </div>
            <button type="button" className="jobs-icon-btn" onClick={() => void load()} aria-label="Refresh" title="Refresh">
              <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            </button>
            <button type="button" className="jobs-icon-btn" onClick={() => close(true)} aria-label="Close" title="Close">
              <X className="w-3.5 h-3.5" aria-hidden />
            </button>
          </div>

          {loadError && (
            <p className="jobs-error" role="alert">
              {loadError}
            </p>
          )}

          {/*
            A cancel's outcome lives here rather than on the row. A cancelled job can leave the list
            entirely (finished jobs are capped at the most recent few), and the message used to survive
            only in the screen-reader region — so a sighted reader who cancelled an older job saw
            nothing at all. One live region, in the panel, is both visible and announced.
          */}
          {notice && (
            <p className={notice.tone === "ok" ? "jobs-notice" : "jobs-error"} role="status" aria-live="polite">
              {notice.text}
            </p>
          )}

          {jobs === null && !loadError && (
            <p className="jobs-empty">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading…
            </p>
          )}

          {jobs !== null && jobs.length === 0 && (
            <p className="jobs-empty">
              No jobs yet. Stability and binding-pocket calculations you start appear here while they wait and run.
            </p>
          )}

          {active.length > 0 && (
            <ul className="jobs-list" aria-label="Waiting or running">
              {active.map((job) => (
                <JobRow key={job.id} job={job} now={now} busy={busyId === job.id} onCancel={cancel} />
              ))}
            </ul>
          )}

          {recent.length > 0 && (
            <>
              <h3 className="jobs-section">Recent</h3>
              <ul className="jobs-list" aria-label="Recent">
                {recent.map((job) => (
                  <JobRow key={job.id} job={job} now={now} busy={false} onCancel={cancel} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function JobRow({
  job,
  now,
  busy,
  onCancel,
}: {
  job: JobSummary;
  now: number;
  busy: boolean;
  onCancel: (job: JobSummary) => void;
}) {
  const status = describeJobStatus(job.status, job.error);
  const activeJob = job.status === "queued" || job.status === "running";
  const failedDetail = status.tone === "failed" ? describeJobError(job.error) : null;
  return (
    <li className="jobs-row" data-tone={status.tone}>
      <div className="jobs-row-main">
        <div className="jobs-row-title">
          <span className="jobs-row-label">{job.label ?? "Unnamed job"}</span>
          <span className="jobs-chip" data-tone={status.tone}>{status.label}</span>
        </div>
        {/* One run of text, so a long queue line wraps as a sentence rather than leaving a dangling "·". */}
        <div className="jobs-row-meta">{`${describeJobTool(job.type)} · ${describeJobTiming(job, now)}`}</div>
        {isSharedJob(job.watchers) && (
          <div className="jobs-row-shared" title={SHARED_JOB_NOTE}>
            <Users className="w-3 h-3" aria-hidden /> Shared with someone who asked for the same result
          </div>
        )}
        {failedDetail && <div className="jobs-row-error" title={job.error ?? undefined}>{failedDetail}</div>}
      </div>
      {activeJob && (
        <button
          type="button"
          className="jobs-cancel"
          disabled={busy}
          onClick={() => onCancel(job)}
          aria-label={`Cancel ${job.label ?? "this job"}`}
          title={cancelActionLabel(job.watchers)}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : "Cancel"}
        </button>
      )}
    </li>
  );
}

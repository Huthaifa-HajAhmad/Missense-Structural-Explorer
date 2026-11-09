import { memo, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { describeQueueWait } from "../../shared/jobsCopy";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import type { EnergeticsEvidence } from "../../shared/energeticsEvidence";
import { describeFoldxPhase, FOLDX_PHASES, type FoldxProgress } from "../../shared/foldxPhase";
import { describeRunsOn, hostPhrase } from "../../shared/jobPlacement";
import type { EnergeticsRun } from "./useEnergeticsEvidence";

/**
 * Human-readable age of a run, from a duration the SERVER measured plus the time since the client
 * received it, so the number never mixes two clocks.
 */
function formatElapsed(elapsedMs: number | null): string | null {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) return null;
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * The FoldX run in progress. The stage comes from `progress.phase`, which the worker writes; the
 * one-second tick only advances the age between polls. An unreported phase says so rather than
 * guessing, and the hide control is offered only once a row has settled (it lives inside what it
 * hides, so offering it earlier left no progress surface and no way back).
 */
export const ProgressPanel = memo(function ProgressPanel({
  onHidePendingEngines,
  progress,
  evidence,
  foldingStatus,
  canHidePending,
}: {
  onHidePendingEngines: () => void;
  progress: FoldxProgress | null;
  evidence: EnergeticsEvidence;
  foldingStatus: EnergeticsRun["foldingStatus"];
  canHidePending: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const view = describeFoldxPhase(progress?.phase, progress?.runsOn);
  const runsOn = progress?.runsOn ?? null;
  const host = hostPhrase(runsOn);
  const elapsed = formatElapsed(
    progress && progress.elapsedMs !== null ? progress.elapsedMs + Math.max(0, nowMs - progress.receivedAt) : null
  );
  const queued = progress?.phase === "queued";
  const returned = evidence.readings.filter(reading => reading.ddg !== null).length;
  const outstandingEngineSummary = evidence.readings
    .filter(reading => reading.ddg === null)
    .map(reading => {
      const state = queued && reading.outcome.state === "running" ? "Pending" : ENGINE_STATE_LABELS[reading.outcome.state];
      return `${reading.name}: ${state.toLowerCase()}`;
    })
    .join(", ");
  const foldxFinished = foldingStatus === "success" || foldingStatus === "failed" || foldingStatus === "unavailable";
  const otherEnginesRunning = evidence.readings.filter(reading => reading.key !== "foldx" && reading.outcome.state === "running").length;
  const foldxCancelled = evidence.readings.some(reading => reading.key === "foldx" && reading.outcome.state === "cancelled");
  const title = foldingStatus === "success"
    ? "FoldX score ready"
    : foldxCancelled
      ? "FoldX run cancelled"
      : foldingStatus === "failed" || foldingStatus === "unavailable"
        ? "FoldX finished · collecting other engine results"
        : queued
          ? "Energetics job queued"
          : "Energetics calculations in progress";
  const currentActivity = foldxFinished
    ? otherEnginesRunning > 0
      ? `FoldX has finished. ${otherEnginesRunning} independent engine${otherEnginesRunning === 1 ? " is" : "s are"} still running.`
      : "FoldX has finished; the remaining results are being assembled."
    : queued
      ? runsOn && runsOn.where !== "server" ? `Waiting for ${host} to pick it up.` : "Waiting for a compute worker to start this job."
    : view?.detail ?? `${runsOn ? host.charAt(0).toUpperCase() + host.slice(1) : "The compute server"} has not reported a stage yet.`;
  const repairNote = !foldxFinished && progress?.phase === "repairing"
    ? "FoldX does not report a percentage for structure repair. It takes seconds for a large structure (only the region around the variant is repaired) and up to a few minutes for a small one (the whole chain); a repair is reused for later variants it applies to."
    : null;
  // "3 jobs ahead · starts in about 4 min": the server's own position and estimate (src/shared/jobsCopy.ts).
  const queueNote = queued ? describeQueueWait(progress?.queuePosition, progress?.queueEtaMs) : null;
  // Where it runs and why, only once routing has had a say (null keeps today's card for everyone else). While
  // it waits, the queue line above already says what it waits for, so only the reasons follow.
  const placementLine = !foldxFinished && !queued ? describeRunsOn(runsOn, "running") : null;
  const placementWhy = !foldxFinished && runsOn ? runsOn.reasons.join(" ") : "";

  return (
    <section className="nrg-card nrg-progress" aria-label="Energetics run progress" data-testid="energetics-progress">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {returned} of {evidence.readings.length} engine scores returned. {outstandingEngineSummary || "All engine scores returned."} {placementLine ? `${placementLine}. ` : ""}{currentActivity}
      </p>
      <div className="nrg-progress__head">
        <span className="nrg-progress__title">
          <Activity className="w-4 h-4" aria-hidden="true" />
          {title}
        </span>
        <span className="nrg-progress__meta">
          <span className="nrg-progress__count">{returned} of {evidence.readings.length} scores ready</span>
          {elapsed && <span className="nrg-mono">Elapsed: {elapsed}</span>}
          {queueNote && <span>{queueNote}</span>}
          {canHidePending && (
            <button
              type="button"
              className="nrg-btn"
              onClick={onHidePendingEngines}
              title="Collapses the still-running rows so the settled results are easier to read. This does not cancel or skip any calculation."
            >
              Hide pending engines
            </button>
          )}
        </span>
      </div>
      <ol className="nrg-progress__steps" aria-label="FoldX stages">
        {FOLDX_PHASES.map((phase, index) => {
          const stageNumber = index + 1;
          const stage = describeFoldxPhase(phase)!;
          const isActive = !foldxFinished && view?.stage === stageNumber;
          const isPast = foldxFinished || (Boolean(view) && view!.stage > stageNumber);
          return (
            <li
              key={phase}
              className="nrg-progress__step"
              data-foldx-stage={stageNumber}
              data-active={isActive ? "true" : "false"}
              data-past={isPast ? "true" : "false"}
              aria-current={isActive ? "step" : undefined}
            >
              {stageNumber}. {stage.label}
            </li>
          );
        })}
      </ol>
      <p className="nrg-progress__now">
        {foldxFinished ? "FoldX:" : queued ? "Queue:" : "Current stage:"}{" "}
        <strong>{currentActivity}</strong>
      </p>
      {(placementLine || placementWhy) && (
        <p className="nrg-progress__note" data-testid="energetics-runs-on">
          {placementLine && <strong>{placementLine}.</strong>}
          {placementLine && placementWhy ? " " : ""}
          {placementWhy}
        </p>
      )}
      {repairNote && <p className="nrg-progress__note">{repairNote}</p>}
      <ul className="nrg-progress__engines" aria-label="Engine result status">
        {evidence.readings.map(reading => {
          const state = reading.outcome.state;
          const displayState = queued && state === "running" ? "pending" : state;
          const stateLabel = reading.ddg !== null
            ? "Ready"
            : queued && state === "running"
              ? "Pending"
              : ENGINE_STATE_LABELS[state];
          return (
            <li key={reading.key} className="nrg-progress__engine" data-state={displayState}>
              <span className="nrg-progress__engine-mark" aria-hidden="true" />
              <span className="nrg-progress__engine-copy">
                <span className="nrg-progress__engine-name">{reading.name}</span>
                <span className="nrg-progress__engine-state">{stateLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
});

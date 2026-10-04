/**
 * foldxPhase.ts — THE single source of truth for what the FoldX leg is doing, and for how that is
 * named on screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS (read before adding a phase or a label)
 * ─────────────────────────────────────────────────────────────────────────────
 * FoldX is the only engine whose wall clock is measured in minutes, and until now the UI had no
 * idea what it was doing. The only progress surface was a *fiction*: a local stopwatch that
 * advanced through hardcoded stages at 12 s / 40 s / 75 s and then sat on "Finalizing" forever
 * (`EnergeticsView.getSimulationStage`). Meanwhile the server was genuinely in one of four states
 * the whole time, and the client was already polling for them every 2-5 s.
 *
 * A screen that invents a stage is worse than one that admits it does not know: it told a reader
 * the run was "Aggregating calibrated multi-tool consensus" for five of a six-minute wait while
 * the machine was repacking a structure. So the phase is now REPORTED by the worker that performs
 * it, carried on the job record, and rendered verbatim. When no phase is reported the UI says so
 * rather than guessing.
 *
 * Measured on this repository's own job directories (same mutation, same position):
 *
 *   structure                RepairPDB    BuildModel ×5    total
 *   AlphaFold, 875 residues  skipped      5.1 s            5.1 s
 *   experimental, 305 res.   205.4 s      2.2 s            208 s
 *
 * `repairing` is therefore ~98% of a FoldX run — the phase worth reporting, and the one that
 * looked like a hang.
 *
 * Pure by construction (imports nothing), so both processes can share it — enforced by
 * `scripts/check-boundaries.ts`.
 */

/**
 * The four states a FoldX job actually passes through, in order.
 *
 * `queued` and `repairing` are the two that usually last minutes; `finalizing` is seconds.
 * `modelling` is seconds on a native host but MINUTES under Box64 on a large structure (SLC12A4,
 * 1,085 residues: 167 s on the OCI host), so it must never be presented as a quick step.
 * They are DISTINCT because they are the two a reader might act on: queued means "the
 * server is busy with someone else's job", repairing means "your structure is being minimised".
 */
export const FOLDX_PHASES = ["queued", "repairing", "modelling", "finalizing"] as const;

export type FoldxPhase = (typeof FOLDX_PHASES)[number];

/** True for one of {@link FOLDX_PHASES}; used at the trust boundary (a JSON body from the wire). */
export function isFoldxPhase(value: unknown): value is FoldxPhase {
  return typeof value === "string" && (FOLDX_PHASES as readonly string[]).includes(value);
}

export interface FoldxPhaseView {
  /** Stepper position, 1-based. `0` when the phase is unknown. */
  stage: number;
  /** Short name for the stepper cell. */
  label: string;
  /** One sentence saying what is happening right now. */
  detail: string;
}

const PHASE_VIEWS: Record<FoldxPhase, FoldxPhaseView> = {
  queued: {
    stage: 1,
    label: "Queued",
    detail: "Waiting for a free force-field worker on the compute server.",
  },
  repairing: {
    stage: 2,
    label: "Structure repair",
    detail: "Repacking side chains and resolving steric clashes in the template (FoldX RepairPDB).",
  },
  modelling: {
    stage: 3,
    label: "Mutant modelling",
    detail: "Building and minimising the mutant structure across the five-run ensemble (FoldX BuildModel).",
  },
  finalizing: {
    stage: 4,
    label: "Scoring",
    detail: "Averaging the ensemble and assembling the ΔΔG result.",
  },
};

/**
 * Names a phase for the UI.
 *
 * Returns `null` for an unreported phase — deliberately, and that is the whole point of the
 * module's existence: an unknown phase must render as unknown, never as the next stage in a
 * guessed sequence. Callers that need a stepper position use `view?.stage ?? 0`.
 */
export function describeFoldxPhase(phase: FoldxPhase | null | undefined): FoldxPhaseView | null {
  if (!phase || !isFoldxPhase(phase)) return null;
  return PHASE_VIEWS[phase];
}

/**
 * What the client knows about an in-flight FoldX run.
 *
 * Carried from the job record (`/foldx-job/:jobId`) to the store as ONE object rather than four
 * sibling fields, so a surface cannot render a phase next to an elapsed time that belongs to a
 * different run — the class of mismatch that produced the fabricated stepper in the first place.
 */
export interface FoldxProgress {
  phase: FoldxPhase | null;
  /**
   * How long the server had been EXECUTING the job when it produced this snapshot, or `null` while
   * the job is queued.
   *
   * Elapsed time is carried as a DURATION rather than as the server's start timestamp on purpose.
   * The reader's clock and the compute host's clock are different clocks — the production topology
   * is a remote OCI instance behind Cloudflare — so `now - serverStartedAt` would add the skew
   * between them to the age of the run (or clamp a negative delta to zero). A duration measured
   * entirely on the server, advanced locally by the time since receipt, is correct on any host.
   */
  elapsedMs: number | null;
  /** Positions ahead of this job in the queue, when the server can count them. */
  queuePosition: number | null;
  /** Local clock at the moment this snapshot was RECEIVED — the client's own baseline. */
  receivedAt: number;
}

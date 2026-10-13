/**
 * jobPlacement.ts — where a queued job runs, and the words for it (plan WP-G2, live routing).
 *
 * The server stores one {@link RoutingRecord} per job: the host the placement engine chose (or the
 * host that actually took it), the engine's prediction for that host, its reasons, and a note when the
 * job later changed hands. A reader never sees the record; they see a {@link JobRunsOn}, built from it
 * for one viewer by {@link runsOnFor}, which hides another person's computer name.
 *
 * Pure (no imports outside `src/shared`), like `jobsCopy.ts` and `foldxPhase.ts`, so the server builds
 * the wire shape and the browser words it with the same code (`scripts/check-boundaries.ts`).
 */

/** Why a job is no longer where it was first placed. */
export type RoutingNote =
  /** The computer stopped answering, was paused, or lost the tool before it started the job. */
  | "released"
  /** The computer started the job and gave it back (failure, lost lease, invalid result, disconnect). */
  | "handed_back"
  /** Nothing placed it; the owner's computer took it from the owner's backlog while the server was busy. */
  | "taken_from_backlog";

/** Stored on the job row (`biophysical_jobs.routing`). Server-side; never sent as is. */
export interface RoutingRecord {
  /** "server" or "agent:<id>". */
  host: string;
  /** The computer's name when `host` is an agent; null for the server. */
  computerName: string | null;
  expectedMs: { p50: number; p90: number } | null;
  basis: "measured" | "prior" | null;
  samples: number | null;
  /** The engine's reader-facing reasons for the placement (empty when nothing decided it). */
  reasons: string[];
  decidedAt: number;
  note: RoutingNote | null;
}

/** What a viewer is told about where a job runs. */
export interface JobRunsOn {
  where: "server" | "your_computer" | "teammate_computer";
  /** The computer's name, only when it is the viewer's own. */
  computerName: string | null;
  /** The host has started the job (it is running there). */
  started: boolean;
  /** The engine's prediction for this host, when it made one. */
  expectedMs: { p50: number; p90: number } | null;
  basis: "measured" | "prior" | null;
  samples: number | null;
  /** Plain sentences: why it runs there, and what changed since, if anything. */
  reasons: string[];
}

const NOTE_SENTENCE: Record<RoutingNote, string> = {
  released: "Your computer did not pick it up (it went offline, was paused, or lost the tool), so the shared server runs it instead.",
  handed_back: "Your computer could not finish it, so the shared server runs it instead.",
  taken_from_backlog: "The shared server was busy, so your computer took it from your waiting jobs.",
};

/** The record after a job went to the shared server for `note`. The old prediction belonged to the computer. */
export function serverRecordAfter(note: Exclude<RoutingNote, "taken_from_backlog">, now: number): RoutingRecord {
  return { host: "server", computerName: null, expectedMs: null, basis: null, samples: null, reasons: [], decidedAt: now, note };
}

export function parseRoutingRecord(raw: unknown): RoutingRecord | null {
  if (typeof raw !== "string" || raw === "") return null;
  try {
    const r = JSON.parse(raw);
    if (!r || typeof r.host !== "string") return null;
    return {
      host: r.host,
      computerName: typeof r.computerName === "string" ? r.computerName : null,
      expectedMs: r.expectedMs && Number.isFinite(r.expectedMs.p50) && Number.isFinite(r.expectedMs.p90) ? { p50: r.expectedMs.p50, p90: r.expectedMs.p90 } : null,
      basis: r.basis === "measured" || r.basis === "prior" ? r.basis : null,
      samples: Number.isFinite(r.samples) ? r.samples : null,
      reasons: Array.isArray(r.reasons) ? r.reasons.filter((s: unknown) => typeof s === "string") : [],
      decidedAt: Number.isFinite(r.decidedAt) ? r.decidedAt : 0,
      note: r.note === "released" || r.note === "handed_back" || r.note === "taken_from_backlog" ? r.note : null,
    };
  } catch {
    return null;
  }
}

/**
 * Where a job runs, for one viewer.
 *
 * `claimedBy` is the live truth for a running job ("agent:<id>" or null for the server); `placement` the
 * live truth for a waiting one. The record supplies the prediction and reasons only while it still
 * describes that host, so a stale prediction is never shown for a different machine. Returns null when
 * nothing is known and the job is plainly the server's (a job submitted with routing off): the interface
 * then says what it always said.
 */
export function runsOnFor(params: {
  status: "queued" | "running" | "completed" | "failed";
  claimedBy: string | null;
  placement: string | null;
  record: RoutingRecord | null;
  viewerIsOwner: boolean;
}): JobRunsOn | null {
  const { status, record, viewerIsOwner } = params;
  const isAgentHost = (v: string | null) => typeof v === "string" && v.startsWith("agent:");
  // Waiting: where it is placed. Running or finished: who claimed it. `claimed_by` stays on a job a computer
  // finished, and is cleared on every hand-back, so a finished job with no computer claim ran on the server
  // or never ran (cancelled while it waited) — never on the computer it was once placed on.
  const liveHost =
    status === "queued"
      ? isAgentHost(params.placement) ? params.placement! : "server"
      : isAgentHost(params.claimedBy) ? params.claimedBy! : "server";
  const matches = record != null && record.host === liveHost;
  if (!matches && liveHost === "server" && record == null) return null;

  const onAgent = isAgentHost(liveHost);
  const reasons = matches ? [...record!.reasons] : [];
  if (matches && record!.note) reasons.unshift(NOTE_SENTENCE[record!.note]);
  // Anyone else holding the job id (someone who joined it, or a poll without an account) reads only WHERE:
  // the computer's name, the reasons and the prediction for someone's own computer are its owner's business.
  const own = viewerIsOwner && matches;
  return {
    where: onAgent ? (viewerIsOwner ? "your_computer" : "teammate_computer") : "server",
    computerName: onAgent && own ? record!.computerName : null,
    started: status === "running" || status === "completed" || isAgentHost(params.claimedBy),
    expectedMs: own ? record!.expectedMs : null,
    basis: own ? record!.basis : null,
    samples: own ? record!.samples : null,
    reasons: viewerIsOwner ? reasons : [],
  };
}

/** "your computer (Lab PC)", "a teammate's computer", "the shared server". */
export function hostPhrase(runsOn: JobRunsOn | null | undefined): string {
  if (!runsOn || runsOn.where === "server") return "the shared server";
  if (runsOn.where === "teammate_computer") return "a teammate's computer";
  return runsOn.computerName ? `your computer (${runsOn.computerName})` : "your computer";
}

/** One line for the jobs panel and progress card: "Running on your computer (Lab PC)". */
export function describeRunsOn(runsOn: JobRunsOn | null | undefined, status: "queued" | "running" | "completed" | "failed"): string | null {
  if (!runsOn) return null;
  const host = hostPhrase(runsOn);
  if (status === "queued") {
    return runsOn.where === "server" ? "Waiting for the shared server" : `Waiting for ${host} to pick it up`;
  }
  if (status === "running") return `Running on ${host}`;
  if (status === "completed") return `Ran on ${host}`;
  return null;
}

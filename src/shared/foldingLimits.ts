/**
 * foldingLimits.ts — every de novo folding ceiling, and the sentence that explains it, in one place.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Four unrelated numbers described the same three ceilings, and none of them could be traced from
 * the copy a reader saw back to the code that enforced it:
 *
 *   • the server's Tier-1 gate rejected sequences longer than 1,024 aa (`structure/esmfold.ts`);
 *   • the keyless public ESM Atlas fallback rejected anything over 400 aa (same file);
 *   • the stability path's own engine rejected anything over 768 aa (`structure/folding-engines.ts`);
 *   • the structure inspector printed "exceeds JapanFold / ESM Atlas 768 aa limit" for the FIRST
 *     ceiling, and told the reader that a >400 aa protein was being routed to a "Sovereign JapanFold
 *     inference engine configured in Settings".
 *
 * That last sentence was wrong three times over. No such engine and no such setting exist anywhere in
 * this repository; the engine is not chosen by length at all (Tier-1 is attempted first at EVERY
 * length up to 1,024 aa); and the direction of the constraint was inverted, because crossing 400 aa
 * does not SELECT a sovereign engine — it DELETES the last fallback, so a Tier-1 failure becomes a
 * hard error. Meanwhile the notice never printed its own number, so a reader could not see that the
 * canvas beside it was claiming the same protein was 51 aa long.
 *
 * The arithmetic and the copy lived in different files, so they drifted and the user was given a cause
 * that was neither observed nor possible. This module is the single source for both: the constants ARE
 * the enforcements, and the sentence a reader sees is a pure function of them, so a number cannot
 * change in one place and stay stale in the other.
 *
 * Purity is a boundary requirement here, not a style preference: `src/shared` may not import from
 * outside itself (`scripts/check-boundaries.ts`, rule 3). That is what lets the server, the client and
 * the tests all read the same values.
 */

/**
 * Longest sequence the keyless public ESM Atlas endpoint will fold.
 *
 * This is a FALLBACK ceiling, not a routing rule. Exceeding it does not hand the work to a different
 * engine; it removes the last tier that can answer without credentials, so a Tier-1 failure at this
 * length has nowhere left to go.
 */
export const ESM_ATLAS_PUBLIC_MAX_AA = 400;

/**
 * Longest sequence Tier-1 JapanFold ESMFold-2 will fold (`structure/esmfold.ts`).
 *
 * Tier-1 is attempted FIRST, at every length up to this ceiling — it is not a large-protein engine
 * that a smaller sequence is routed away from.
 */
export const JAPANFOLD_ESMFOLD2_MAX_AA = 1024;

/**
 * Ceiling enforced by the biophysics path's own `ESMFoldEngine` (`structure/folding-engines.ts`).
 *
 * Deliberately tighter than {@link JAPANFOLD_ESMFOLD2_MAX_AA}, and deliberately NOT the number the
 * structure inspector should quote: it bounds the stability pipeline's folding step, not the de novo
 * model a reader is looking at in the viewer. The two were conflated, which is how "768 aa" appeared
 * in a sentence about Tier-1 JapanFold.
 */
export const STABILITY_ESMFOLD_ENGINE_MAX_AA = 768;

/** "1024" → "1,024", deterministically — no `toLocaleString`, which varies with the ICU build. */
export function formatResidueCount(residues: number): string {
  return String(residues).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** What the de novo folding waterfall can do with one sequence, derived — never restated. */
export interface DeNovoFoldingCapacity {
  residues: number;
  /** Tier-1 accepts this length, so a de novo model is possible at all. */
  tier1Available: boolean;
  /** The keyless public fallback accepts this length, so a Tier-1 outage is survivable. */
  publicFallbackAvailable: boolean;
}

export function resolveDeNovoFoldingCapacity(residues: number): DeNovoFoldingCapacity {
  return {
    residues,
    tier1Available: residues <= JAPANFOLD_ESMFOLD2_MAX_AA,
    publicFallbackAvailable: residues <= ESM_ATLAS_PUBLIC_MAX_AA,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Server messages.
 *
 * These are assembled here rather than in the server so that the numbers a client
 * parses back out (`parseReportedSequenceLength`) cannot drift from the numbers the
 * server compared against. The wording is frozen by
 * `src/shared/__tests__/foldingLimits.test.ts`, which asserts the exact strings the
 * suite and the 422 contract already depended on.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Tier-1 ceiling exceeded with no Biohub token: nothing can fold this sequence. */
export function deNovoFoldingLimitExceededMessage(residues: number): string {
  const tier1 = formatResidueCount(JAPANFOLD_ESMFOLD2_MAX_AA);
  return `Sequence length (${residues} aa) exceeds the de novo folding limits (${tier1} aa for Tier-1 JapanFold ESMFold-2, and ${ESM_ATLAS_PUBLIC_MAX_AA} aa for public ESM Atlas). De novo folding for proteins > ${tier1} aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`;
}

/** Tier-1 did not answer and the sequence is past the keyless fallback's ceiling. */
export function esmAtlasFallbackExceededMessage(residues: number): string {
  return `Sequence length (${residues} aa) exceeds the public ESM Atlas folding limit (${ESM_ATLAS_PUBLIC_MAX_AA} aa). Tier-1 JapanFold ESMFold-2 was unavailable. De novo folding for proteins > ${ESM_ATLAS_PUBLIC_MAX_AA} aa requires an EvolutionaryScale/Biohub API token or local GPU execution.`;
}

/** The stability pipeline's own engine ceiling. */
export function stabilityEsmFoldEngineLimitMessage(residues: number): string {
  return `Protein sequence length (${residues}) exceeds the maximum allowed limit of ${STABILITY_ESMFOLD_ENGINE_MAX_AA} residues for ESMFold.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reader-facing copy.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FoldingLimitNotice {
  /**
   * `info` when folding is still possible and only the fallback is gone; `warning` when no de novo
   * model can be produced for this length. The two rendered identically before, so a benign advisory
   * and a "we cannot do this" were indistinguishable.
   */
  tone: "info" | "warning";
  title: string;
  body: string;
}

/**
 * The one sentence the structure inspector may print about a sequence's length.
 *
 * Returns `null` when there is nothing true and useful to say. Interpolates the residue count in
 * EVERY branch: the previous >400 aa branch was the only one that omitted its number, which is
 * precisely why nobody noticed it disagreeing with the rest of the screen.
 */
export function describeDeNovoCapacityNotice(capacity: DeNovoFoldingCapacity): FoldingLimitNotice | null {
  const residues = formatResidueCount(capacity.residues);
  const tier1 = formatResidueCount(JAPANFOLD_ESMFOLD2_MAX_AA);

  if (!capacity.tier1Available) {
    return {
      tone: "warning",
      title: "ESMFold-2 Size Limit",
      body: `This ${residues} aa sequence exceeds the de novo folding ceilings of ${tier1} aa for Tier-1 JapanFold ESMFold-2 and ${ESM_ATLAS_PUBLIC_MAX_AA} aa for the public ESM Atlas endpoint, so no de novo model can be produced for it. AlphaFold2 coordinates are the full-length option.`,
    };
  }

  if (!capacity.publicFallbackAvailable) {
    return {
      tone: "info",
      title: "ESMFold-2 Fallback Notice",
      body: `This ${residues} aa sequence exceeds the ${ESM_ATLAS_PUBLIC_MAX_AA} aa ceiling of the keyless public ESM Atlas endpoint, so that fallback is unavailable. Folding uses Tier-1 JapanFold ESMFold-2, which accepts up to ${tier1} aa; if Tier-1 does not answer, there is no fallback for this length.`,
    };
  }

  return null;
}

/**
 * What a de novo folding timeout actually licenses us to say.
 *
 * The cause is hedged, because it has to be: the error that reaches the UI is a client watchdog
 * `AbortError` or the retry utility's bare `TimeoutError`, and neither carries one bit of information
 * about the provider's load. The previous copy asserted "timed out due to high GPU cluster load" and
 * "High-throughput cloud GPUs are experiencing high queue depth" as fact, which dressed a guess as
 * telemetry the app does not have. The queue explanation is still the most useful thing to offer —
 * it is now offered as a likelihood.
 */
export function describeDeNovoFoldTimeout(options: { residues?: number | null; verbosity?: "brief" | "detailed" } = {}): string {
  const { residues = null, verbosity = "brief" } = options;
  const cause = "the folding provider's queue depth is the usual cause, though its load is not visible from here";

  if (verbosity === "detailed" && residues !== null) {
    return `ESMFold-2 de novo prediction timed out for this ${formatResidueCount(residues)} aa sequence: ${cause}.`;
  }

  return `De novo prediction timed out before the folding service returned coordinates: ${cause}.`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reading a failure, and reading a length.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The residue count the SERVER reported it rejected, or `null`.
 *
 * Strict by design. The previous pattern was `/(\d+)\s*aa/i` against any error string, which can mine
 * a number out of text that is not about length at all — the class of bug that let a scan-window
 * length be printed as a protein length. Only the two shapes this module's own message builders
 * produce are accepted, so a new server message cannot be silently misread.
 */
export function parseReportedSequenceLength(message: string | null | undefined): number | null {
  if (!message) return null;

  const match =
    /sequence length \((\d+)\s*aa\)/i.exec(message) ??
    /protein sequence length \((\d+)\)/i.exec(message);

  if (!match) return null;

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Markers unique to the messages this module builds, so the classification cannot drift from them. */
const LENGTH_LIMIT_MARKERS = [
  "exceeds the de novo folding limits",
  "exceeds the public ESM Atlas folding limit",
  "exceeds the maximum allowed limit of",
];

export function isFoldingLengthLimitError(message: string | null | undefined): boolean {
  if (!message) return false;
  return LENGTH_LIMIT_MARKERS.some((marker) => message.includes(marker));
}

const TIMEOUT_MARKERS = ["timed out", "timeout"];

export function isFoldingTimeoutError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return TIMEOUT_MARKERS.some((marker) => lower.includes(marker));
}

export interface ProteinLengthReading {
  residues: number | null;
  /**
   * Which field the number came from. Not printed anywhere — it exists so a test can pin the
   * precedence instead of inferring it from a rendered label.
   */
  source: "mutatedSequence" | "sequence" | "unavailable";
}

/**
 * The analysed protein's full-length residue count.
 *
 * Prefers the mutant translation, because that is the sequence a de novo model would be built from.
 * Structural typing rather than a contract import keeps this callable from a component that holds
 * only `metadata`, and keeps `src/shared` self-contained.
 *
 * Callers must NOT substitute a scan-window length (`landscapeData.length` covers a window around the
 * variant). That substitution is how this screen came to report a 711 aa protein as 51 aa.
 */
export function readProteinLength(
  metadata: { mutatedSequence?: string | null; sequence?: string | null } | null | undefined
): ProteinLengthReading {
  const mutated = metadata?.mutatedSequence;
  if (typeof mutated === "string" && mutated.length > 0) {
    return { residues: mutated.length, source: "mutatedSequence" };
  }

  const canonical = metadata?.sequence;
  if (typeof canonical === "string" && canonical.length > 0) {
    return { residues: canonical.length, source: "sequence" };
  }

  return { residues: null, source: "unavailable" };
}

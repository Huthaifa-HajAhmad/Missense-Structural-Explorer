/**
 * candidateScores.ts — single-allele scores on a run with several candidate alleles.
 *
 * CADD scores one exact nucleotide allele, and G>A and G>C at the same base get different scores.
 * When a protein-only input maps to multiple candidate alleles at one locus:
 *   - All candidates must carry a finite CADD PHRED score from the same `caddSource` release.
 *   - If every candidate agrees on PP3 (≥ 25.3) or BP4 (≤ 22.7), CADD votes at the weakest agreed
 *     ClinGen calibrated strength (never stronger than any candidate allele supports).
 *   - If every candidate is indeterminate (22.7 < CADD < 25.3), CADD is evaluated as indeterminate.
 *   - If candidates disagree across bands (e.g. PP3 vs Indeterminate, or PP3 vs BP4), or come from
 *     different CADD releases, or any candidate lacks a score, CADD does not vote.
 * Pure.
 */
import { candidateNucleotideChange } from "./candidateFrequency.ts";
import type { AlleleCandidate } from "./locusResolution.ts";
import {
  calibratedCall,
  formatEvidenceCode,
  STRENGTH_ORDER,
  strengthCode,
  type CalibratedCall,
  type EvidenceStrength,
} from "./thresholds/calibration.ts";
import type { PredictorSignal } from "./thresholds/evaluators.ts";

export type CandidateCaddDecision =
  | {
      kind: "vote";
      signal: "pathogenic" | "benign";
      calibrated: CalibratedCall & { direction: "PP3" | "BP4"; strength: EvidenceStrength };
      scoreText: string;
      range: [number, number];
      source: string;
      weakestAdopted: boolean;
    }
  | {
      kind: "indeterminate";
      signal: "vus";
      calibrated: CalibratedCall & { direction: null; strength: null; code: "Indeterminate" };
      scoreText: string;
      range: [number, number];
      source: string;
    }
  | {
      kind: "disagree";
      signal: "unavailable";
      source: string;
      unavailableEntry: string;
      availabilityLabel: string;
      availabilityReason: string;
    }
  | {
      kind: "mixed-source";
      signal: "unavailable";
      sources: string[];
      unavailableEntry: string;
      availabilityLabel: string;
      availabilityReason: string;
    }
  | {
      kind: "missing";
      signal: "unavailable";
      sources: string[];
      missingNames: string[];
      unavailableEntry: string;
      availabilityLabel: string;
      availabilityReason: string;
    };

function candidateName(c: AlleleCandidate): string {
  return candidateNucleotideChange(c) ?? c.id ?? c.grch37Id ?? "allele";
}

function bandWords(call: CalibratedCall): string {
  if (call.direction === null) return "Indeterminate";
  return call.strength === "Supporting" ? `${call.direction} Supporting` : formatEvidenceCode(call.code);
}

function formatScoreRange(scores: number[]): { scoreText: string; range: [number, number] } {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  return {
    scoreText: min === max ? min.toFixed(1) : `${min.toFixed(1)}–${max.toFixed(1)}`,
    range: [min, max],
  };
}

const UNVERIFIED_RELEASE_RE = /\b(?:not\s+(?:stated|recorded)|unknown)\b/i;

/** A CADD PHRED score must be finite and non-negative; upper values above 50 remain valid. */
export function validCaddScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function cleanSource(source: string | null | undefined): string | null {
  return typeof source === "string" && source.trim() ? source.trim() : null;
}

function isVerifiedRelease(source: string | null): source is string {
  return source !== null && !UNVERIFIED_RELEASE_RE.test(source);
}

/**
 * Evaluate candidate-allele CADD scores across all candidates for an ambiguous locus.
 * Returns `null` when there are no candidates.
 */
export function decideCandidateCadd(
  candidates: ReadonlyArray<AlleleCandidate> | null | undefined,
): CandidateCaddDecision | null {
  if (!candidates?.length) return null;

  const entries = candidates.map(c => {
    const score = validCaddScore(c.caddPhred);
    return {
      name: candidateName(c),
      score,
      hadInvalidNumber: typeof c.caddPhred === "number" && score === null,
      source: cleanSource(c.caddSource),
      call: score !== null ? calibratedCall("cadd", score) : null,
    };
  });

  const distinctSources = Array.from(
    new Set(entries.map(e => e.source).filter((s): s is string => s !== null)),
  );

  const missing = entries.filter(e => e.score === null);
  if (missing.length > 0) {
    const missingNames = missing.map(m => m.name);
    const list = missingNames.join(", ");
    const hasInvalid = missing.some(m => m.hadInvalidNumber);
    return {
      kind: "missing",
      signal: "unavailable",
      sources: distinctSources,
      missingNames,
      unavailableEntry: hasInvalid ? `CADD — NO VALID SCORE FOR ${list}` : `CADD — NO SCORE FOR ${list}`,
      availabilityLabel: hasInvalid ? "Invalid score" : missing.length === entries.length ? "No result" : "Incomplete",
      availabilityReason: hasInvalid
        ? `Invalid CADD PHRED score for ${list}, so CADD does not vote.`
        : `No CADD score for ${list}, so CADD does not vote.`,
    };
  }
  if (distinctSources.length > 1) {
    const joined = distinctSources.join(" vs ");
    return {
      kind: "mixed-source",
      signal: "unavailable",
      sources: distinctSources,
      unavailableEntry: `CADD — MIXED SOURCES (${joined})`,
      availabilityLabel: "Mixed sources",
      availabilityReason: `Candidate CADD scores came from different releases (${joined}); CADD does not vote across releases.`,
    };
  }

  const unverified = entries.filter(e => !isVerifiedRelease(e.source));
  if (unverified.length > 0) {
    const unverifiedNames = unverified.filter(e => e.source === null).map(e => e.name);
    const unverifiedLabels = Array.from(
      new Set(unverified.map(e => e.source).filter((s): s is string => s !== null)),
    );
    const detail = [...unverifiedLabels, ...unverifiedNames].join(", ");
    return {
      kind: "mixed-source",
      signal: "unavailable",
      sources: distinctSources,
      unavailableEntry: `CADD — UNVERIFIED SOURCE (${detail})`,
      availabilityLabel: "Unverified source",
      availabilityReason: unverifiedLabels.length > 0
        ? `CADD release is not verified (${detail}); one confirmed release is required before voting.`
        : `CADD source release is not stated for ${detail}; one shared release is required before voting.`,
    };
  }

  const source = distinctSources[0];
  const calls = entries.map(e => e.call as CalibratedCall);
  const { scoreText, range } = formatScoreRange(entries.map(e => e.score as number));

  if (calls.every(c => c.direction === null)) {
    return {
      kind: "indeterminate",
      signal: "vus",
      calibrated: { direction: null, strength: null, code: "Indeterminate" },
      scoreText,
      range,
      source,
    };
  }

  const directions = new Set(calls.map(c => c.direction));
  if (directions.size === 1 && (calls[0].direction === "PP3" || calls[0].direction === "BP4")) {
    const direction = calls[0].direction;
    // STRENGTH_ORDER runs VeryStrong -> Strong -> Moderate -> Supporting; reverse picks the weakest agreed band.
    const weakest = [...STRENGTH_ORDER].reverse().find(s => calls.some(c => c.strength === s))!;
    const code = strengthCode(direction, weakest);
    const distinctCodes = new Set(calls.map(c => c.code));
    return {
      kind: "vote",
      signal: direction === "PP3" ? "pathogenic" : "benign",
      calibrated: { direction, strength: weakest, code },
      scoreText,
      range,
      source,
      weakestAdopted: distinctCodes.size > 1,
    };
  }

  const detail = entries
    .map(e => `${e.name} ${(e.score as number).toFixed(1)} ${bandWords(e.call as CalibratedCall)}`)
    .join(" vs ");
  return {
    kind: "disagree",
    signal: "unavailable",
    source,
    unavailableEntry: `CADD — CANDIDATE ALLELES DISAGREE (${detail})`,
    availabilityLabel: "Candidates disagree",
    availabilityReason: `Candidate alleles disagree (${detail}, ${source}), so CADD does not vote.`,
  };
}

/** The note the CADD reading carries on a candidate run; null when there are no candidates. */
export function candidateCaddNote(
  candidates: ReadonlyArray<AlleleCandidate> | null | undefined,
  decision: CandidateCaddDecision | null = decideCandidateCadd(candidates),
): string | null {
  if (!candidates?.length) return null;
  const each = candidates.map(c => {
    const name = candidateName(c);
    const score = validCaddScore(c.caddPhred);
    if (score !== null) {
      const band = decision?.kind === "vote" || decision?.kind === "indeterminate"
        ? ` (${formatEvidenceCode(calibratedCall("cadd", score)!.code)})`
        : "";
      return `${name} ${score}${band} from ${cleanSource(c.caddSource) ?? "a source not stated"}`;
    }
    if (typeof c.caddPhred === "number") {
      return `${name} invalid (${c.caddPhred})`;
    }
    return `${name} not reported`;
  });

  if (decision?.kind === "vote") {
    const codeText = formatEvidenceCode(decision.calibrated.code);
    const suffix = decision.weakestAdopted
      ? `Every candidate supports ${decision.calibrated.direction}; CADD votes ${codeText} (weakest agreed band).`
      : `Every candidate supports ${codeText}; CADD votes ${codeText}.`;
    return `Each candidate allele has its own CADD: ${each.join("; ")}. ${suffix}`;
  }

  if (decision?.kind === "indeterminate") {
    return `Each candidate allele has its own CADD: ${each.join("; ")}. Every candidate is indeterminate.`;
  }

  return `Each candidate allele has its own CADD: ${each.join("; ")}. No single allele was selected, so CADD does not vote.`;
}


/**
 * burialEvidence.ts — single source of truth for "where is this residue, and how
 * tightly is it packed?"
 *
 * Why this module exists
 * ----------------------
 * The Residue Shifts panel printed a burial word next to two numeric definitions, and
 * the three were not the same definition:
 *
 *   • the word (`burialStatus`) was computed by `tools/sasa_eval.py`, which used
 *     `rsa < 0.05` for core and `rsa > 0.25` for surface;
 *   • the panel's prose, and `METRIC_EXPLANATIONS.burial_status` beside it, stated
 *     "core < 15% RSA / surface > 35% RSA" — the bands `esm3_forge.ts` applies when it
 *     labels the same RSA value "Hydrophobic core" / "Surface".
 *
 * So one residue could be called "boundary" by the badge and "deeply buried in the
 * hydrophobic core" by the sentence explaining it. The bands below are now the only
 * definition, every surface reads them, and `tools/sasa_eval.py` — which cannot import
 * TypeScript — is pinned to them by a guard test in `burialEvidence.test.ts`.
 *
 * Pure functions and plain data only: no React, no fetching, no client imports.
 */

/**
 * Relative solvent accessibility cut-points, as fractions of the Tien et al. 2013 maximum.
 *
 * App-defined, not a published classification: common schemes use a single 20–25% split
 * (Tien 2013, Levy 2010) or other three-state bounds. Every surface draws them as local marks.
 */
export const BURIAL_RSA_BANDS = {
  /** At or below this, the residue is buried in the hydrophobic core. */
  coreMax: 0.15,
  /** At or above this, the residue is solvent-exposed. Between the two is boundary. */
  surfaceMin: 0.35,
} as const;

/**
 * Cα packing: the shell radius the server counts neighbours within.
 *
 * There are deliberately no packing cut-points. The count used to decide the burial word whenever
 * accessibility was not measured, with core at ≥ 15 and surface at ≤ 7 Cα neighbours — values with
 * no source. Chain neighbours alone contribute about six, so "surface" was almost unreachable: on a
 * reference structure (p53 DBD, 2OCJ chain A) 34 of 48 residues with ≥ 35% relative accessibility
 * banded as boundary, and packing agreed with measured accessibility for only 60% of residues. The
 * owner decided (2026-09-29) that burial is reported only from a measured accessibility; the count
 * is shown beside it as a reading.
 */
export const PACKING_NEIGHBOUR_BANDS = {
  /** The neighbour shell radius, in Ångströms. */
  radiusAngstrom: 10,
} as const;

/** Drawing domain for the packing meter, in Cα neighbours: a picture bound, not a maximum. */
const PACKING_METER_BASE_DOMAIN = 24;

/**
 * The microenvironment entry that stands in for "accessibility was never measured".
 *
 * Shared because the producer and the renderer have to agree on it: `esm3_forge.ts` pushes
 * this string into `microenvironments`, and the Perturbation tab's chips must paint it
 * differently from a classification — the absence of a measurement must not wear the same
 * chip as a finding. A literal copied into the view is exactly how those two drift, which is
 * the failure this module exists to stop.
 */
export const UNMEASURED_BURIAL_ENVIRONMENT = "Burial not measured";

/** True when a microenvironment entry reports the absence of a measurement, not a finding. */
export function isUnmeasuredEnvironment(value: string): boolean {
  return value === UNMEASURED_BURIAL_ENVIRONMENT;
}

export type BurialWord = "core" | "boundary" | "surface";

/** How the reported word was decided. Only a measured accessible surface decides it now. */
export type BurialBasis = "solvent-accessibility" | "none";

export interface BurialIndicator {
  key: "rsa" | "packing";
  label: string;
  /** Banded word for this indicator alone, or null when it cannot (or must not) be banded. */
  band: BurialWord | null;
  /** The measured value, formatted for display, or null when not reported. */
  valueLabel: string | null;
  /** True when this is the indicator the reported word was taken from. */
  isBasis: boolean;
  detail: string;
  /** Meter ticks in the indicator's own units, for renderers that draw a scale. */
  ticks: readonly { value: number; label: string }[];
  /** Meter domain upper bound in the indicator's own units. */
  domainMax: number;
  /** Meter value in the indicator's own units, or null when not reported. */
  marker: number | null;
}

export interface BurialEvidence {
  /** The word to display, or `undetermined` when accessibility was not measured. */
  status: BurialWord | "undetermined";
  label: string;
  /** One sentence a non-structural reader can act on. */
  detail: string;
  basis: BurialBasis;
  basisLabel: string;
  basisDetail: string;
  indicators: { rsa: BurialIndicator; packing: BurialIndicator };
  /**
   * Non-null when the reported word does not match the accessibility it ships beside. The word
   * still wins — it came from the engine — but the reader is told.
   */
  disagreement: string | null;
  /**
   * Non-null when the payload carries a burial word but no accessibility: an earlier engine
   * estimated it from packing. The word is not shown as a finding.
   */
  staleWord: string | null;
  /** What the reading does not license. Null when there is nothing to warn about. */
  caveat: string | null;
}

export interface BurialEvidenceInput {
  burialStatus?: string | null;
  neighbourCount?: number | null;
  /** Relative solvent accessibility as a fraction (0.12 = 12%). */
  rsa?: number | null;
}

const BURIAL_WORDS: ReadonlySet<string> = new Set(["core", "boundary", "surface"]);

/** Band a relative solvent accessibility, or null when it was not measured. */
export function classifyBurialRsa(rsa: number | null | undefined): BurialWord | null {
  if (rsa === null || rsa === undefined || !Number.isFinite(rsa)) return null;
  if (rsa <= BURIAL_RSA_BANDS.coreMax) return "core";
  if (rsa >= BURIAL_RSA_BANDS.surfaceMin) return "surface";
  return "boundary";
}

const BURIAL_LABELS: Record<BurialWord | "undetermined", string> = {
  core: "Core",
  boundary: "Boundary",
  surface: "Surface",
  undetermined: "Not measured",
};

/**
 * What each word means when a measured accessible surface decided it.
 *
 * "It sits in a pocket" used to be in the boundary sentence. An RSA band does not establish a
 * pocket — that is the pocket predictor's measurement, reported elsewhere on the same tab — so
 * the sentence claimed more than the number behind it.
 */
const BURIAL_DETAILS: Record<BurialWord | "undetermined", string> = {
  core: "The side chain is buried, with little or no solvent contact, so a polar or charged substitution here has to pay a desolvation cost.",
  boundary: "The side chain is partly buried: it sits at the boundary between the core and the surface rather than fully inside the core or fully exposed.",
  surface: "The side chain is solvent-exposed, where substitutions mostly change the surface a partner or ligand sees rather than the fold.",
  undetermined: "Solvent accessibility was not measured for this position, so no statement about burial is made.",
};

const BASIS_LABELS: Record<BurialBasis, string> = {
  "solvent-accessibility": "Measured accessibility",
  none: "Not measured",
};

/**
 * Build the burial/exposure reading.
 *
 * The reported `burialStatus` is shown only when a measured accessibility travels with it: that is
 * the only measurement the engine now derives a word from. The packing count is a reading beside it.
 */
export function deriveBurialEvidence(input: BurialEvidenceInput): BurialEvidence {
  const rsa = typeof input.rsa === "number" && Number.isFinite(input.rsa) ? input.rsa : null;
  const neighbourCount =
    typeof input.neighbourCount === "number" && Number.isFinite(input.neighbourCount)
      ? input.neighbourCount
      : null;

  const rsaBand = classifyBurialRsa(rsa);
  const reported = typeof input.burialStatus === "string" ? input.burialStatus.trim().toLowerCase() : "";
  const hasReported = BURIAL_WORDS.has(reported);

  /*
   * A word with no accessibility beside it can only have come from the retired packing fallback
   * (or the engine's "residue not found" placeholder, which returned "boundary" with a count of 0).
   * Neither is a measurement, so the status is "not measured" and the word is named as stale.
   */
  const status: BurialWord | "undetermined" = rsaBand !== null ? (hasReported ? (reported as BurialWord) : rsaBand) : "undetermined";
  // The accessibility is the basis only when it reproduces the word shown beside it.
  const basis: BurialBasis =
    rsaBand !== null && (!hasReported || reported === rsaBand) ? "solvent-accessibility" : "none";
  const staleWord =
    rsaBand === null && hasReported
      ? `The stored result says \u201c${reported}\u201d, which an earlier engine estimated from packing density. It is not shown as a finding.`
      : null;

  const rsaPercent = rsa === null ? null : rsa * 100;

  const indicators: BurialEvidence["indicators"] = {
    rsa: {
      key: "rsa",
      label: "Relative solvent accessibility",
      band: rsaBand,
      valueLabel: rsaPercent === null ? null : `${rsaPercent.toFixed(1)}%`,
      isBasis: basis === "solvent-accessibility",
      detail:
        rsaBand === null
          ? "The accessibility step did not run for this variant, so no value was reported."
          : `Shrake\u2013Rupley SASA against the Tien et al. 2013 theoretical maximum. Core is at or below ${(BURIAL_RSA_BANDS.coreMax * 100).toFixed(0)}%, surface at or above ${(BURIAL_RSA_BANDS.surfaceMin * 100).toFixed(0)}%.`,
      ticks: [
        { value: BURIAL_RSA_BANDS.coreMax * 100, label: `${(BURIAL_RSA_BANDS.coreMax * 100).toFixed(0)}%` },
        { value: BURIAL_RSA_BANDS.surfaceMin * 100, label: `${(BURIAL_RSA_BANDS.surfaceMin * 100).toFixed(0)}%` },
      ],
      /*
       * A drawing domain, not a maximum: RSA can exceed 100% (a side chain more exposed than
       * the reference tripeptide), and a bar that saturates at the edge beside a value that says
       * 140.0% is a picture contradicting its own label.
       */
      domainMax: rsaPercent === null ? 100 : Math.max(100, Math.ceil(rsaPercent / 10) * 10),
      marker: rsaPercent,
    },
    packing: {
      key: "packing",
      label: `C\u03b1 neighbours within ${PACKING_NEIGHBOUR_BANDS.radiusAngstrom} \u00c5`,
      band: null,
      valueLabel: neighbourCount === null ? null : `${neighbourCount}`,
      isBasis: false,
      detail: "A reading only. The count loosely tracks burial and does not decide the burial word.",
      ticks: [],
      // Real structures reach ~40 Cα neighbours, so 24 is a drawing domain and it stretches.
      domainMax:
        neighbourCount === null
          ? PACKING_METER_BASE_DOMAIN
          : Math.max(PACKING_METER_BASE_DOMAIN, Math.ceil(neighbourCount / 8) * 8),
      marker: neighbourCount,
    },
  };

  /*
   * The reported word is checked against the accessibility it ships beside. A payload written
   * before the shared band existed (the 5%/25% engine) can carry a word that no longer matches.
   */
  let disagreement: string | null = null;
  if (rsaBand !== null && hasReported && rsaBand !== reported) {
    disagreement =
      `The reported classification (${reported}) does not match the accessibility ` +
      `measurement beside it: ${rsaPercent?.toFixed(1)}% relative accessibility reads as ` +
      `${BURIAL_LABELS[rsaBand].toLowerCase()} under the current cut-points. A word that disagrees with the value it ` +
      `is derived from is usually a stale result, so treat this position's burial as unreliable.`;
  }

  let caveat: string | null = null;
  if (rsaBand === null) {
    caveat = "Absence of an accessibility measurement is missing evidence, not evidence that the position is buried or exposed.";
  } else if (basis === "none") {
    caveat = "The accessibility reported for this position does not reproduce the classification beside it.";
  }

  return {
    status,
    label: BURIAL_LABELS[status],
    detail: BURIAL_DETAILS[status],
    basis,
    basisLabel: BASIS_LABELS[basis],
    basisDetail:
      basis === "solvent-accessibility"
        ? "Decided by the measured relative solvent accessibility."
        : rsaBand !== null
          ? "Not reproducible from the accessibility reported beside it."
          : "Solvent accessibility was not measured, so no burial word is given.",
    indicators,
    disagreement,
    staleWord,
    caveat,
  };
}

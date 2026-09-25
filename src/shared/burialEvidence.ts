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

/** Relative solvent accessibility cutoffs, as fractions of the Gly-X-Gly maximum. */
export const BURIAL_RSA_BANDS = {
  /** At or below this, the residue is buried in the hydrophobic core. */
  coreMax: 0.15,
  /** At or above this, the residue is solvent-exposed. Between the two is boundary. */
  surfaceMin: 0.35,
} as const;

/** Cα packing cutoffs, used when no solvent-accessibility measurement is available. */
export const PACKING_NEIGHBOUR_BANDS = {
  /** At or above this many Cα neighbours, the position is core. */
  coreMin: 15,
  /** At or below this many, the position is surface. Between the two is boundary. */
  surfaceMax: 7,
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

/** How the reported word was decided. These are different measurements. */
export type BurialBasis = "solvent-accessibility" | "residue-packing" | "none";

export interface BurialIndicator {
  key: "rsa" | "packing";
  label: string;
  /** Banded word for this indicator alone, or null when it cannot be banded. */
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
  /** The word to display, or `undetermined` when nothing was reported. */
  status: BurialWord | "undetermined";
  label: string;
  /** One sentence a non-structural reader can act on. */
  detail: string;
  basis: BurialBasis;
  basisLabel: string;
  basisDetail: string;
  indicators: { rsa: BurialIndicator; packing: BurialIndicator };
  /**
   * Non-null when the two indicators imply different words. The reported word still
   * wins — it came from the measurement the engine actually used — but a reader
   * comparing the two numbers deserves to know they disagree.
   */
  disagreement: string | null;
  /** What the word does not license. Null when there is nothing to warn about. */
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

/** Band a Cα neighbour count, or null when it was not measured. */
export function classifyPackingDensity(count: number | null | undefined): BurialWord | null {
  if (count === null || count === undefined || !Number.isFinite(count)) return null;
  if (count >= PACKING_NEIGHBOUR_BANDS.coreMin) return "core";
  if (count <= PACKING_NEIGHBOUR_BANDS.surfaceMax) return "surface";
  return "boundary";
}

const BURIAL_LABELS: Record<BurialWord | "undetermined", string> = {
  core: "Core",
  boundary: "Boundary",
  surface: "Surface",
  undetermined: "Undetermined",
};

const BURIAL_DETAILS: Record<BurialWord | "undetermined", string> = {
  core: "The side chain is buried, with little or no solvent contact, so a polar or charged substitution here has to pay a desolvation cost.",
  boundary: "The side chain is partly buried: it sits in a pocket or at a boundary rather than fully inside the core or fully exposed.",
  surface: "The side chain is solvent-exposed, where substitutions mostly change the surface a partner or ligand sees rather than the fold.",
  undetermined: "No burial measurement was reported for this position, so no statement about exposure can be made.",
};

const BASIS_LABELS: Record<BurialBasis, string> = {
  "solvent-accessibility": "Measured accessibility",
  "residue-packing": "Estimated from packing",
  none: "Not measured",
};

/**
 * Build the burial/exposure reading.
 *
 * The reported `burialStatus` is preferred over anything derived here: it comes from the
 * engine that saw the coordinates, and re-deriving it in the UI is how the badge and the
 * prose drifted apart in the first place. The indicators are shown beside it so the
 * reader can see which measurement it rests on.
 */
export function deriveBurialEvidence(input: BurialEvidenceInput): BurialEvidence {
  const rsa = typeof input.rsa === "number" && Number.isFinite(input.rsa) ? input.rsa : null;
  const neighbourCount =
    typeof input.neighbourCount === "number" && Number.isFinite(input.neighbourCount)
      ? input.neighbourCount
      : null;

  const rsaBand = classifyBurialRsa(rsa);
  const packingBand = classifyPackingDensity(neighbourCount);

  const reported = typeof input.burialStatus === "string" ? input.burialStatus.trim().toLowerCase() : "";
  const hasReported = BURIAL_WORDS.has(reported);
  const status: BurialWord | "undetermined" = hasReported ? (reported as BurialWord) : "undetermined";

  /*
   * Which indicator the word rests on. The engine measures solvent accessibility when the
   * SASA sidecar runs and falls back to Cα packing when it does not, so an RSA value being
   * present is the signal that the word is the measured one.
   *
   * Only claimed when the indicator actually *agrees* with the word it is supposed to have
   * decided. Otherwise the panel asserted a basis that its own card contradicted — the
   * engine's "residue not found in the structure" path returns `boundary` with a neighbour
   * count of 0, which bands as surface, and the panel printed "Decided by C̲α packing density"
   * beside a packing card reading SURFACE for a word reading Boundary.
   */
  const measuredBasis: BurialBasis =
    rsaBand !== null ? "solvent-accessibility" : packingBand !== null ? "residue-packing" : "none";
  const basisIsReproduced =
    status !== "undetermined" &&
    ((measuredBasis === "solvent-accessibility" && rsaBand === status) ||
      (measuredBasis === "residue-packing" && packingBand === status));
  const basis: BurialBasis = basisIsReproduced ? measuredBasis : "none";
  const hasAnyMeasurement = rsaBand !== null || packingBand !== null;

  const rsaPercent = rsa === null ? null : rsa * 100;
  const packingMarker = neighbourCount;

  const indicators: BurialEvidence["indicators"] = {
    rsa: {
      key: "rsa",
      label: "Relative solvent accessibility",
      band: rsaBand,
      valueLabel: rsaPercent === null ? null : `${rsaPercent.toFixed(1)}%`,
      isBasis: basis === "solvent-accessibility",
      detail:
        rsaBand === null
          ? "The SASA measurement did not run for this variant, so no accessibility value was reported."
          : `Shrake–Rupley SASA against the Gly-X-Gly maximum. Core is at or below ${(BURIAL_RSA_BANDS.coreMax * 100).toFixed(0)}%, surface at or above ${(BURIAL_RSA_BANDS.surfaceMin * 100).toFixed(0)}%.`,
      ticks: [
        { value: BURIAL_RSA_BANDS.coreMax * 100, label: `${(BURIAL_RSA_BANDS.coreMax * 100).toFixed(0)}%` },
        { value: BURIAL_RSA_BANDS.surfaceMin * 100, label: `${(BURIAL_RSA_BANDS.surfaceMin * 100).toFixed(0)}%` },
      ],
      /*
       * A drawing domain, not a maximum: RSA can exceed 100% (a side chain more exposed than
       * the Gly-X-Gly reference), and a bar that saturates at the edge beside a value that
       * says 140.0% is a picture contradicting its own label. The domain stretches to contain
       * the marker, and the ticks stay where the classifier's thresholds are.
       */
      domainMax: rsaPercent === null ? 100 : Math.max(100, Math.ceil(rsaPercent / 10) * 10),
      marker: rsaPercent,
    },
    packing: {
      key: "packing",
      label: `Cα neighbours within ${PACKING_NEIGHBOUR_BANDS.radiusAngstrom} Å`,
      band: packingBand,
      valueLabel: packingMarker === null ? null : `${packingMarker}`,
      isBasis: basis === "residue-packing",
      detail: `Core is at or above ${PACKING_NEIGHBOUR_BANDS.coreMin} neighbours, surface at or below ${PACKING_NEIGHBOUR_BANDS.surfaceMax}.`,
      ticks: [
        { value: PACKING_NEIGHBOUR_BANDS.surfaceMax, label: `${PACKING_NEIGHBOUR_BANDS.surfaceMax}` },
        { value: PACKING_NEIGHBOUR_BANDS.coreMin, label: `${PACKING_NEIGHBOUR_BANDS.coreMin}` },
      ],
      // Same reasoning: real structures reach 41 Cα neighbours, so 24 is a drawing domain and
      // it stretches rather than saturating.
      domainMax:
        packingMarker === null
          ? PACKING_METER_BASE_DOMAIN
          : Math.max(PACKING_METER_BASE_DOMAIN, Math.ceil(packingMarker / 8) * 8),
      marker: packingMarker,
    },
  };

  /*
   * A disagreement is informative, never an error to resolve: the two quantities are
   * different measurements (accessible surface vs. Cα shell occupancy), and a position
   * can genuinely be tightly packed yet solvent-reachable. The word shown is still the one
   * the engine reported.
   *
   * The reported-word-vs-accessibility check comes FIRST. A payload written before the
   * shared band existed (a client bundle or a persisted record from the 5%/25% engine) can
   * carry a word that no longer matches the RSA it ships beside — and because the accessible
   * surface is the measurement the word is supposed to come from, that is the contradiction
   * worth naming. Checking the two indicators first would have described it as a
   * packing-vs-accessibility difference and asserted, wrongly, that the badge follows the
   * accessibility measurement.
   */
  let disagreement: string | null = null;
  if (rsaBand !== null && status !== "undetermined" && rsaBand !== status) {
    disagreement =
      `The reported classification (${BURIAL_LABELS[status].toLowerCase()}) does not match the accessibility ` +
      `measurement beside it: ${rsaPercent?.toFixed(1)}% relative accessibility reads as ` +
      `${BURIAL_LABELS[rsaBand].toLowerCase()} under the current cutoffs. A word that disagrees with the value it ` +
      `is derived from is usually a stale result — treat this position's burial status as unreliable.`;
  } else if (rsaBand !== null && packingBand !== null && rsaBand !== packingBand) {
    disagreement =
      `The two indicators point different ways: ${rsaPercent?.toFixed(1)}% relative accessibility reads as ` +
      `${BURIAL_LABELS[rsaBand].toLowerCase()}, while ${neighbourCount} Cα neighbours read as ` +
      `${BURIAL_LABELS[packingBand].toLowerCase()}. The badge follows the accessibility measurement, because ` +
      `that is the one taken from the solvent-accessible surface.`;
  } else if (packingBand !== null && rsaBand === null && status !== "undetermined" && packingBand !== status) {
    /*
     * No accessibility measurement, so the word should be the packing band — and it is not.
     * The engine has exactly one such case: when the variant residue is missing from the
     * modelled structure it returns `boundary` with a neighbour count of 0 ("Target residue
     * not found in structure"). Rendering that as a confident "boundary, 0 neighbours" pair
     * hid both the placeholder and the contradiction.
     */
    disagreement =
      `The reported classification (${BURIAL_LABELS[status].toLowerCase()}) does not match its own packing ` +
      `measurement: ${neighbourCount} Cα neighbours reads as ${BURIAL_LABELS[packingBand].toLowerCase()}. ` +
      `A classification that contradicts the only measurement behind it is usually a placeholder — treat ` +
      `this position's burial status as unreliable.`;
  }

  const caveat =
    basis === "residue-packing"
      ? `The classification rests on Cα packing density, not on a measured accessible surface: the SASA step did not run for this variant, and packing density is a proxy for burial rather than a measurement of it.`
      : basis === "none"
        ? hasAnyMeasurement
          ? "The measurements reported for this position do not reproduce the classification beside them, so this panel cannot say which of them decided it."
          : "Absence of a burial result is missing evidence, not evidence that the position is exposed."
        : null;

  return {
    status,
    label: BURIAL_LABELS[status],
    /* When the word is a packing estimate, say so in the sentence that defines the word. */
    detail:
      basis === "residue-packing" ? `${BURIAL_DETAILS[status]} (Estimated from packing density.)` : BURIAL_DETAILS[status],
    basis,
    basisLabel: BASIS_LABELS[basis],
    basisDetail:
      basis === "solvent-accessibility"
        ? "Decided by the measured relative solvent accessibility."
        : basis === "residue-packing"
          ? "Decided by Cα packing density, because no accessibility measurement was available."
          : hasAnyMeasurement
            ? "Not reproducible from the measurements reported for this position."
            : "No burial or packing measurement was reported for this position.",
    indicators,
    disagreement,
    caveat,
  };
}

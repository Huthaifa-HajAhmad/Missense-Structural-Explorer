/**
 * calibration.ts — the published PP3/BP4 score bands, and nothing else.
 *
 * WHY THIS EXISTS
 * ---------------
 * The in-silico evaluators used to read cut-points that were labelled "ClinGen-calibrated" but were
 * not the ClinGen numbers:
 *
 *   • REVEL ≥ 0.75 was called "PP3 (Strong)". Pejaver et al. 2022 put Strong at ≥ 0.932; 0.75 lies
 *     inside the Moderate band, and the benign cut (0.15) had no source at all.
 *   • AlphaMissense ≥ 0.983 / ≤ 0.063 were credited to Pejaver 2022, a paper that predates
 *     AlphaMissense. ClinGen's calibration is Bergquist et al. 2025.
 *   • CADD ≥ 25 was called "Strong". CADD reaches Moderate at most (≥ 28.1).
 *   • BayesDel's benign cut (−0.0404) was not the published −0.18.
 *
 * Every band below is transcribed from the source named beside it, with the interval edges the
 * paper prints. A tool whose authors publish no ClinGen calibration is NOT in this table — the
 * evaluators give those tools their authors' own cut-points and the UI labels them uncalibrated.
 *
 * Reading the bands: a score earns the STRONGEST strength whose threshold it passes. `higher`
 * orientation means larger scores are more pathogenic (REVEL); `lower` means more negative is more
 * pathogenic (ESM1b log-likelihood ratio).
 *
 * Sources
 *   Pejaver V, et al. Calibration of computational tools for missense variant pathogenicity
 *     classification and ClinGen recommendations for PP3/BP4 criteria. Am J Hum Genet 2022;
 *     109:2163–2177. Table 2.
 *   Bergquist T, et al. Calibration of additional computational tools expands ClinGen
 *     recommendation options for variant classification with PP3/BP4 criteria. Genet Med 2025;
 *     27:101402. Table 1.
 */

export type EvidenceStrength = "Supporting" | "Moderate" | "Strong" | "VeryStrong";

/** Strongest first — the order a score is tested in. */
export const STRENGTH_ORDER: readonly EvidenceStrength[] = ["VeryStrong", "Strong", "Moderate", "Supporting"];

export type CalibrationSourceId = "pejaver2022" | "bergquist2025";

export const CALIBRATION_SOURCES: Record<CalibrationSourceId, { short: string; citation: string; doi: string }> = {
  pejaver2022: {
    short: "Pejaver et al. 2022",
    citation:
      "Pejaver V, et al. Calibration of computational tools for missense variant pathogenicity classification and ClinGen recommendations for PP3/BP4 criteria. Am J Hum Genet 2022;109:2163–2177.",
    doi: "10.1016/j.ajhg.2022.10.013",
  },
  bergquist2025: {
    short: "Bergquist et al. 2025",
    citation:
      "Bergquist T, et al. Calibration of additional computational tools expands ClinGen recommendation options for variant classification with PP3/BP4 criteria. Genet Med 2025;27:101402.",
    doi: "10.1016/j.gim.2025.101402",
  },
};

export interface CalibratedBands {
  /** `higher`: larger = more pathogenic. `lower`: more negative = more pathogenic. */
  orientation: "higher" | "lower";
  /** PP3: the score must be at least this pathogenic (≥ for `higher`, ≤ for `lower`). */
  pp3: Partial<Record<EvidenceStrength, number>>;
  /** BP4: the score must be at least this benign (≤ for `higher`, ≥ for `lower`). */
  bp4: Partial<Record<EvidenceStrength, number>>;
  source: CalibrationSourceId;
  /** The score the paper calibrated, when that is narrower than the tool's name. */
  variant?: string;
}

export type CalibratedToolKey = "revel" | "bayesdel" | "cadd" | "alphaMissense" | "esm1b" | "phylop" | "gerp";

export const PP3_BP4_CALIBRATION: Record<CalibratedToolKey, CalibratedBands> = {
  /** Pejaver 2022 Table 2: BP4 VS ≤0.003 · S (0.003,0.016] · M (0.016,0.183] · Sup (0.183,0.290]; PP3 Sup [0.644,0.773) · M [0.773,0.932) · S ≥0.932. */
  revel: {
    orientation: "higher",
    pp3: { Supporting: 0.644, Moderate: 0.773, Strong: 0.932 },
    bp4: { Supporting: 0.29, Moderate: 0.183, Strong: 0.016, VeryStrong: 0.003 },
    source: "pejaver2022",
  },
  /** Pejaver 2022 Table 2, BayesDel without allele frequency: BP4 M ≤−0.36 · Sup (−0.36,−0.18]; PP3 Sup [0.13,0.27) · M [0.27,0.50) · S ≥0.50. */
  bayesdel: {
    orientation: "higher",
    pp3: { Supporting: 0.13, Moderate: 0.27, Strong: 0.5 },
    bp4: { Supporting: -0.18, Moderate: -0.36 },
    source: "pejaver2022",
    variant: "BayesDel noAF",
  },
  /** Pejaver 2022 Table 2: BP4 S ≤0.15 · M (0.15,17.3] · Sup (17.3,22.7]; PP3 Sup [25.3,28.1) · M ≥28.1. */
  cadd: {
    orientation: "higher",
    pp3: { Supporting: 25.3, Moderate: 28.1 },
    bp4: { Supporting: 22.7, Moderate: 17.3, Strong: 0.15 },
    source: "pejaver2022",
    variant: "CADD PHRED",
  },
  /**
   * Bergquist 2025 Table 1 (points scale −4…+4): −3 ≤0.070 · −2 [0.071,0.099] · −1 [0.100,0.169] ·
   * +1 [0.792,0.905] · +2 [0.906,0.971] · +3 [0.972,0.989] · +4 ≥0.990. The ±3 bins are read as
   * Moderate, the strength ClinGen codes them at.
   */
  alphaMissense: {
    orientation: "higher",
    pp3: { Supporting: 0.792, Moderate: 0.906, Strong: 0.99 },
    bp4: { Supporting: 0.169, Moderate: 0.099 },
    source: "bergquist2025",
  },
  /**
   * Bergquist 2025 Table 1: −3 ≥8.8 · −2 [−3.1,8.7] · −1 [−6.3,−3.2] · +1 [−12.1,−10.7] ·
   * +2 [−13.9,−12.2] · +3 [−23.9,−14.0] · +4 ≤−24.0. Scores are printed to one decimal, so the gaps
   * between bins (e.g. −10.65) fall back to indeterminate rather than being rounded into a band.
   */
  esm1b: {
    orientation: "lower",
    pp3: { Supporting: -10.7, Moderate: -12.2, Strong: -24.0 },
    bp4: { Supporting: -6.3, Moderate: -3.1 },
    source: "bergquist2025",
    variant: "ESM1b LLR",
  },
  /** Pejaver 2022 Table 2: BP4 M ≤0.021 · Sup (0.021,1.879]; PP3 Sup [7.367,9.741) · M ≥9.741. */
  phylop: {
    orientation: "higher",
    pp3: { Supporting: 7.367, Moderate: 9.741 },
    bp4: { Supporting: 1.879, Moderate: 0.021 },
    source: "pejaver2022",
  },
  /** Pejaver 2022 Table 2: GERP++ reaches no PP3 strength at all; BP4 M ≤−4.54 · Sup (−4.54,2.70]. */
  gerp: {
    orientation: "higher",
    pp3: {},
    bp4: { Supporting: 2.7, Moderate: -4.54 },
    source: "pejaver2022",
    variant: "GERP++ RS",
  },
};

export interface CalibratedCall {
  /** `PP3` / `BP4` when a band is reached; `null` for the indeterminate middle. */
  direction: "PP3" | "BP4" | null;
  strength: EvidenceStrength | null;
  /** e.g. "PP3_Moderate", "BP4" (Supporting carries no suffix, as ACMG writes it), or "Indeterminate". */
  code: string;
}

/** A code as a reader sees it: "PP3 Moderate", "BP4 Very Strong", "PP3". */
export function formatEvidenceCode(code: string): string {
  return code.replace("_", " ").replace("VeryStrong", "Very Strong");
}

export function strengthCode(direction: "PP3" | "BP4", strength: EvidenceStrength): string {
  return strength === "Supporting" ? direction : `${direction}_${strength === "VeryStrong" ? "VeryStrong" : strength}`;
}

function passes(score: number, threshold: number, orientation: "higher" | "lower", side: "pp3" | "bp4"): boolean {
  const pathogenicIsHigh = orientation === "higher";
  const wantHigh = side === "pp3" ? pathogenicIsHigh : !pathogenicIsHigh;
  return wantHigh ? score >= threshold : score <= threshold;
}

/**
 * The calibrated strength one score earns, or `null` when the score is missing / not finite.
 * Tested strongest first, PP3 before BP4 — the two sides cannot overlap in any published table.
 */
export function calibratedCall(tool: CalibratedToolKey, score: number | null | undefined): CalibratedCall | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  const bands = PP3_BP4_CALIBRATION[tool];
  for (const side of ["pp3", "bp4"] as const) {
    for (const strength of STRENGTH_ORDER) {
      const threshold = bands[side][strength];
      if (threshold === undefined) continue;
      if (passes(score, threshold, bands.orientation, side)) {
        const direction = side === "pp3" ? "PP3" : "BP4";
        return { direction, strength, code: strengthCode(direction, strength) };
      }
    }
  }
  return { direction: null, strength: null, code: "Indeterminate" };
}

/** One band as a closed interval on the score axis, for drawing and for listing cut-points. */
export interface CalibrationBand {
  direction: "PP3" | "BP4";
  strength: EvidenceStrength;
  code: string;
  /** Inclusive edge nearest the indeterminate middle. */
  threshold: number;
  /** The next stronger band's threshold, or `null` when this band runs to the end of the scale. */
  until: number | null;
}

/** Every band of a tool, weakest first on each side, PP3 then BP4. */
export function calibrationBands(tool: CalibratedToolKey): CalibrationBand[] {
  const bands = PP3_BP4_CALIBRATION[tool];
  const out: CalibrationBand[] = [];
  for (const side of ["pp3", "bp4"] as const) {
    const direction = side === "pp3" ? "PP3" : "BP4";
    const present = [...STRENGTH_ORDER].reverse().filter(s => bands[side][s] !== undefined);
    present.forEach((strength, i) => {
      const next = present[i + 1];
      out.push({
        direction,
        strength,
        code: strengthCode(direction, strength),
        threshold: bands[side][strength] as number,
        until: next ? (bands[side][next] as number) : null,
      });
    });
  }
  return out;
}

/**
 * Regional missense constraint → PP2 / BP1, the one genome-wide calibration of a population-depletion
 * reading that matches the data this app loads.
 *
 * Chao et al. v3 calibrate the O/E of the gnomAD v4.1.1 missense constraint region (MCR) that contains a
 * variant, with the ClinGen local-posterior framework (prior 4.41%; ClinVar 20250504 P/LP vs B/LB
 * missense, ≥1 star, gnomAD AF < 1%). The MCR file is the one `constraintSource.ts` pins
 * (`papers/2026-rmc/gnomad_v4.1.1_all_mcrs.tsv`). They assign the result to PP2 and BP1, not PM1;
 * their v2 preprint's PM1 cuts (≤ 0.37 / ≤ 0.21) were on gnomAD v2.1.1 MCRs and are superseded.
 *
 * It replaced the engine's earlier PP2 rule, gene missense Z ≥ 3.09 AND o/e < 0.6. Each number has a
 * gnomAD-era origin (Z 3.09 is ExAC's p < 0.001 line), but the pair was never calibrated as PP2
 * evidence. The BP1 bands are display context only: the engine does not apply BP1, an owner decision
 * (criteria.ts) that this calibration does not revisit.
 *
 * Edges as printed: pathogenic "OE ≤ 0.36" Moderate, "OE ≤ 0.59" Supporting; benign "OE > 0.97"
 * Supporting, "OE > 1.23" Moderate. The authors call the thresholds conservative because no coverage
 * restriction was applied.
 */
export const REGIONAL_MISSENSE_SOURCE = {
  short: "Chao et al. 2026 (preprint)",
  citation:
    "Chao KR, et al. The landscape of regional missense mutational intolerance quantified from 730,947 exomes. bioRxiv 2024.04.11.588920, version 3 (2026).",
  doi: "10.1101/2024.04.11.588920",
  framework: "ClinGen local posterior probability, prior 4.41%",
} as const;

export const REGIONAL_MISSENSE_CALIBRATION = {
  pp2: { Moderate: 0.36, Supporting: 0.59 },
  bp1: { Supporting: 0.97, Moderate: 1.23 },
} as const;

export type RegionalPp2Code = "PP2_Moderate" | "PP2";
export type RegionalBp1Code = "BP1_Moderate" | "BP1";

/** PP2 strength for an MCR O/E (≤ edges); `null` above the Supporting edge; `undefined` with no O/E. */
export function regionalPp2Code(oe: number | null | undefined): RegionalPp2Code | null | undefined {
  if (oe === null || oe === undefined || !Number.isFinite(oe)) return undefined;
  if (oe <= REGIONAL_MISSENSE_CALIBRATION.pp2.Moderate) return "PP2_Moderate";
  if (oe <= REGIONAL_MISSENSE_CALIBRATION.pp2.Supporting) return "PP2";
  return null;
}

/** The calibrated BP1 band for an MCR O/E (> edges). Display context only; the engine does not apply BP1. */
export function regionalBp1Code(oe: number | null | undefined): RegionalBp1Code | null | undefined {
  if (oe === null || oe === undefined || !Number.isFinite(oe)) return undefined;
  if (oe > REGIONAL_MISSENSE_CALIBRATION.bp1.Moderate) return "BP1_Moderate";
  if (oe > REGIONAL_MISSENSE_CALIBRATION.bp1.Supporting) return "BP1";
  return null;
}

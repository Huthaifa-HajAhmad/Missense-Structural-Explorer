/**
 * lofMechanismBasis.ts — what curated gene–disease mechanism records establish about loss-of-function
 * as a disease mechanism, for PVS1 (Abou Tayoun et al. 2018, Hum Mutat 39:1517).
 *
 * pLI >= 0.9 reflects evolutionary constraint against PTVs in gnomAD, not Mendelian LOF mechanism:
 * gain-of-function / dominant-negative genes can carry pLI >= 0.9 while autosomal recessive LOF
 * genes often have pLI near 0. PVS1 therefore requires a curated LOF mechanism rather than pLI alone.
 */

/** Qualifying Gene2Phenotype confidence categories for mechanism-level rule use. */
export const QUALIFYING_G2P_CONFIDENCE = ["definitive", "strong", "moderate"] as const;

export interface CuratedLofMechanism {
  source: "Gene2Phenotype" | "ClinGen" | "ClinGen/Gene2Phenotype";
  /** True when qualifying G2P records include `loss of function` or ClinGen HI score is 3 (Sufficient evidence). */
  lofEstablished: boolean;
  /** True when qualifying curated records establish only non-LOF mechanisms (e.g. gain of function, dominant negative). */
  nonLofOnly: boolean;
  /** Distinct determined qualifying mechanisms seen (lowercased trimmed labels). */
  mechanisms: string[];
  records: number;
}

export interface MechanismRecordLike {
  mechanism: string;
  confidence: string;
}

/** Summarise installed G2P mechanism records (and optional cached ClinGen HI dosage score) for PVS1. */
export function summariseCuratedLofMechanism(
  records: ReadonlyArray<MechanismRecordLike> | null | undefined,
  options?: { clingenHaploScore?: number | null },
): CuratedLofMechanism | null {
  const qualifying = (records ?? []).filter(r => {
    const conf = r.confidence.trim().toLowerCase();
    const mech = r.mechanism.trim().toLowerCase();
    return (QUALIFYING_G2P_CONFIDENCE as readonly string[]).includes(conf)
      && Boolean(mech)
      && mech !== "undetermined";
  });

  const g2pMechanisms = [...new Set(qualifying.map(r => r.mechanism.trim().toLowerCase()))].sort();
  const g2pHasLof = g2pMechanisms.some(m => m === "loss of function");
  const clingenHasLof = options?.clingenHaploScore === 3;

  if (!g2pMechanisms.length && !clingenHasLof) {
    return null;
  }

  const lofEstablished = g2pHasLof || clingenHasLof;
  const source: CuratedLofMechanism["source"] = g2pHasLof && clingenHasLof
    ? "ClinGen/Gene2Phenotype"
    : clingenHasLof
      ? "ClinGen"
      : "Gene2Phenotype";

  const mechanisms = clingenHasLof && !g2pHasLof
    ? [...g2pMechanisms, "clingen haploinsufficiency (score 3)"]
    : g2pMechanisms;

  return {
    source,
    lofEstablished,
    nonLofOnly: !lofEstablished && g2pMechanisms.length > 0,
    mechanisms,
    records: qualifying.length + (clingenHasLof ? 1 : 0),
  };
}

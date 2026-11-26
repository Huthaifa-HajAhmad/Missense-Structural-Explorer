import type { ConservationData } from "../../../../src/shared/contracts.ts";
import type { LocalDbnsfpRecord } from "../dbnsfp_local.ts";

/**
 * The dbNSFP columns this app reads, in one shape.
 *
 * Three sources serve dbNSFP: the local store (on the production server only), query.dbnsfp.org and
 * MyVariant.info. Each has one parser that fills this record, and `fetchConservationData` turns
 * whichever record arrives first into the payload. A column is therefore read in one place per
 * source, so a wrong column name (BayesDel with allele frequency instead of without) cannot hide
 * in one copy of the parser.
 */
export type DbnsfpScores = Pick<
  ConservationData,
  | "revel" | "gerp" | "phylop" | "bayesdel"
  | "esm1b" | "esm1bPred" | "popeve" | "popeveSource" | "aouFrequency" | "spliceai"
> & { revel: number | null; popeve: number | null };

/** A record and where it came from: the payload's `source`, and the release behind its REVEL score. */
export interface DbnsfpAnswer {
  scores: DbnsfpScores;
  source: "local dbNSFP" | "Public dbNSFP (dbnsfp.org)" | "myvariant.info";
  revelProvenance: string;
}

export const NO_DBNSFP_SCORES: DbnsfpScores = {
  revel: null,
  gerp: null,
  phylop: null,
  bayesdel: null,
  esm1b: null,
  esm1bPred: null,
  popeve: null,
  popeveSource: null,
  aouFrequency: null,
  spliceai: null,
};

/** dbNSFP's popEVE column names no protein, so the transcript of the row it came from is its source. */
export function dbnsfpPopEveSource(score: number | null, transcript: string | null): DbnsfpScores["popeveSource"] {
  return score === null ? null : { protein: null, substitution: null, match: "dbnsfp", transcript };
}

/** All of Us counts, or null when none was measured (all four missing). */
export function aouFromCounts(
  ac: number | null | undefined,
  an: number | null | undefined,
  het: number | null | undefined,
  hom: number | null | undefined
): DbnsfpScores["aouFrequency"] {
  if (ac == null && an == null && het == null && hom == null) return null;
  return { aouAC: ac ?? null, aouAN: an ?? null, aouHet: het ?? null, aouHom: hom ?? null };
}

/** The local store's row. Its columns are already numbers; it has no SpliceAI or prediction labels. */
export function scoresFromLocalRecord(rec: LocalDbnsfpRecord): DbnsfpScores {
  return {
    ...NO_DBNSFP_SCORES,
    revel: rec.revel ?? null,
    gerp: rec.gerp ?? null,
    phylop: rec.phylop ?? null,
    bayesdel: rec.bayesdel ?? null,
    esm1b: rec.esm1b ?? null,
    popeve: rec.popeve ?? null,
    popeveSource: dbnsfpPopEveSource(rec.popeve ?? null, rec.transcript ?? null),
    aouFrequency: aouFromCounts(rec.aou_ac, rec.aou_an, rec.aou_het, rec.aou_hom),
  };
}

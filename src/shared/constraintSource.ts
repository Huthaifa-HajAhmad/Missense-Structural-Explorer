/** Pinned constraint releases. Gene and regional releases are independent products. */
export const CONSTRAINT_RELEASE = "4.1.2";
export const REGIONAL_CONSTRAINT_RELEASE = "4.1.1";
export const CONSTRAINT_URL = `https://storage.googleapis.com/gcp-public-data--gnomad/release/${CONSTRAINT_RELEASE}/constraint/gnomad.v${CONSTRAINT_RELEASE}.constraint_metrics.tsv.bgz`;
export const REGIONAL_CONSTRAINT_URL = `https://storage.googleapis.com/gcp-public-data--gnomad/papers/2026-rmc/gnomad_v${REGIONAL_CONSTRAINT_RELEASE}_all_mcrs.tsv`;
export const CONSTRAINT_GUIDANCE_URL = "https://gnomad.broadinstitute.org/news/2026-03-gnomad-v4-1-1/";
export const REGIONAL_STATUSES = ["measured", "no-regions", "outside-region", "unverified-locus", "transcript-mismatch", "failed-qc", "nonsignificant", "invalid-data"] as const;
export type RegionalConstraintStatus = typeof REGIONAL_STATUSES[number];

export interface ConstraintProvenance {
  release: string;
  assembly: "GRCh38";
  geneId: string;
  transcriptId: string;
  transcriptVersion: string;
  selection: "matched" | "mane-select" | "canonical";
  sourceUrl: string;
  sourceSha256: string;
}

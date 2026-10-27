/** Pinned constraint releases. Gene and regional releases are independent products. */
export const CONSTRAINT_RELEASE = "4.1.2";
export const REGIONAL_CONSTRAINT_RELEASE = "4.1.1";
export const CONSTRAINT_URL = `https://storage.googleapis.com/gcp-public-data--gnomad/release/${CONSTRAINT_RELEASE}/constraint/gnomad.v${CONSTRAINT_RELEASE}.constraint_metrics.tsv.bgz`;
export const REGIONAL_CONSTRAINT_URL = `https://storage.googleapis.com/gcp-public-data--gnomad/papers/2026-rmc/gnomad_v${REGIONAL_CONSTRAINT_RELEASE}_all_mcrs.tsv`;
export const CONSTRAINT_GUIDANCE_URL = "https://gnomad.broadinstitute.org/news/2026-03-gnomad-v4-1-1/";
/**
 * Pinned SHA-256 of the official source bytes. The importer refuses to mint a snapshot from
 * different upstream bytes, so a silent GCS replacement cannot quietly redefine a release.
 * Update these together with the release constants when intentionally moving to a new release.
 */
export const CONSTRAINT_SOURCE_SHA256 = "a3fbca52b2beb889dba15cc558f6b6c937f9ea48982f2940395913bd138a858f";
export const REGIONAL_SOURCE_SHA256 = "f31bbe463311487127c2b789faf1b358b962f4c599568e9e01ee777ed3b0813d";
export const REGIONAL_STATUSES = ["measured", "no-regions", "outside-region", "unverified-locus", "transcript-mismatch", "failed-qc", "nonsignificant", "invalid-data"] as const;
export type RegionalConstraintStatus = typeof REGIONAL_STATUSES[number];

/** The three gene-constraint readings the app shows, in display order (strip, card, inspector). */
export type ConstraintMetricKey = "missense-z" | "loeuf" | "regional-oe";

export interface ConstraintProvenance {
  release: string;
  assembly: "GRCh38";
  geneId: string;
  transcriptId: string;
  transcriptVersion: string;
  selection: "matched" | "mane-select" | "canonical" | "sole-transcript";
  sourceUrl: string;
  sourceSha256: string;
}

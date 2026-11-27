/**
 * clinvarPs1.ts — shared staleness guard for saved analyses that recorded PS1 before the
 * verified-allele requirement landed (advisor re-review Finding #1).
 *
 * PS1 asserts a DIFFERENT nucleotide change causing the same amino acid change. A saved analysis
 * from an unresolved protein-only query (no verified GRCh38 allele and no explicit `c.` notation)
 * cannot establish that difference and must be recomputed once instead of served from cache.
 */

export interface Ps1ResultLike {
  metadata?: {
    variant?: string | null;
    originalNotation?: string | null;
  } | null;
  clinvar?: {
    hasOtherPathogenicVariantSameAA?: boolean | null;
  } | null;
  predictorData?: {
    gnomadVariantId?: string | null;
    gnomadVariantAssembly?: string | null;
    locusResolution?: {
      failureKind?: string | null;
    } | null;
  } | null;
  ruleBasedInsights?: {
    acmgCriteria?: ReadonlyArray<{ code?: string | null }> | null;
  } | null;
}

const CODING_RE = /(?:^|[:(\s])c\.[^\s()]+/i;

export function recordsUnverifiedPs1(result: Ps1ResultLike | null | undefined): boolean {
  if (!result) return false;
  const hasPs1Code = Boolean(
    result.ruleBasedInsights?.acmgCriteria?.some(c => /^PS1(?:_|$)/i.test(c?.code ?? ""))
  );
  const hasFlag = result.clinvar?.hasOtherPathogenicVariantSameAA === true;
  if (!hasPs1Code && !hasFlag) return false;

  const hasVerifiedGrch38 = Boolean(
    result.predictorData?.gnomadVariantId &&
    result.predictorData.gnomadVariantAssembly === "GRCh38" &&
    !result.predictorData.locusResolution?.failureKind
  );
  if (hasVerifiedGrch38) return false;

  const hasExplicitCoding = Boolean(
    (result.metadata?.originalNotation && CODING_RE.test(result.metadata.originalNotation)) ||
    (result.metadata?.variant && CODING_RE.test(result.metadata.variant))
  );
  return !hasExplicitCoding;
}

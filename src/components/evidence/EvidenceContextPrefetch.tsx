import React from 'react';
import { useEvidenceContext, type EvidenceContextInput } from '../../hooks/useEvidenceContext';
import type { AnalysisResult } from '../../types';

/** Warm gene-level evidence during a submitted analysis, before the first core chunk arrives.
 * Coordinate-only searches wait for their resolved gene. Draft fields never start requests.
 * The same reader survives the first result so shared store slots coalesce every request. */
export function EvidenceContextPrefetch({ result, pendingGene, pendingVariant = '', pendingUniprotId = '' }: {
  result: AnalysisResult | null; pendingGene?: string; pendingVariant?: string; pendingUniprotId?: string;
}) {
  if (result?.isDemoData) return null;
  const identity = result ?? (pendingGene ? { metadata: { gene: pendingGene, variant: pendingVariant, uniprotId: pendingUniprotId } } : null);
  return identity ? <ContextReads key={identity.metadata?.gene} result={identity} /> : null;
}
function ContextReads({ result }: { result: EvidenceContextInput }) {
  useEvidenceContext(result, true, true, true);
  return null;
}

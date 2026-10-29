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
  // Hot spots are keyed by protein AND transcript, and a pending analysis knows neither reliably yet:
  // warming them from the pending identity would build the whole response again under a different key
  // once the result lands. They start with the result, which is still long before the tab is opened.
  return identity ? <ContextReads key={identity.metadata?.gene} result={identity} hotspots={Boolean(result)} /> : null;
}
function ContextReads({ result, hotspots }: { result: EvidenceContextInput; hotspots: boolean }) {
  useEvidenceContext(result, true, true, true, true, hotspots);
  return null;
}

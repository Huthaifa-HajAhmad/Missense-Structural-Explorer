import { useEffect, useState } from 'react';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import type { AnalysisResult } from '../../types';

/**
 * Warms the gene-level reference reads (disease, dosage, expression, models) once a result exists, so the
 * Gene–disease and Expression & models tabs open already populated instead of fetching on first view.
 * Renders nothing. It reuses the tabs' own loader and cache, so a tab opened mid-flight joins the same
 * request. Deferred briefly so the primary analysis requests keep the connection first.
 */
export function EvidenceContextPrefetch({ result }: { result: AnalysisResult }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 1200); return () => clearTimeout(t); }, []);
  return armed ? <Warm result={result} /> : null;
}
function Warm({ result }: { result: AnalysisResult }) {
  useEvidenceContext(result, true, true);
  return null;
}

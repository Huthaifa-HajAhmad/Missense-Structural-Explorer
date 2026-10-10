import { useEffect, useState } from 'react';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import type { AnalysisResult } from '../../types';

/**
 * Warms the small gene-level reference reads (disease and dosage) once a result exists, so the
 * shared disease frame is ready. Human and animal providers load when their own tab opens.
 * Renders nothing. It reuses the tabs' own loader and cache, so a tab opened mid-flight joins the same
 * request. Deferred briefly so the primary analysis requests keep the connection first.
 */
export function EvidenceContextPrefetch({ result }: { result: AnalysisResult }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 1200); return () => clearTimeout(t); }, []);
  return armed ? <Warm result={result} /> : null;
}
function Warm({ result }: { result: AnalysisResult }) {
  useEvidenceContext(result, false, true, false);
  return null;
}

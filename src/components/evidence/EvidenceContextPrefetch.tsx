import { useEffect, useState } from 'react';
import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import type { AnalysisResult } from '../../types';

/**
 * Warm context independently of navigation once the run has a resolved result identity.
 * A short delay gives analysis requests priority; the shared loaders deduplicate tab opens
 * and keep each source's success, absence and failure separate.
 */
export function EvidenceContextPrefetch({ result }: { result: AnalysisResult }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 1200); return () => clearTimeout(t); }, []);
  return armed ? <Warm result={result} /> : null;
}
function Warm({ result }: { result: AnalysisResult }) {
  useEvidenceContext(result, true, true, true);
  return null;
}

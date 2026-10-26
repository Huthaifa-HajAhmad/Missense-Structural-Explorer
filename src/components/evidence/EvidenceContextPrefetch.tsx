import { useEvidenceContext } from '../../hooks/useEvidenceContext';
import type { AnalysisResult } from '../../types';

/** Start context reads as soon as a resolved result exists, independently of the active tab.
 * Shared store slots coalesce requests and preserve each source's actual availability. */
export function EvidenceContextPrefetch({ result }: { result: AnalysisResult }) {
  useEvidenceContext(result, true, true, true);
  return null;
}

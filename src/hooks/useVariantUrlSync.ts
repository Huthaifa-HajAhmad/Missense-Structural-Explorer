import { useEffect } from "react";
import { useVariantAnalysisStore } from "../context/VariantAnalysisContext";
import { shareableQueryFromResult, withVariantParams } from "../shared/shareLink";

/**
 * Keeps the address bar in step with the ACTIVE variant (the analysed gene/variant, not the
 * half-typed form fields), so the URL is always a working share link and a reload re-opens the
 * same analysis. `replaceState`, not `pushState`: a new variant is not a navigation the Back
 * button should have to walk through.
 */
export function useVariantUrlSync(): void {
  const gene = useVariantAnalysisStore(s => s.gene ?? "");
  const variant = useVariantAnalysisStore(s => s.variant ?? "");
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId ?? "");
  const analysisResult = useVariantAnalysisStore(s => s.analysisState.result);

  useEffect(() => {
    // Keep the incoming allele until the reload effect has read it and a result is available.
    if (typeof window === "undefined" || !analysisResult) return;
    try {
      const next = withVariantParams(
        window.location.href,
        shareableQueryFromResult(analysisResult, { gene, variant, uniprotId }),
      );
      if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    } catch {
      // A sandboxed frame can refuse replaceState; the link is a convenience, never load-bearing.
    }
  }, [gene, variant, uniprotId, analysisResult]);
}

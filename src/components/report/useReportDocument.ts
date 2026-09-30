import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { buildReportDocument, type ReportDocument } from "../../shared/reportDocument";
import { reportInputFromRun, type ReportDraft } from "../../shared/reportInput";
import { readReportDraft, reportDraftKey, writeReportDraft } from "../../stores/reportDraftStorage";

/**
 * The Report document for the run on screen, from the same builder the copy-as-text path uses.
 *
 * `stamped()` builds it again with an export time, so a document is dated when it is exported and never
 * when it is merely looked at (the old page printed today's date every time it rendered).
 */
export function useReportDocument(result: AnalysisResult | null): { doc: ReportDocument; stamped: () => ReportDocument } {
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const foldingEnergetics = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics);
  const foldingDdG = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG);
  const foldingStatus = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingStatus ?? s.foldingStatus);
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);

  const build = useCallback(
    (generatedAt: string | null) =>
      buildReportDocument(
        reportInputFromRun({
          result,
          gene,
          variant,
          uniprotId,
          foldingEnergetics: foldingEnergetics as any,
          foldingDdG: foldingDdG as number | null,
          foldingStatus: foldingStatus as string | null,
          isLoading: isBiophysicalLoading,
          draft: { sections, edits, meta, citations },
          generatedAt,
        })
      ),
    [result, gene, variant, uniprotId, foldingEnergetics, foldingDdG, foldingStatus, isBiophysicalLoading, sections, edits, meta, citations]
  );

  const doc = useMemo(() => build(null), [build]);
  const stamped = useCallback(() => build(new Date().toISOString()), [build]);
  return { doc, stamped };
}

/**
 * Loads the author's draft for a variant when it changes, and saves it as it is edited.
 *
 * Mounted once, high in the tree, because pinning a paper happens on the Literature tab while the
 * Report is not on screen.
 */
export function useReportDraftPersistence(gene: string, uniprotId: string, variant: string): void {
  const key = reportDraftKey(gene, uniprotId, variant);
  const loadReportDraft = useVariantAnalysisStore(s => s.loadReportDraft);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);
  const loadedKey = useRef<string | null>(null);

  useEffect(() => {
    loadedKey.current = null;
    loadReportDraft(readReportDraft(key));
    loadedKey.current = key;
  }, [key, loadReportDraft]);

  useEffect(() => {
    if (!key || loadedKey.current !== key) return;
    const draft: ReportDraft = { sections, edits, meta, citations };
    const t = setTimeout(() => writeReportDraft(key, draft), 300);
    return () => clearTimeout(t);
  }, [key, sections, edits, meta, citations]);
}

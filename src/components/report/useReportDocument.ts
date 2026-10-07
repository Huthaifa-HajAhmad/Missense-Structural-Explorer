import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSettings } from "../../context/SettingsContext";
import { useNarrativeEvidenceContext } from "../../hooks/useNarrativeEvidenceContext";
import type { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { buildReportDocument, defaultReportSections, type ReportDocument } from "../../shared/reportDocument";
import { reportInputFromRun, type ReportDraft } from "../../shared/reportInput";
import { readReportDraft, removeReportDraft, reportDraftKeys, writeReportDraft } from "../../stores/reportDraftStorage";

/**
 * The Report document for the run on screen, from the same builder the copy-as-text path uses.
 *
 * `stamped()` builds it again with an export time, so a document is dated when it is exported and never
 * when it is merely looked at (the old page printed today's date every time it rendered).
 */
export function useReportDocument(result: AnalysisResult | null): { doc: ReportDocument; stamped: () => ReportDocument } {
  const { settings } = useSettings();
  const narrativeContext = useNarrativeEvidenceContext(settings?.saprotEngine);
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
          narrativeContext,
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
    [result, narrativeContext, gene, variant, uniprotId, foldingEnergetics, foldingDdG, foldingStatus, isBiophysicalLoading, sections, edits, meta, citations]
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
  const result = useVariantAnalysisStore(s => s.analysisState.result);
  const { key, baseKey, reference, legacyReferenceKey } = reportDraftKeys(gene, uniprotId, variant, result);
  const setStatus = useVariantAnalysisStore(s => s.setReportDraftStatus);
  const loadReportDraft = useVariantAnalysisStore(s => s.loadReportDraft);
  const recovery = useVariantAnalysisStore(s => s.reportDraftRecovery);
  const setRecovery = useVariantAnalysisStore(s => s.setReportDraftRecovery);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);
  const loadedKey = useRef<string | null>(null);
  const loadedReference = useRef<{ baseKey: string | null; values: (string | null)[] } | null>(null);
  const retiredSource = useRef<string | null>(null);
  const migrationSource = useRef<string | null>(null);

  useEffect(() => {
    const state = useVariantAnalysisStore.getState();
    const current: ReportDraft = { sections: state.reportSections, edits: state.reportEdits, meta: state.reportMeta, citations: state.reportCitations };
    const defaults = defaultReportSections();
    const hasWork = (draft: ReportDraft) => Object.keys(draft.edits).length > 0 || draft.citations.length > 0 ||
      Object.values(draft.meta).some(Boolean) || Object.entries(draft.sections).some(([k, v]) => v !== defaults[k as keyof typeof defaults]);
    const previous = loadedReference.current;
    const carriesPending = key !== loadedKey.current && previous?.baseKey === baseKey &&
      previous.values.every((value, i) => value === null || value === reference[i]) && hasWork(current);
    const saved = readReportDraft(key);
    const pendingKey = key ? `${key}|pending` : null;
    const sourceKey = carriesPending ? loadedKey.current : [pendingKey, legacyReferenceKey, key !== baseKey ? baseKey : null]
      .find(candidate => candidate && readReportDraft(candidate)) ?? null;
    const pending = carriesPending ? current : readReportDraft(sourceKey);
    loadedKey.current = null;
    retiredSource.current = null;
    migrationSource.current = null;
    setRecovery(null);
    if (key && sourceKey && pending && hasWork(pending) && saved && JSON.stringify(pending) !== JSON.stringify(saved)) {
      // Bind the pending copy too, so an unresolved conflict cannot leak to another transcript.
      loadReportDraft(pending);
      if (pendingKey && sourceKey !== pendingKey) {
        if (writeReportDraft(pendingKey, pending)) removeReportDraft(sourceKey);
        else migrationSource.current = sourceKey;
      }
      setRecovery({ identity: key, sourceKey: pendingKey!, saved });
      retiredSource.current = pendingKey;
    } else {
      const draft = saved ?? pending;
      loadReportDraft(draft);
      if (key && sourceKey && draft) {
        if (writeReportDraft(key, draft)) removeReportDraft(sourceKey);
        else retiredSource.current = sourceKey;
      }
    }
    loadedKey.current = key;
    loadedReference.current = { baseKey, values: reference };
  }, [key, baseKey, legacyReferenceKey, loadReportDraft, setRecovery]);

  useEffect(() => {
    if (!key || loadedKey.current !== key || useVariantAnalysisStore.getState().reportSections !== sections) return;
    const draft: ReportDraft = { sections, edits, meta, citations };
    const writeKey = recovery?.identity === key ? recovery.sourceKey : key;
    const retire = recovery?.identity === key ? null : retiredSource.current;
    const migrate = migrationSource.current;
    setStatus("saving");
    const write = () => {
      const saved = writeReportDraft(writeKey, draft);
      if (saved && migrate) { removeReportDraft(migrate); migrationSource.current = null; }
      if (saved && retire) { removeReportDraft(retire); retiredSource.current = null; }
      return saved;
    };
    const persist = () => setStatus(write() ? "saved" : "session-only");
    const t = setTimeout(persist, 300);
    return () => { clearTimeout(t); write(); };
  }, [key, sections, edits, meta, citations, recovery, setStatus]);
}

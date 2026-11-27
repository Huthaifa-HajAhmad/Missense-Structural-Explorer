import { expertPm1Specified, expertPm1StatusOf, type HotspotContext } from "../../shared/hotspotEvidence";
import { hotspotsSlot } from "../../shared/evidenceKeys";
import type { ContextLoad } from "../../stores/slices/evidenceContextSlice";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectNarrativeEvidence } from "../../hooks/useNarrativeEvidenceContext";
import { useFoldxRunState } from "../../hooks/useFoldxRunState";
import type { AnalysisResult } from "../../types";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { deepEvidenceContextFromStore } from "../../shared/deepModelEvidence";
import { buildReportDocument, defaultReportSections, type ReportBuild } from "../../shared/reportDocument";
import { useSettings } from "../../context/SettingsContext";
import { reportInputFromRun, type ReportDraft } from "../../shared/reportInput";
import { readReportDraft, removeReportDraft, reportDraftKeys, writeReportDraft } from "../../stores/reportDraftStorage";

/*
 * The screen and its rail both render the document. The last build is kept here, keyed by every value
 * it reads, so the second caller in a render reuses the first caller's document instead of building
 * the whole evidence model again (a build reads Insights, the predictors and the stability engines).
 * It keeps one entry, which is enough for one screen. Two different documents on screen at once would
 * evict each other and each rebuild, which is slower but never wrong.
 */
let lastBuild: { key: readonly unknown[]; doc: ReportBuild } | null = null;
const sameKey = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * The Report document for the run on screen, from the same builder the copy-as-text path uses.
 *
 * `stamped()` builds it again with an export time, so a document is dated when it is exported and never
 * when it is merely looked at (the old page printed today's date every time it rendered).
 */
export function useReportDocument(result: AnalysisResult | null): { doc: ReportBuild; stamped: () => ReportBuild } {
  const { settings } = useSettings();
  const energyUnit = settings.energyUnit === "kJ/mol" ? "kJ/mol" : "kcal/mol";
  const evidence = useVariantAnalysisStore(useShallow(selectNarrativeEvidence));
  const gene = useVariantAnalysisStore(s => s.gene);
  const variant = useVariantAnalysisStore(s => s.variant);
  const uniprotId = useVariantAnalysisStore(s => s.uniprotId);
  const foldingEnergetics = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingEnergetics ?? s.foldingEnergetics);
  const foldingDdG = useVariantAnalysisStore(s => s.primaryBiophysics?.foldingDdG ?? s.foldingDdG);
  const { isFolding, foldingStatus } = useFoldxRunState();
  const isBiophysicalLoading = useVariantAnalysisStore(s => s.isBiophysicalLoading);
  const isClinicalLoading = useVariantAnalysisStore(s => s.isClinicalLoading || s.analysisState.isLoading);
  const sections = useVariantAnalysisStore(s => s.reportSections);
  const edits = useVariantAnalysisStore(s => s.reportEdits);
  const meta = useVariantAnalysisStore(s => s.reportMeta);
  const citations = useVariantAnalysisStore(s => s.reportCitations);

  const hotspotLoad = useVariantAnalysisStore(s => s.extraContexts[hotspotsSlot(result?.metadata?.gene || s.gene || null, result?.metadata?.uniprotId, result?.transcriptId)]) as ContextLoad<HotspotContext> | undefined;
  const expertPm1 = Boolean(hotspotLoad?.data && expertPm1Specified(hotspotLoad.data.cspec));
  const expertPm1Status = expertPm1StatusOf(hotspotLoad);
  const key = [expertPm1, expertPm1Status, result, ...Object.values(evidence), gene, variant, uniprotId, foldingEnergetics, foldingDdG, foldingStatus, isFolding, isBiophysicalLoading, isClinicalLoading, sections, edits, meta, citations, energyUnit];
  const build = useCallback(
    (generatedAt: string | null) =>
      buildReportDocument({
        ...reportInputFromRun({
          result,
          expertPm1Specified: expertPm1,
          expertPm1Status,
          narrativeContext: deepEvidenceContextFromStore(evidence),
          gene,
          variant,
          uniprotId,
          foldingEnergetics: foldingEnergetics as Record<string, any> | null,
          foldingDdG: foldingDdG as number | null,
          foldingStatus,
          isFolding,
          isLoading: isBiophysicalLoading || isClinicalLoading,
          draft: { sections, edits, meta, citations },
          generatedAt,
        }),
        energyUnit,
      }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` lists every value `build` reads.
    key
  );

  const doc = useMemo(() => {
    if (lastBuild && sameKey(lastBuild.key, key)) return lastBuild.doc;
    const built = build(null);
    lastBuild = { key, doc: built };
    return built;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `key` lists every value `build` reads.
  }, key);
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

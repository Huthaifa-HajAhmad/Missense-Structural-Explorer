import { StateCreator } from "zustand";
import { VariantPreset, SearchHistoryItem } from "../../types";
import { getCachedVariant } from "../../services/pipeline/variantCache";
import { normalizeUniprotAccession } from "../../shared/uniprotAccession";
// The one report builder. Pure — it imports only `src/shared` — so a store slice may call it, and
// both "Copy Report" buttons emit the same document because of it.
import { buildReportDocument } from "../../shared/reportDocument";
import { deepEvidenceContextFromStore } from "../../shared/deepModelEvidence";
import { reportInputFromRun } from "../../shared/reportInput";
import { renderReportText } from "../../shared/reportRender";
import type { VariantAnalysisStore } from "../useVariantAnalysisStore";
import type { LandscapeOverview, LandscapeResidueItem } from "../../shared/contracts";

export interface LandscapeViewState {
  colorBy: "alphaMissense" | "revel";
  lanes: { clinvar: boolean; gnomad: boolean; regions: boolean };
}

/** The Landscape rail's pill tabs; the choice outlives a re-render within the session. */
export type LandscapeRailTab = "summary" | "substitutions" | "agreement" | "sources";

/** Keyed by `gene|variant`; a selection from a previous query is ignored by comparing the key. */
export interface LandscapeSelection {
  key: string;
  kind: "residue" | "substitution" | "nucleotide";
  pos: number;
  /** Alternative amino acid, for a substitution. */
  alt?: string;
}

export interface SearchState {
  gene: string;
  variant: string;
  uniprotId: string;
  /**
   * Full UniProt sequence for the queried protein, published by the sequence hook after fetch so
   * residue-level views (inspector telemetry) can resolve amino-acid identity by index.
   *
   * Keyed by the accession it was fetched for: an unkeyed string survives an accession change on
   * the paths that set `uniprotId` directly, and the consumer would read letters off the previous
   * protein. Consumers must compare `accession` before use.
   */
  proteinSequence: { accession: string; sequence: string } | null;
  selectedResidueIndex: number | null;
  hoveredResidueIndex: number | null;
  selectedGenomicVariant: any | null;
  /**
   * Landscape rows loaded for windows the reader navigated to (beyond the pipeline's ±25). Keyed
   * by `gene|variant`, like `proteinSequence` is keyed by accession: consumers compare the key
   * before use, so rows from a previous query are never read.
   */
  landscapeExtra: { key: string; rows: LandscapeResidueItem[] } | null;
  /** Landscape display choices shared by the tab and its inspector rail. */
  landscapeView: LandscapeViewState;
  /** Which rail pill tab is open; persisted for the session (not per query). */
  landscapeRailTab: LandscapeRailTab;
  /** What the reader picked on the Landscape tab; keyed like `landscapeExtra`. */
  landscapeSelection: LandscapeSelection | null;
  /** Whole-protein summaries and gene context, keyed like `landscapeExtra`. */
  landscapeOverview: { key: string; status: "loading" | "ready" | "error"; data: LandscapeOverview | null; error: string | null } | null;
  searchVal: string;
  customGene: string;
  customVariant: string;
  customUniprot: string;
  customGenomic: string;
  customPdbUrl: string | null;
  showCustomInputs: boolean;
  userDirections: string;
  /**
   * Set when the reader answers the ambiguity prompt with "these numbers are canonical".
   *
   * Cleared by any edit to Gene/Variant/UniProt: a decision is about ONE notation, and a stale one
   * would silently suppress the refusal for a different query.
   */
  numberingBasis: "canonical" | null;
  copied: boolean;
  history: SearchHistoryItem[];
  /**
   * Incremented to ask the shell to re-run the current variant. The pipeline lives in the
   * `useVariantAnalysis` hook App owns, so a surface deep in the tree (the Population card, the
   * header's run-state slot) requests the re-run here and App performs it.
   */
  rerunNonce: number;
}

export interface SearchActions {
  setGene: (gene: string) => void;
  setVariant: (variant: string) => void;
  setUniprotId: (uniprotId: string) => void;
  setProteinSequence: (accession: string, sequence: string) => void;
  setSelectedResidueIndex: (index: number | null) => void;
  setHoveredResidueIndex: (index: number | null) => void;
  setSelectedGenomicVariant: (variant: any | null) => void;
  addLandscapeRows: (key: string, rows: LandscapeResidueItem[]) => void;
  setLandscapeView: (patch: Partial<LandscapeViewState>) => void;
  setLandscapeRailTab: (tab: LandscapeRailTab) => void;
  setLandscapeSelection: (selection: LandscapeSelection | null) => void;
  setLandscapeOverview: (value: SearchState["landscapeOverview"]) => void;
  setSearchVal: (val: string) => void;
  setCustomGene: (gene: string) => void;
  setCustomVariant: (variant: string) => void;
  setCustomUniprot: (uniprot: string) => void;
  setCustomGenomic: (genomic: string) => void;
  setCustomPdbUrl: (url: string | null) => void;
  setShowCustomInputs: (show: boolean | ((prev: boolean) => boolean)) => void;
  setUserDirections: (directions: string) => void;
  setNumberingBasis: (basis: "canonical" | null) => void;
  setCopied: (copied: boolean) => void;
  setHistory: (history: SearchHistoryItem[] | ((prev: SearchHistoryItem[]) => SearchHistoryItem[])) => void;
  addToHistory: (item: SearchHistoryItem, maxItems?: number, saveHistory?: boolean) => void;
  /** Ask the shell to re-run the variant on screen (see `rerunNonce`). */
  requestRerun: () => void;
  clearHistory: () => void;
  handleSelectHistoryItem: (
    item: SearchHistoryItem,
    options?: {
      abortAllPendingRequests?: () => void;
      resetViewerState?: () => void;
      executeAnalysis?: (g: string, v: string, u?: string, signal?: AbortSignal) => void;
      setAnalysisState?: (updater: any) => void;
    }
  ) => void;
  handleSelectPreset: (
    preset: VariantPreset,
    options?: {
      abortAllPendingRequests?: () => void;
      resetViewerState?: () => void;
      executeAnalysis?: (g: string, v: string, u?: string, signal?: AbortSignal) => void;
      setAnalysisState?: (updater: any) => void;
    }
  ) => void;
  handleSearchSubmit: (
    e: React.FormEvent,
    executeFn: (g: string, v: string, u?: string) => void
  ) => void;
  handleCopyReport: (result: any) => Promise<void>;
}

export type SearchSlice = SearchState & SearchActions;

const getInitialUrlParams = () => {
  if (typeof window === "undefined") return { gene: "", variant: "", uniprotId: "" };
  try {
    const p = new URLSearchParams(window.location.search);
    return {
      gene: p.get("gene") || "",
      variant: p.get("variant") || "",
      uniprotId: p.get("uniprot") || p.get("uniprotId") || ""
    };
  } catch {
    return { gene: "", variant: "", uniprotId: "" };
  }
};

const initial = getInitialUrlParams();
const initialResidueIndex = (() => {
  const m = initial.variant.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
})();

const loadInitialHistory = (): SearchHistoryItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("variant_search_history");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

export const createSearchSlice: StateCreator<
  VariantAnalysisStore,
  [],
  [],
  SearchSlice
> = (set, get) => ({
  gene: initial.gene,
  variant: initial.variant,
  uniprotId: initial.uniprotId,
  proteinSequence: null,
  selectedResidueIndex: initialResidueIndex,
  hoveredResidueIndex: null,
  selectedGenomicVariant: null,
  landscapeExtra: null,
  landscapeView: { colorBy: "alphaMissense", lanes: { clinvar: true, gnomad: true, regions: true } },
  landscapeRailTab: "summary",
  landscapeSelection: null,
  landscapeOverview: null,
  searchVal: initial.gene && initial.variant ? `${initial.gene} ${initial.variant}` : "",
  customGene: initial.gene,
  customVariant: initial.variant,
  customUniprot: initial.uniprotId,
  customGenomic: "",
  customPdbUrl: null,
  showCustomInputs: false,
  userDirections: "",
  numberingBasis: null,
  copied: false,
  history: loadInitialHistory(),
  rerunNonce: 0,

  setGene: (gene) => set({ gene }),
  setVariant: (variant) => set((state: any) => ({
    variant,
    ...(state.primaryBiophysics ? { primaryBiophysics: { ...state.primaryBiophysics, variant } } : {})
  })),
  setUniprotId: (uniprotId) => set({ uniprotId, proteinSequence: null }),
  setProteinSequence: (accession, sequence) =>
    set({ proteinSequence: accession ? { accession, sequence } : null }),
  setSelectedResidueIndex: (selectedResidueIndex) => set({ selectedResidueIndex }),
  setHoveredResidueIndex: (hoveredResidueIndex) => set({ hoveredResidueIndex }),
  setSelectedGenomicVariant: (selectedGenomicVariant) => set({ selectedGenomicVariant }),
  addLandscapeRows: (key, rows) =>
    set((state: any) => ({
      landscapeExtra: {
        key,
        rows: [...(state.landscapeExtra?.key === key ? state.landscapeExtra.rows : []), ...rows]
      }
    })),
  setLandscapeView: (patch) =>
    set((state: any) => ({ landscapeView: { ...state.landscapeView, ...patch, lanes: { ...state.landscapeView.lanes, ...(patch.lanes ?? {}) } } })),
  setLandscapeRailTab: (landscapeRailTab) => set({ landscapeRailTab }),
  setLandscapeSelection: (landscapeSelection) => set({ landscapeSelection }),
  setLandscapeOverview: (landscapeOverview) => set({ landscapeOverview }),
  setSearchVal: (searchVal) => set({ searchVal }),
  setCustomGene: (customGene) => set({ customGene, numberingBasis: null }),
  setCustomVariant: (customVariant) => set({ customVariant, numberingBasis: null }),
  setCustomUniprot: (customUniprot) => set({ customUniprot, numberingBasis: null }),
  setCustomGenomic: (customGenomic) => set({ customGenomic }),
  setCustomPdbUrl: (customPdbUrl) => set({ customPdbUrl }),
  setShowCustomInputs: (show) => set((state) => ({
    showCustomInputs: typeof show === "function" ? show(state.showCustomInputs) : show
  })),
  setUserDirections: (userDirections) => set({ userDirections }),
  setNumberingBasis: (numberingBasis) => set({ numberingBasis }),
  setCopied: (copied) => set({ copied }),

  setHistory: (historyUpdater) => set((state) => {
    const newHistory = typeof historyUpdater === "function" ? historyUpdater(state.history) : historyUpdater;
    try {
      localStorage.setItem("variant_search_history", JSON.stringify(newHistory));
    } catch (_) {}
    return { history: newHistory };
  }),

  addToHistory: (item, maxItems = 10, saveHistory = true) => {
    if (!saveHistory || !item.gene || !item.variant) return;
    set((state) => {
      const filtered = state.history.filter(
        (h) => !(h.gene === item.gene && h.variant === item.variant)
      );
      const updated = [item, ...filtered].slice(0, maxItems);
      try {
        localStorage.setItem("variant_search_history", JSON.stringify(updated));
      } catch (_) {}
      return { history: updated };
    });
  },

  requestRerun: () => set((state) => ({ rerunNonce: state.rerunNonce + 1 })),

  clearHistory: () => {
    try {
      localStorage.removeItem("variant_search_history");
    } catch (_) {}
    set({ history: [] });
  },

  handleSelectHistoryItem: (item, options) => {
    options?.abortAllPendingRequests?.();

    const mutMatch = item.variant.match(/\d+/);
    const resIdx = mutMatch ? parseInt(mutMatch[0], 10) : null;

    // Atomically reset biophysical, structural folding, and pipeline analysis state
    // before applying new variant parameters, preventing invalid hybrid states.
    if (options?.resetViewerState) {
      options.resetViewerState();
    }
    get().resetVariantAnalysisState();

    set({
      gene: item.gene,
      variant: item.variant,
      uniprotId: item.uniprotId,
      searchVal: `${item.gene} ${item.variant}`,
      customGene: item.gene,
      customVariant: item.variant,
      selectedResidueIndex: resIdx,
      selectedGenomicVariant: null,
      hoveredResidueIndex: null
    });

    if (options?.executeAnalysis) {
      // Replay the submission as it was made (see `SearchHistoryItem.query`).
      options.executeAnalysis(item.gene, item.query ?? item.variant, item.uniprotId);
    }
  },

  handleSelectPreset: (preset, options) => {
    options?.abortAllPendingRequests?.();

    const mutMatch = preset.variant.match(/\d+/);
    const resIdx = mutMatch ? parseInt(mutMatch[0], 10) : null;

    // Atomically reset biophysical, structural folding, and pipeline analysis state
    // before applying new variant parameters, preventing invalid hybrid states.
    if (options?.resetViewerState) {
      options.resetViewerState();
    }
    get().resetVariantAnalysisState();

    set({
      gene: preset.gene,
      variant: preset.variant,
      uniprotId: preset.uniprotId,
      searchVal: `${preset.gene} ${preset.variant}`,
      customGene: preset.gene,
      customVariant: preset.variant,
      selectedResidueIndex: resIdx,
      selectedGenomicVariant: null,
      hoveredResidueIndex: null
    });

    if (options?.executeAnalysis) {
      options.executeAnalysis(preset.gene, preset.variant, preset.uniprotId);
    }
  },

  handleSearchSubmit: (e, executeFn) => {
    e.preventDefault();
    const state = get();
    const targetGene = state.customGene.trim();
    const targetVariant = state.customGenomic.trim() ? state.customGenomic.trim() : state.customVariant.trim();
    const targetUniprot = state.customUniprot.trim();
    executeFn(targetGene, targetVariant, targetUniprot);
  },

  handleCopyReport: async (result) => {
    if (!result) return;

    /*
     * The same document the Report screen and its rail build, rendered as text.
     *
     * This handler once assembled its own three-line text, and later a second copy of the Report's
     * assembly, so two "Copy report" buttons emitted different documents for one run (one began with a
     * ClinVar status where a classification belongs). It now calls the one builder with the author's
     * draft from the store, so a block left out or edited in the Report is left out or edited here too.
     */
    const state = get();
    const doc = buildReportDocument(
      reportInputFromRun({
        result,
        narrativeContext: deepEvidenceContextFromStore(state),
        gene: state.gene || result?.metadata?.gene || "",
        variant: state.variant || result?.metadata?.variant || "",
        uniprotId: state.uniprotId || result?.metadata?.uniprotId || "",
        foldingEnergetics: (state.primaryBiophysics?.foldingEnergetics ?? state.foldingEnergetics ?? null) as any,
        foldingDdG: (state.primaryBiophysics?.foldingDdG ?? state.foldingDdG ?? null) as number | null,
        foldingStatus: (state.primaryBiophysics?.foldingStatus ?? state.foldingStatus ?? null) as string | null,
        isLoading: state.isBiophysicalLoading,
        draft: { sections: state.reportSections, edits: state.reportEdits, meta: state.reportMeta, citations: state.reportCitations },
        generatedAt: new Date().toISOString(),
      })
    );
    const reportText = renderReportText(doc);

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      console.warn("[Copy Report] Clipboard API unavailable in this environment.");
      return;
    }

    try {
      await navigator.clipboard.writeText(reportText);
      set({ copied: true });
      setTimeout(() => set({ copied: false }), 2000);
    } catch (err) {
      console.error("[Copy Report Error] Clipboard write failed:", err);
    }
  }
});

/**
 * Amino acid at a 1-based residue index, or "" when it cannot be resolved.
 *
 * Returns "" rather than a placeholder whenever the published sequence was fetched for a
 * different accession, so a viewer mid-switch reports "unknown" instead of another protein's
 * residue identity.
 */
export function selectResidueLetter(
  state: Pick<SearchState, "uniprotId" | "proteinSequence">,
  residueIndex: number | null | undefined
): string {
  const entry = state.proteinSequence;
  if (!entry || residueIndex === null || residueIndex === undefined) return "";
  if (entry.accession !== normalizeUniprotAccession(state.uniprotId)) return "";
  return entry.sequence.charAt(residueIndex - 1);
}

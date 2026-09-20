import { StateCreator } from "zustand";
import { VariantPreset, SearchHistoryItem } from "../../types";
import { getCachedVariant } from "../../services/pipeline/variantCache";
import type { VariantAnalysisStore } from "../useVariantAnalysisStore";

export interface SearchState {
  gene: string;
  variant: string;
  uniprotId: string;
  selectedResidueIndex: number | null;
  hoveredResidueIndex: number | null;
  selectedGenomicVariant: any | null;
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
}

export interface SearchActions {
  setGene: (gene: string) => void;
  setVariant: (variant: string) => void;
  setUniprotId: (uniprotId: string) => void;
  setSelectedResidueIndex: (index: number | null) => void;
  setHoveredResidueIndex: (index: number | null) => void;
  setSelectedGenomicVariant: (variant: any | null) => void;
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
  addToHistory: (item: { gene: string; variant: string; uniprotId: string }, maxItems?: number, saveHistory?: boolean) => void;
  clearHistory: () => void;
  handleSelectHistoryItem: (
    item: { gene: string; variant: string; uniprotId: string },
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
  selectedResidueIndex: initialResidueIndex,
  hoveredResidueIndex: null,
  selectedGenomicVariant: null,
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

  setGene: (gene) => set({ gene }),
  setVariant: (variant) => set((state: any) => ({
    variant,
    ...(state.primaryBiophysics ? { primaryBiophysics: { ...state.primaryBiophysics, variant } } : {})
  })),
  setUniprotId: (uniprotId) => set({ uniprotId }),
  setSelectedResidueIndex: (selectedResidueIndex) => set({ selectedResidueIndex }),
  setHoveredResidueIndex: (hoveredResidueIndex) => set({ hoveredResidueIndex }),
  setSelectedGenomicVariant: (selectedGenomicVariant) => set({ selectedGenomicVariant }),
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
      options.executeAnalysis(item.gene, item.variant, item.uniprotId);
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
    const classification = result?.clinvar?.classification ?? result?.ruleBasedInsights?.acmgVerdict ?? "";
    const narrative = result?.analysis ?? "";
    const acmgCriteria = (result?.insights?.acmgCriteria ?? result?.ruleBasedInsights?.acmgCriteria ?? []).map((c: any) => c.code);

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      console.warn("[Copy Report] Clipboard API unavailable in this environment.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `${classification}\n\n${narrative}\n\nACMG Evidence: ${acmgCriteria.join(", ")}`
      );
      set({ copied: true });
      setTimeout(() => set({ copied: false }), 2000);
    } catch (err) {
      console.error("[Copy Report Error] Clipboard write failed:", err);
    }
  }
});

import { StateCreator } from "zustand";
import { VariantPreset, SearchHistoryItem } from "../../types";
import { getCachedVariant } from "../../services/pipeline/variantCache";

export interface SearchState {
  gene: string;
  variant: string;
  uniprotId: string;
  selectedResidueIndex: number | null;
  hoveredResidueIndex: number | null;
  searchVal: string;
  customGene: string;
  customVariant: string;
  customUniprot: string;
  customGenomic: string;
  customPdbUrl: string | null;
  showCustomInputs: boolean;
  userDirections: string;
  copied: boolean;
  history: SearchHistoryItem[];
}

export interface SearchActions {
  setGene: (gene: string) => void;
  setVariant: (variant: string) => void;
  setUniprotId: (uniprotId: string) => void;
  setSelectedResidueIndex: (index: number | null) => void;
  setHoveredResidueIndex: (index: number | null) => void;
  setSearchVal: (val: string) => void;
  setCustomGene: (gene: string) => void;
  setCustomVariant: (variant: string) => void;
  setCustomUniprot: (uniprot: string) => void;
  setCustomGenomic: (genomic: string) => void;
  setCustomPdbUrl: (url: string | null) => void;
  setShowCustomInputs: (show: boolean | ((prev: boolean) => boolean)) => void;
  setUserDirections: (directions: string) => void;
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

export const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (set, get) => ({
  gene: initial.gene,
  variant: initial.variant,
  uniprotId: initial.uniprotId,
  selectedResidueIndex: initialResidueIndex,
  hoveredResidueIndex: null,
  searchVal: initial.gene && initial.variant ? `${initial.gene} ${initial.variant}` : "",
  customGene: initial.gene,
  customVariant: initial.variant,
  customUniprot: initial.uniprotId,
  customGenomic: "",
  customPdbUrl: null,
  showCustomInputs: false,
  userDirections: "",
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
  setSearchVal: (searchVal) => set({ searchVal }),
  setCustomGene: (customGene) => set({ customGene }),
  setCustomVariant: (customVariant) => set({ customVariant }),
  setCustomUniprot: (customUniprot) => set({ customUniprot }),
  setCustomGenomic: (customGenomic) => set({ customGenomic }),
  setCustomPdbUrl: (customPdbUrl) => set({ customPdbUrl }),
  setShowCustomInputs: (show) => set((state) => ({
    showCustomInputs: typeof show === "function" ? show(state.showCustomInputs) : show
  })),
  setUserDirections: (userDirections) => set({ userDirections }),
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

    set({
      gene: item.gene,
      variant: item.variant,
      uniprotId: item.uniprotId,
      searchVal: `${item.gene} ${item.variant}`,
      customGene: item.gene,
      customVariant: item.variant,
      selectedResidueIndex: resIdx
    });

    const cached = getCachedVariant(item.gene, item.variant);
    if (!cached) {
      if (options?.resetViewerState) {
        options.resetViewerState();
      } else if (typeof (get() as any).resetViewerState === "function") {
        (get() as any).resetViewerState();
      }
    }

    if (options?.executeAnalysis) {
      options.executeAnalysis(item.gene, item.variant, item.uniprotId);
    }
  },

  handleSelectPreset: (preset, options) => {
    options?.abortAllPendingRequests?.();

    const mutMatch = preset.variant.match(/\d+/);
    const resIdx = mutMatch ? parseInt(mutMatch[0], 10) : null;

    set({
      gene: preset.gene,
      variant: preset.variant,
      uniprotId: preset.uniprotId,
      searchVal: `${preset.gene} ${preset.variant}`,
      customGene: preset.gene,
      customVariant: preset.variant,
      selectedResidueIndex: resIdx
    });

    const cached = getCachedVariant(preset.gene, preset.variant);
    if (!cached) {
      if (options?.resetViewerState) {
        options.resetViewerState();
      } else if (typeof (get() as any).resetViewerState === "function") {
        (get() as any).resetViewerState();
      }
    }

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

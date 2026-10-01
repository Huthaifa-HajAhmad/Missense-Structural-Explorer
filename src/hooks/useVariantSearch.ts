import { useState, useEffect } from "react";
import { VariantPreset } from "../types";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../data";
import { getCachedVariant } from "../services/pipeline/variantCache";

export interface UseVariantSearchOptions {
  abortAllPendingRequests: () => void;
  resetViewerState: () => void;
  executeAnalysis: (gene: string, variant: string, uniprotId: string, signal?: AbortSignal) => void;
  setAnalysisState: React.Dispatch<React.SetStateAction<any>>;
}

export function useVariantSearch() {
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
  const [gene, setGene] = useState(initial.gene);
  const [variant, setVariant] = useState(initial.variant);
  const [uniprotId, setUniprotId] = useState(initial.uniprotId);
  const [selectedResidueIndex, setSelectedResidueIndex] = useState<number | null>(() => {
    const m = initial.variant.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  });
  const [hoveredResidueIndex, setHoveredResidueIndex] = useState<number | null>(null);

  const [searchVal, setSearchVal] = useState(initial.gene && initial.variant ? `${initial.gene} ${initial.variant}` : "");
  const [customGene, setCustomGene] = useState(initial.gene);
  const [customVariant, setCustomVariant] = useState(initial.variant);
  const [customUniprot, setCustomUniprot] = useState(initial.uniprotId);
  const [customGenomic, setCustomGenomic] = useState("");
  const [showCustomInputs, setShowCustomInputs] = useState(false);

  const [copied, setCopied] = useState(false);
  const [customPdbUrl, setCustomPdbUrl] = useState<string | null>(null);
  const [userDirections, setUserDirections] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (gene) url.searchParams.set("gene", gene);
      else url.searchParams.delete("gene");

      if (variant) url.searchParams.set("variant", variant);
      else url.searchParams.delete("variant");

      if (uniprotId) url.searchParams.set("uniprot", uniprotId);
      else url.searchParams.delete("uniprot");

      const newUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
      window.history.replaceState(null, "", newUrl);
    } catch (e) {
      // Ignore in non-browser environments
    }
  }, [gene, variant, uniprotId]);

  const handleSelectHistoryItem = (
    item: { gene: string; variant: string; uniprotId: string; query?: string },
    options: UseVariantSearchOptions
  ) => {
    options.abortAllPendingRequests();

    setGene(item.gene);
    setVariant(item.variant);
    setUniprotId(item.uniprotId);
    setSearchVal(`${item.gene} ${item.variant}`);
    setCustomGene(item.gene);
    setCustomVariant(item.variant);
    const cached = getCachedVariant(item.gene, item.variant);
    if (!cached) {
      options.resetViewerState();
    }

    const mutMatch = item.variant.match(/\d+/);
    if (mutMatch) {
      setSelectedResidueIndex(parseInt(mutMatch[0], 10));
    } else {
      setSelectedResidueIndex(null);
    }

    // Same replay rule as the store's `handleSelectHistoryItem` (see `SearchHistoryItem.query`).
    options.executeAnalysis(item.gene, item.query ?? item.variant, item.uniprotId);
  };

  const handleSelectPreset = (
    preset: VariantPreset,
    options: UseVariantSearchOptions
  ) => {
    options.abortAllPendingRequests();

    setGene(preset.gene);
    setVariant(preset.variant);
    setUniprotId(preset.uniprotId);
    setSearchVal(`${preset.gene} ${preset.variant}`);
    setCustomGene(preset.gene);
    setCustomVariant(preset.variant);
    setCustomUniprot(preset.uniprotId);
    setCustomPdbUrl(null);

    const cached = getCachedVariant(preset.gene, preset.variant);
    if (!cached) {
      options.resetViewerState();
    }

    // Parse residue index if available
    const mutMatch = preset.variant.match(/\d+/);
    if (mutMatch) {
      setSelectedResidueIndex(parseInt(mutMatch[0], 10));
    } else {
      setSelectedResidueIndex(null);
    }

    if (options.executeAnalysis) {
      options.executeAnalysis(preset.gene, preset.variant, preset.uniprotId);
    }
  };

  return {
    gene, setGene,
    variant, setVariant,
    uniprotId, setUniprotId,
    selectedResidueIndex, setSelectedResidueIndex,
    hoveredResidueIndex, setHoveredResidueIndex,
    searchVal, setSearchVal,
    customGene, setCustomGene,
    customVariant, setCustomVariant,
    customUniprot, setCustomUniprot,
    customGenomic, setCustomGenomic,
    showCustomInputs, setShowCustomInputs,
    copied, setCopied,
    customPdbUrl, setCustomPdbUrl,
    userDirections, setUserDirections,
    handleSelectHistoryItem,
    handleSelectPreset
  };
}

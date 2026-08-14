import { useState } from "react";
import { VariantPreset } from "../types";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../data";

export interface UseVariantSearchOptions {
  abortAllPendingRequests: () => void;
  resetViewerState: () => void;
  executeAnalysis: (gene: string, variant: string, uniprotId: string, signal?: AbortSignal) => void;
  setAnalysisState: React.Dispatch<React.SetStateAction<any>>;
}

export function useVariantSearch() {
  const [gene, setGene] = useState("");
  const [variant, setVariant] = useState("");
  const [uniprotId, setUniprotId] = useState("");
  const [selectedResidueIndex, setSelectedResidueIndex] = useState<number | null>(null);
  const [hoveredResidueIndex, setHoveredResidueIndex] = useState<number | null>(null);

  const [searchVal, setSearchVal] = useState("");
  const [customGene, setCustomGene] = useState("");
  const [customVariant, setCustomVariant] = useState("");
  const [customUniprot, setCustomUniprot] = useState("");
  const [customGenomic, setCustomGenomic] = useState("");
  const [showCustomInputs, setShowCustomInputs] = useState(false);

  const [copied, setCopied] = useState(false);
  const [customPdbUrl, setCustomPdbUrl] = useState<string | null>(null);
  const [userDirections, setUserDirections] = useState("");

  const handleSelectHistoryItem = (
    item: { gene: string; variant: string; uniprotId: string },
    options: UseVariantSearchOptions
  ) => {
    options.abortAllPendingRequests();

    setGene(item.gene);
    setVariant(item.variant);
    setUniprotId(item.uniprotId);
    setSearchVal(`${item.gene} ${item.variant}`);
    setCustomGene(item.gene);
    setCustomVariant(item.variant);
    setCustomUniprot(item.uniprotId);
    setCustomPdbUrl(null);

    // Clear mutant states
    options.resetViewerState();

    const mutMatch = item.variant.match(/\d+/);
    if (mutMatch) {
      setSelectedResidueIndex(parseInt(mutMatch[0], 10));
    } else {
      setSelectedResidueIndex(null);
    }

    options.executeAnalysis(item.gene, item.variant, item.uniprotId);
  };

  const handleSelectPreset = (
    preset: VariantPreset,
    options: Pick<UseVariantSearchOptions, "abortAllPendingRequests" | "resetViewerState" | "setAnalysisState">
  ) => {
    options.abortAllPendingRequests();

    setGene(preset.gene);
    setVariant(preset.variant);
    setUniprotId(preset.uniprotId);
    setSearchVal(`${preset.gene} ${preset.variant}`);
    setCustomPdbUrl(null);

    // Clear mutant states when switching presets
    options.resetViewerState();

    // Parse residue index if available
    const mutMatch = preset.variant.match(/p\.(?:[a-zA-Z]{3}|\w)(\d+)(?:[a-zA-Z]{3}|\w)/);
    if (mutMatch) {
      setSelectedResidueIndex(parseInt(mutMatch[1], 10));
    } else {
      setSelectedResidueIndex(null);
    }

    // Try to pre-populate analysis with prebaked fallback if available
    const key = `${preset.uniprotId}_${preset.variant}`;
    if (FALLBACK_ANALYSES[key]) {
      options.setAnalysisState({
        isLoading: false,
        error: null,
        result: {
          analysis: FALLBACK_ANALYSES[key],
          insights: FALLBACK_INSIGHTS[key] || null,
          isDemoData: true,
          metadata: {
            gene: preset.gene,
            variant: preset.variant,
            uniprotId: preset.uniprotId,
            residueIndex: mutMatch ? parseInt(mutMatch[1], 10) : null,
            wildType: "",
            mutant: "",
            analysisVersion: {
              thresholds: "ACMG v1.0.0-concordance",
              geminiModel: "gemini-3.5-flash",
              foldxVersion: "FoldX 5.0",
              timestamp: new Date().toISOString()
            }
          }
        }
      });
    } else {
      options.setAnalysisState({
        isLoading: false,
        error: null,
        result: null
      });
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

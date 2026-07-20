import { useState, useRef, useCallback } from "react";
import { EnergeticsData, StructuralDiffResult, PocketResult, UserSettings } from "../types";
import { buildEnergeticsQueryString } from "../useVariantAnalysis";
import { computeConsensusVerdict } from "../shared/thresholds";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";

export function useBiophysicalModeling(
  settings: UserSettings,
  addNotification: (type: "success" | "info" | "error", message: string) => void,
  fetchWithAuth: (url: string, init?: RequestInit & { timeout?: number }) => Promise<Response>
) {
  const [mutantPdb, setMutantPdb] = useState<string | null>(null);
  const [foldedResidueIndex, setFoldedResidueIndex] = useState<number | null>(null);
  const [isFolding, setIsFolding] = useState(false);
  const [foldingError, setFoldingError] = useState<string | null>(null);
  const [foldingStatus, setFoldingStatus] = useState<string | null>(null);
  const [foldingDdG, setFoldingDdG] = useState<number | null>(null);
  const [foldingEnergetics, setFoldingEnergetics] = useState<EnergeticsData | null>(null);

  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [compareVariant, setCompareVariant] = useState<string>("");
  const [compareMutantPdb, setCompareMutantPdb] = useState<string | null>(null);
  const [compareFoldedResidueIndex, setCompareFoldedResidueIndex] = useState<number | null>(null);
  const [isFoldingCompare, setIsFoldingCompare] = useState<boolean>(false);
  const [foldingCompareError, setFoldingCompareError] = useState<string | null>(null);
  const [compareFoldingStatus, setCompareFoldingStatus] = useState<string | null>(null);
  const [compareFoldingDdG, setCompareFoldingDdG] = useState<number | null>(null);
  const [compareFoldingEnergetics, setCompareFoldingEnergetics] = useState<EnergeticsData | null>(null);
  const [comparisonLayout, setComparisonLayout] = useState<"superimposed" | "side-by-side">("superimposed");

  const [dynamut2Status, setDynamut2Status] = useState<"pending" | "unavailable" | "done" | null>(null);
  const [compareDynamut2Status, setCompareDynamut2Status] = useState<"pending" | "unavailable" | "done" | null>(null);
  const [ddmutStatus, setDdmutStatus] = useState<"pending" | "unavailable" | "done" | null>(null);
  const [compareDdmutStatus, setCompareDdmutStatus] = useState<"pending" | "unavailable" | "done" | null>(null);
  
  const [dynamut2JobId, setDynamut2JobId] = useState<string | null>(null);
  const [compareDynamut2JobId, setCompareDynamut2JobId] = useState<string | null>(null);
  const [ddmutJobId, setDdmutJobId] = useState<string | null>(null);
  const [compareDdmutJobId, setCompareDdmutJobId] = useState<string | null>(null);

  const [structuralDiff, setStructuralDiff] = useState<StructuralDiffResult | null>(null);
  const [compareStructuralDiff, setCompareStructuralDiff] = useState<StructuralDiffResult | null>(null);

  const [computedPocket, setComputedPocket] = useState<PocketResult | null>(null);
  const [isPocketLoading, setIsPocketLoading] = useState(false);
  const [pocketError, setPocketError] = useState<string | null>(null);

  const dynamutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const dynamutComparePollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const ddmutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const ddmutComparePollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const lastFetchedFoldRef = useRef<string>("");

  const clearDynaMutPoll = useCallback(() => {
    if (dynamutPollIntervalRef.current) {
      clearTimeout(dynamutPollIntervalRef.current as any);
      dynamutPollIntervalRef.current = null;
    }
  }, []);

  const clearDynaMutComparePoll = useCallback(() => {
    if (dynamutComparePollIntervalRef.current) {
      clearTimeout(dynamutComparePollIntervalRef.current as any);
      dynamutComparePollIntervalRef.current = null;
    }
  }, []);

  const clearDdmutPoll = useCallback(() => {
    if (ddmutPollIntervalRef.current) {
      clearTimeout(ddmutPollIntervalRef.current as any);
      ddmutPollIntervalRef.current = null;
    }
  }, []);

  const clearDdmutComparePoll = useCallback(() => {
    if (ddmutComparePollIntervalRef.current) {
      clearTimeout(ddmutComparePollIntervalRef.current as any);
      ddmutComparePollIntervalRef.current = null;
    }
  }, []);

  const fetchPocketInfo = useCallback(async (pdbText: string, activeChain: string, activeResSeq: number, signal?: AbortSignal) => {
    setIsPocketLoading(true);
    setPocketError(null);
    try {
      const pocketRes = await fetchWithAuth("/api/v1/pocket-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdbText, chain: activeChain, resSeq: activeResSeq }),
        signal
      });
      if (!pocketRes.ok) {
        throw new Error(`Failed to fetch pocket details (status: ${pocketRes.status})`);
      }
      const pocketData = await pocketRes.json();
      setComputedPocket(pocketData);
    } catch (err: any) {
      if (signal?.aborted) return;
      console.error("[Pocket Detection Error]:", err);
      setPocketError(err.message || String(err));
    } finally {
      if (!signal?.aborted) {
        setIsPocketLoading(false);
      }
    }
  }, [fetchWithAuth]);

  return {
    mutantPdb,
    setMutantPdb,
    foldedResidueIndex,
    setFoldedResidueIndex,
    isFolding,
    setIsFolding,
    foldingError,
    setFoldingError,
    foldingStatus,
    setFoldingStatus,
    foldingDdG,
    setFoldingDdG,
    foldingEnergetics,
    setFoldingEnergetics,
    compareMode,
    setCompareMode,
    compareVariant,
    setCompareVariant,
    compareMutantPdb,
    setCompareMutantPdb,
    compareFoldedResidueIndex,
    setCompareFoldedResidueIndex,
    isFoldingCompare,
    setIsFoldingCompare,
    foldingCompareError,
    setFoldingCompareError,
    compareFoldingStatus,
    setCompareFoldingStatus,
    compareFoldingDdG,
    setCompareFoldingDdG,
    compareFoldingEnergetics,
    setCompareFoldingEnergetics,
    comparisonLayout,
    setComparisonLayout,
    dynamut2Status,
    setDynamut2Status,
    compareDynamut2Status,
    setCompareDynamut2Status,
    ddmutStatus,
    setDdmutStatus,
    compareDdmutStatus,
    setCompareDdmutStatus,
    dynamut2JobId,
    setDynamut2JobId,
    compareDynamut2JobId,
    setCompareDynamut2JobId,
    ddmutJobId,
    setDdmutJobId,
    compareDdmutJobId,
    setCompareDdmutJobId,
    structuralDiff,
    setStructuralDiff,
    compareStructuralDiff,
    setCompareStructuralDiff,
    computedPocket,
    setComputedPocket,
    isPocketLoading,
    setIsPocketLoading,
    pocketError,
    setPocketError,
    dynamutPollIntervalRef,
    dynamutComparePollIntervalRef,
    ddmutPollIntervalRef,
    ddmutComparePollIntervalRef,
    lastFetchedFoldRef,
    clearDynaMutPoll,
    clearDynaMutComparePoll,
    clearDdmutPoll,
    clearDdmutComparePoll,
    fetchPocketInfo
  };
}

import { useState, useCallback } from "react";
import { StructuralMetrics } from "../types";
import { getErrorMessage } from "../variantAnalysisUtils";

interface EsmFoldCacheEntry {
  wtPdb: string;
  mutPdb: string;
  alignedPdb: string;
  metrics: StructuralMetrics | null;
}

const esmFoldGlobalCache: Record<string, EsmFoldCacheEntry> = {};

export interface UseStructuralFoldingOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void;
  uniprotId?: string;
  analysisState?: any;
}

export interface StructuralFoldingSink {
  setEsmFoldWtPdb?: (pdb: string | null) => void;
  setEsmFoldMutPdb?: (pdb: string | null) => void;
  setEsmFoldAlignedPdb?: (pdb: string | null) => void;
  setEsmFoldMetrics?: (metrics: StructuralMetrics | null) => void;
  setFoldxMetrics?: (metrics: StructuralMetrics | null) => void;
  setIsEsmFolding?: (loading: boolean) => void;
  setEsmFoldingError?: (error: string | null) => void;
  setActive3dModelTab?: (tab: "alphafold2" | "esm3") => void;
  resetEsmFoldState?: () => void;
}

export function useStructuralFolding(sink?: StructuralFoldingSink) {
  const [esmFoldWtPdb, setEsmFoldWtPdb] = useState<string | null>(null);
  const [esmFoldMutPdb, setEsmFoldMutPdb] = useState<string | null>(null);
  const [esmFoldAlignedPdb, setEsmFoldAlignedPdb] = useState<string | null>(null);
  const [esmFoldMetrics, setEsmFoldMetrics] = useState<StructuralMetrics | null>(null);
  const [foldxMetrics, setFoldxMetrics] = useState<StructuralMetrics | null>(null);
  const [isEsmFolding, setIsEsmFolding] = useState<boolean>(false);
  const [esmFoldingError, setEsmFoldingError] = useState<string | null>(null);
  const [active3dModelTab, setActive3dModelTab] = useState<"alphafold2" | "esm3">("alphafold2");

  const resetEsmFoldState = useCallback(() => {
    setEsmFoldWtPdb(null);
    setEsmFoldMutPdb(null);
    setEsmFoldAlignedPdb(null);
    setEsmFoldMetrics(null);
    setFoldxMetrics(null);
    setIsEsmFolding(false);
    setEsmFoldingError(null);
    if (sink?.resetEsmFoldState) {
      sink.resetEsmFoldState();
    } else {
      sink?.setEsmFoldWtPdb?.(null);
      sink?.setEsmFoldMutPdb?.(null);
      sink?.setEsmFoldAlignedPdb?.(null);
      sink?.setEsmFoldMetrics?.(null);
      sink?.setFoldxMetrics?.(null);
      sink?.setIsEsmFolding?.(false);
      sink?.setEsmFoldingError?.(null);
    }
  }, [sink]);

  const fetchEsmFold = useCallback(async (
    apiClient: any,
    addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void,
    uniprotIdArg?: string,
    variantArg?: string,
    wtSeq?: string,
    mutSeq?: string
  ) => {
    if (!uniprotIdArg || !variantArg) {
      addNotification("warn", "ESMFold requires a valid UniProt ID and mutant variant.");
      return;
    }

    const cacheKey = `${uniprotIdArg}_${variantArg}`;

    if (esmFoldGlobalCache[cacheKey]) {
      const cached = esmFoldGlobalCache[cacheKey];
      setEsmFoldWtPdb(cached.wtPdb);
      setEsmFoldMutPdb(cached.mutPdb);
      setEsmFoldAlignedPdb(cached.alignedPdb);
      setEsmFoldMetrics(cached.metrics);
      setIsEsmFolding(false);
      setEsmFoldingError(null);
      sink?.setEsmFoldWtPdb?.(cached.wtPdb);
      sink?.setEsmFoldMutPdb?.(cached.mutPdb);
      sink?.setEsmFoldAlignedPdb?.(cached.alignedPdb);
      sink?.setEsmFoldMetrics?.(cached.metrics);
      sink?.setIsEsmFolding?.(false);
      sink?.setEsmFoldingError?.(null);
      return;
    }

    setIsEsmFolding(true);
    setEsmFoldingError(null);
    sink?.setIsEsmFolding?.(true);
    sink?.setEsmFoldingError?.(null);

    try {
      const foldData = await apiClient.foldSequence({
        uniprotId: uniprotIdArg,
        variant: variantArg,
        wtSeq,
        mutSeq
      });

      if (!foldData.wtPdb || !foldData.mutPdb) {
        if (foldData.pdb) {
          setEsmFoldWtPdb(foldData.pdb);
          setEsmFoldMutPdb(foldData.pdb);
          setEsmFoldAlignedPdb(foldData.pdb);
          setEsmFoldMetrics(null);
          sink?.setEsmFoldWtPdb?.(foldData.pdb);
          sink?.setEsmFoldMutPdb?.(foldData.pdb);
          sink?.setEsmFoldAlignedPdb?.(foldData.pdb);
          sink?.setEsmFoldMetrics?.(null);
          return;
        }
        throw new Error("ESMFold endpoint did not return valid WT and mutant PDB structures.");
      }

      setEsmFoldWtPdb(foldData.wtPdb);
      setEsmFoldMutPdb(foldData.mutPdb);

      const posMatch = variantArg.match(/\d+/);
      const position = posMatch ? parseInt(posMatch[0], 10) : 1;

      const alignData = await apiClient.structuralAlign({
        pdb1: foldData.wtPdb,
        pdb2: foldData.mutPdb,
        targetIndex: position,
        alignmentScope: "local"
      });

      if (alignData.alignedPdb) {
        setEsmFoldAlignedPdb(alignData.alignedPdb);
        setEsmFoldMetrics(alignData.metrics);
        sink?.setEsmFoldWtPdb?.(foldData.wtPdb);
        sink?.setEsmFoldMutPdb?.(foldData.mutPdb);
        sink?.setEsmFoldAlignedPdb?.(alignData.alignedPdb);
        sink?.setEsmFoldMetrics?.(alignData.metrics);
        esmFoldGlobalCache[cacheKey] = {
          wtPdb: foldData.wtPdb,
          mutPdb: foldData.mutPdb,
          alignedPdb: alignData.alignedPdb,
          metrics: alignData.metrics
        };
      } else {
        throw new Error("Alignment service did not return aligned structure.");
      }
    } catch (err: any) {
      const rawMessage = err?.message || "Failed to fold/align protein sequence.";
      const cleanMessage = rawMessage.replace(/^Failed to run ESMFold:\s*/i, "").trim() || rawMessage;
      console.warn("[ESMFold] De novo folding unavailable:", cleanMessage);
      setEsmFoldingError(cleanMessage);
      sink?.setEsmFoldingError?.(cleanMessage);
      // Suppress popup toast notification: status is displayed directly as an in-viewer message
    } finally {
      setIsEsmFolding(false);
      sink?.setIsEsmFolding?.(false);
    }
  }, [sink]);

  return {
    esmFoldWtPdb, setEsmFoldWtPdb,
    esmFoldMutPdb, setEsmFoldMutPdb,
    esmFoldAlignedPdb, setEsmFoldAlignedPdb,
    esmFoldMetrics, setEsmFoldMetrics,
    foldxMetrics, setFoldxMetrics,
    isEsmFolding, setIsEsmFolding,
    esmFoldingError, setEsmFoldingError,
    active3dModelTab, setActive3dModelTab,
    resetEsmFoldState,
    fetchEsmFold
  };
}

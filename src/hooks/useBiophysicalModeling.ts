import { useState, useRef, useCallback, useEffect } from "react";
import { EnergeticsData, StructuralDiffResult, PocketResult, UserSettings } from "../types";
import { buildEnergeticsQueryString } from "../useVariantAnalysis";
import { useDevConsole } from "../context/DevConsoleContext";
import { computeConsensusVerdict } from "../shared/thresholds";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { useJobPoller } from "./useJobPoller";

export function useBiophysicalModeling(
  settings: UserSettings,
  addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void,
  apiClient: any,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>,
  pdbText?: string | null
) {
  const { dispatch, addTraceSpan, state: consoleState } = useDevConsole();
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
  const [thermompnnStatus, setThermompnnStatus] = useState<"pending" | "unavailable" | "done" | "error" | null>(null);
  const [compareThermompnnStatus, setCompareThermompnnStatus] = useState<"pending" | "unavailable" | "done" | "error" | null>(null);
  const [thermompnnError, setThermompnnError] = useState<string | null>(null);
  const [compareThermompnnError, setCompareThermompnnError] = useState<string | null>(null);
  
  const [dynamut2JobId, setDynamut2JobId] = useState<string | null>(null);
  const [compareDynamut2JobId, setCompareDynamut2JobId] = useState<string | null>(null);
  const [ddmutJobId, setDdmutJobId] = useState<string | null>(null);
  const [compareDdmutJobId, setCompareDdmutJobId] = useState<string | null>(null);
  const [thermompnnJobId, setThermompnnJobId] = useState<string | null>(null);
  const [compareThermompnnJobId, setCompareThermompnnJobId] = useState<string | null>(null);

  const [structuralDiff, setStructuralDiff] = useState<StructuralDiffResult | null>(null);
  const [compareStructuralDiff, setCompareStructuralDiff] = useState<StructuralDiffResult | null>(null);

  const [computedPocket, setComputedPocket] = useState<PocketResult | null>(null);
  const [isPocketLoading, setIsPocketLoading] = useState(false);
  const [pocketError, setPocketError] = useState<string | null>(null);

  // Centralized telemetry tracking for biophysics jobs
  const jobTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (dynamut2Status === "pending" && !jobTimersRef.current["dynamut2"]) {
      jobTimersRef.current["dynamut2"] = performance.now();
    }
    if (compareDynamut2Status === "pending" && !jobTimersRef.current["compareDynamut2"]) {
      jobTimersRef.current["compareDynamut2"] = performance.now();
    }
    if (ddmutStatus === "pending" && !jobTimersRef.current["ddmut"]) {
      jobTimersRef.current["ddmut"] = performance.now();
    }
    if (compareDdmutStatus === "pending" && !jobTimersRef.current["compareDdmut"]) {
      jobTimersRef.current["compareDdmut"] = performance.now();
    }
    if (thermompnnStatus === "pending" && !jobTimersRef.current["thermompnn"]) {
      jobTimersRef.current["thermompnn"] = performance.now();
    }
    if (compareThermompnnStatus === "pending" && !jobTimersRef.current["compareThermompnn"]) {
      jobTimersRef.current["compareThermompnn"] = performance.now();
    }
  }, [dynamut2Status, compareDynamut2Status, ddmutStatus, compareDdmutStatus, thermompnnStatus, compareThermompnnStatus]);

  useEffect(() => {
    const checkJobEnd = (name: string, status: string | null) => {
      const start = jobTimersRef.current[name];
      if (start && (status === "done" || status === "unavailable" || status === "error" || status === "failed")) {
        const durationMs = Math.round(performance.now() - start);
        if (consoleState.activeTraceRun) {
          addTraceSpan({
            traceId: consoleState.activeTraceRun.traceId,
            name: `${name.toUpperCase()} Biophysical Job Execution`,
            stage: "biophysics",
            startTime: Date.now() - durationMs,
            offsetMs: Math.max(0, Date.now() - durationMs - consoleState.activeTraceRun.timestamp),
            durationMs,
            status: status === "done" ? "success" : "failed"
          });
        }
        dispatch({
          type: "ADD_TELEMETRY_SPAN",
          span: {
            name: `${name.toUpperCase()} Job Execution`,
            durationMs,
            status: status === "done" ? "success" : "failed"
          }
        });
        delete jobTimersRef.current[name];
      }
    };

    checkJobEnd("dynamut2", dynamut2Status);
    checkJobEnd("compareDynamut2", compareDynamut2Status);
    checkJobEnd("ddmut", ddmutStatus);
    checkJobEnd("compareDdmut", compareDdmutStatus);
    checkJobEnd("thermompnn", thermompnnStatus);
    checkJobEnd("compareThermompnn", compareThermompnnStatus);
  }, [dynamut2Status, compareDynamut2Status, ddmutStatus, compareDdmutStatus, thermompnnStatus, compareThermompnnStatus, addTraceSpan, consoleState.activeTraceRun, dispatch]);

  const dynamutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const dynamutComparePollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const ddmutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const ddmutComparePollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const thermompnnPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const thermompnnComparePollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const lastFetchedFoldRef = useRef<string>("");

  const foldingEnergeticsRef = useRef(foldingEnergetics);
  foldingEnergeticsRef.current = foldingEnergetics;

  const compareFoldingEnergeticsRef = useRef(compareFoldingEnergetics);
  compareFoldingEnergeticsRef.current = compareFoldingEnergetics;

  const notifiedJobsRef = useRef<Set<string>>(new Set());

  const notifyOnce = useCallback((key: string, type: "warn" | "error" | "success" | "info", msg: string) => {
    if (notifiedJobsRef.current.has(key)) return;
    notifiedJobsRef.current.add(key);
    addNotification(type, msg);
  }, [addNotification]);

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

  const clearThermoMpnnPoll = useCallback(() => {
    if (thermompnnPollIntervalRef.current) {
      clearTimeout(thermompnnPollIntervalRef.current as any);
      thermompnnPollIntervalRef.current = null;
    }
  }, []);

  const clearThermoMpnnComparePoll = useCallback(() => {
    if (thermompnnComparePollIntervalRef.current) {
      clearTimeout(thermompnnComparePollIntervalRef.current as any);
      thermompnnComparePollIntervalRef.current = null;
    }
  }, []);

  // 1. DynaMut2 Poller
  useJobPoller({
    jobId: dynamut2JobId,
    status: dynamut2Status,
    endpoint: id => `/api/v1/dynamut2-job/${id}`,
    toolName: "DynaMut2",
    fetchWithAuth,
    buildQueryParams: () => {
      const energetics = foldingEnergeticsRef.current;
      const foldx = energetics?.foldxMean ?? energetics?.foldx ?? "";
      const rasp = energetics?.rasp ?? "";
      const ddmut = energetics?.ddmut ?? "";
      const stabilityoracle = energetics?.stabilityoracle ?? "";
      const foldxRepairFailed = energetics?.foldxRepairFailed ? "true" : "false";
      const q = new URLSearchParams();
      if (foldx !== "") q.set("foldx", foldx.toString());
      if (rasp !== "") q.set("rasp", rasp.toString());
      if (ddmut !== "") q.set("ddmut", ddmut.toString());
      if (stabilityoracle !== "") q.set("stabilityoracle", stabilityoracle.toString());
      q.set("foldxRepairFailed", foldxRepairFailed);
      return q;
    },
    onStatusChange: setDynamut2Status,
    onToolFailed: tool => {
      setFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== tool) : []
        };
      });
    },
    onSuccess: data => {
      setFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        dynamut2: data.prediction,
        consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
        consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
        consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
        consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
      }));
    },
    notifyOnce
  });

  // 2. Comparison DynaMut2 Poller
  useJobPoller({
    jobId: compareDynamut2JobId,
    status: compareDynamut2Status,
    endpoint: id => `/api/v1/dynamut2-job/${id}`,
    toolName: "Comparison DynaMut2",
    fetchWithAuth,
    buildQueryParams: () => {
      const compEnergetics = compareFoldingEnergeticsRef.current;
      const foldx = compEnergetics?.foldxMean ?? compEnergetics?.foldx ?? "";
      const rasp = compEnergetics?.rasp ?? "";
      const ddmut = compEnergetics?.ddmut ?? "";
      const stabilityoracle = compEnergetics?.stabilityoracle ?? "";
      const foldxRepairFailed = compEnergetics?.foldxRepairFailed ? "true" : "false";
      const q = new URLSearchParams();
      if (foldx !== "") q.set("foldx", foldx.toString());
      if (rasp !== "") q.set("rasp", rasp.toString());
      if (ddmut !== "") q.set("ddmut", ddmut.toString());
      if (stabilityoracle !== "") q.set("stabilityoracle", stabilityoracle.toString());
      q.set("foldxRepairFailed", foldxRepairFailed);
      return q;
    },
    onStatusChange: setCompareDynamut2Status,
    onToolFailed: () => {
      setCompareFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
        };
      });
    },
    onSuccess: data => {
      setCompareFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        dynamut2: data.prediction,
        consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
        consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
        consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
        consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
      }));
    },
    notifyOnce
  });

  // 3. DDMut Poller
  useJobPoller({
    jobId: ddmutJobId,
    status: ddmutStatus,
    endpoint: id => `/api/v1/ddmut-job/${id}`,
    toolName: "DDMut",
    fetchWithAuth,
    buildQueryParams: () => {
      const energetics = foldingEnergeticsRef.current;
      const foldx = energetics?.foldxMean ?? energetics?.foldx ?? "";
      const rasp = energetics?.rasp ?? "";
      const dynamut2 = energetics?.dynamut2 ?? "";
      const stabilityoracle = energetics?.stabilityoracle ?? "";
      const foldxRepairFailed = energetics?.foldxRepairFailed ? "true" : "false";
      const q = new URLSearchParams();
      if (foldx !== "") q.set("foldx", foldx.toString());
      if (rasp !== "") q.set("rasp", rasp.toString());
      if (dynamut2 !== "") q.set("dynamut2", dynamut2.toString());
      if (stabilityoracle !== "") q.set("stabilityoracle", stabilityoracle.toString());
      q.set("foldxRepairFailed", foldxRepairFailed);
      return q;
    },
    onStatusChange: setDdmutStatus,
    onToolFailed: tool => {
      setFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== tool) : []
        };
      });
    },
    onSuccess: data => {
      setFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        ddmut: data.prediction,
        consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
        consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
        consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
        consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
      }));
    },
    notifyOnce
  });

  // 4. Comparison DDMut Poller
  useJobPoller({
    jobId: compareDdmutJobId,
    status: compareDdmutStatus,
    endpoint: id => `/api/v1/ddmut-job/${id}`,
    toolName: "Comparison DDMut",
    fetchWithAuth,
    buildQueryParams: () => {
      const compEnergetics = compareFoldingEnergeticsRef.current;
      const foldx = compEnergetics?.foldxMean ?? compEnergetics?.foldx ?? "";
      const rasp = compEnergetics?.rasp ?? "";
      const dynamut2 = compEnergetics?.dynamut2 ?? "";
      const stabilityoracle = compEnergetics?.stabilityoracle ?? "";
      const foldxRepairFailed = compEnergetics?.foldxRepairFailed ? "true" : "false";
      const q = new URLSearchParams();
      if (foldx !== "") q.set("foldx", foldx.toString());
      if (rasp !== "") q.set("rasp", rasp.toString());
      if (dynamut2 !== "") q.set("dynamut2", dynamut2.toString());
      if (stabilityoracle !== "") q.set("stabilityoracle", stabilityoracle.toString());
      q.set("foldxRepairFailed", foldxRepairFailed);
      return q;
    },
    onStatusChange: setCompareDdmutStatus,
    onToolFailed: () => {
      setCompareFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
        };
      });
    },
    onSuccess: data => {
      setCompareFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        ddmut: data.prediction,
        consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
        consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
        consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
        consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
      }));
    },
    notifyOnce
  });

  // 5. ThermoMPNN Poller
  useJobPoller({
    jobId: thermompnnJobId,
    status: thermompnnStatus,
    endpoint: id => `/api/v1/thermompnn-job/${id}`,
    toolName: "ThermoMPNN",
    fetchWithAuth,
    onStatusChange: setThermompnnStatus,
    onError: setThermompnnError,
    onToolFailed: tool => {
      setFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== tool) : []
        };
      });
    },
    onSuccess: data => {
      setFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        thermompnn: data.prediction,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
      }));
    },
    notifyOnce
  });

  // 6. Comparison ThermoMPNN Poller
  useJobPoller({
    jobId: compareThermompnnJobId,
    status: compareThermompnnStatus,
    endpoint: id => `/api/v1/thermompnn-job/${id}`,
    toolName: "Comparison ThermoMPNN",
    fetchWithAuth,
    onStatusChange: setCompareThermompnnStatus,
    onError: setCompareThermompnnError,
    onToolFailed: () => {
      setCompareFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
        };
      });
    },
    onSuccess: data => {
      setCompareFoldingEnergetics((prev: any) => ({
        ...(prev || {}),
        thermompnn: data.prediction,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
      }));
    },
    notifyOnce
  });

  const fetchPocketInfo = useCallback(async (pdbText: string, activeChain: string, activeResSeq: number, signal?: AbortSignal) => {
    setIsPocketLoading(true);
    setPocketError(null);
    try {
      const pocketData = await apiClient.detectPocket({
        pdbText,
        targetIndex: activeResSeq,
        targetChain: activeChain
      }, signal);
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
  }, [apiClient]);

  useEffect(() => {
    if (foldingStatus === "success" && mutantPdb && pdbText && foldedResidueIndex) {
      let isAborted = false;
      const runDiff = async () => {
        try {
          const diffData = await apiClient.getStructuralDiff({
            wtPdb: pdbText,
            mutPdb: mutantPdb,
            pos: foldedResidueIndex,
            chain: "A"
          });
          if (isAborted) return;
          setStructuralDiff(diffData);
        } catch (err) {
          console.error("[Structural Diff Error]:", err);
        }
      };
      runDiff();
      return () => {
        isAborted = true;
      };
    } else {
      setStructuralDiff(null);
    }
  }, [foldingStatus, mutantPdb, pdbText, foldedResidueIndex, apiClient]);

  useEffect(() => {
    if (compareFoldingStatus === "success" && compareMutantPdb && pdbText && compareFoldedResidueIndex) {
      let isAborted = false;
      const runDiff = async () => {
        try {
          const diffData = await apiClient.getStructuralDiff({
            wtPdb: pdbText,
            mutPdb: compareMutantPdb,
            pos: compareFoldedResidueIndex,
            chain: "A"
          });
          if (isAborted) return;
          setCompareStructuralDiff(diffData);
        } catch (err) {
          console.error("[Comparison Structural Diff Error]:", err);
        }
      };
      runDiff();
      return () => {
        isAborted = true;
      };
    } else {
      setCompareStructuralDiff(null);
    }
  }, [compareFoldingStatus, compareMutantPdb, pdbText, compareFoldedResidueIndex, apiClient]);

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
    thermompnnStatus,
    setThermompnnStatus,
    compareThermompnnStatus,
    setCompareThermompnnStatus,
    thermompnnError,
    setThermompnnError,
    compareThermompnnError,
    setCompareThermompnnError,
    dynamut2JobId,
    setDynamut2JobId,
    compareDynamut2JobId,
    setCompareDynamut2JobId,
    ddmutJobId,
    setDdmutJobId,
    compareDdmutJobId,
    setCompareDdmutJobId,
    thermompnnJobId,
    setThermompnnJobId,
    compareThermompnnJobId,
    setCompareThermompnnJobId,
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
    thermompnnPollIntervalRef,
    thermompnnComparePollIntervalRef,
    lastFetchedFoldRef,
    clearDynaMutPoll,
    clearDynaMutComparePoll,
    clearDdmutPoll,
    clearDdmutComparePoll,
    clearThermoMpnnPoll,
    clearThermoMpnnComparePoll,
    fetchPocketInfo
  };
}

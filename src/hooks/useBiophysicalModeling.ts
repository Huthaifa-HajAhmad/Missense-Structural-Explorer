import { useState, useRef, useCallback, useEffect } from "react";
import { EnergeticsData, StructuralDiffResult, PocketResult, UserSettings } from "../types";
import { buildEnergeticsQueryString } from "../useVariantAnalysis";
import { useDevConsole } from "../context/DevConsoleContext";
import { computeStabilityConsensus } from "../shared/thresholds";

/**
 * Merged energetics with the stability consensus recomputed from the merged values.
 *
 * The remote poll routes return only the engine's own prediction, so keeping the previous verdict
 * (`data.consensusVerdict ?? prev.consensusVerdict`) froze it at the moment FoldX committed — before
 * DynaMut2/DDMut arrived — and the stored verdict the export and manifest fall back to disagreed with
 * the screen. It also carried the retired probability fields forward; they are dropped here.
 */
function withStabilityConsensus<T extends Record<string, any>>(merged: T): T {
  const c = computeStabilityConsensus(merged);
  const { consensusProbability: _p, consensusConfMin: _lo, consensusConfMax: _hi, ...rest } = merged as any;
  return {
    ...rest,
    consensusVerdict: c.consensusVerdict,
    consensusEnginesCounted: c.enginesCounted,
    consensusEnginesDestabilizing: c.enginesDestabilizing,
    consensusMedianDdg: c.medianDdg,
  } as T;
}
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";
import { useJobPoller } from "./useJobPoller";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";

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

  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [compareVariant, setCompareVariant] = useState<string>("");
  const [compareMutantPdb, setCompareMutantPdb] = useState<string | null>(null);
  const [compareFoldedResidueIndex, setCompareFoldedResidueIndex] = useState<number | null>(null);
  const [isFoldingCompare, setIsFoldingCompare] = useState<boolean>(false);
  const [foldingCompareError, setFoldingCompareError] = useState<string | null>(null);
  const [compareFoldingStatus, setCompareFoldingStatus] = useState<string | null>(null);
  const [compareFoldingDdG, setCompareFoldingDdG] = useState<number | null>(null);
  const [comparisonLayout, setComparisonLayout] = useState<"superimposed" | "side-by-side">("superimposed");

  // Synchronize biophysical energetics and remote job states directly with global Zustand store
  const foldingEnergetics = useVariantAnalysisStore(s => s.foldingEnergetics);
  const compareFoldingEnergetics = useVariantAnalysisStore(s => s.compareFoldingEnergetics);

  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status) as ("pending" | "unavailable" | "done" | null);
  const compareDynamut2Status = useVariantAnalysisStore(s => s.compareDynamut2Status) as ("pending" | "unavailable" | "done" | null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus) as ("pending" | "unavailable" | "done" | null);
  const compareDdmutStatus = useVariantAnalysisStore(s => s.compareDdmutStatus) as ("pending" | "unavailable" | "done" | null);
  const thermompnnStatus = useVariantAnalysisStore(s => s.thermompnnStatus) as ("pending" | "unavailable" | "done" | "error" | null);
  const compareThermompnnStatus = useVariantAnalysisStore(s => s.compareThermompnnStatus) as ("pending" | "unavailable" | "done" | "error" | null);
  const thermompnnError = useVariantAnalysisStore(s => s.thermompnnError);
  const compareThermompnnError = useVariantAnalysisStore(s => s.compareThermompnnError);

  const dynamut2JobId = useVariantAnalysisStore(s => s.dynamut2JobId);
  const compareDynamut2JobId = useVariantAnalysisStore(s => s.compareDynamut2JobId);
  const ddmutJobId = useVariantAnalysisStore(s => s.ddmutJobId);
  const compareDdmutJobId = useVariantAnalysisStore(s => s.compareDdmutJobId);
  const thermompnnJobId = useVariantAnalysisStore(s => s.thermompnnJobId);
  const compareThermompnnJobId = useVariantAnalysisStore(s => s.compareThermompnnJobId);

  const setFoldingEnergetics = useCallback((val: any) => useVariantAnalysisStore.getState().setFoldingEnergetics(val), []);
  const setCompareFoldingEnergetics = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareFoldingEnergetics(val), []);

  const setDynamut2Status = useCallback((val: any) => useVariantAnalysisStore.getState().setDynamut2Status(val), []);
  const setCompareDynamut2Status = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareDynamut2Status(val), []);
  const setDdmutStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setDdmutStatus(val), []);
  const setCompareDdmutStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareDdmutStatus(val), []);
  const setThermompnnStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnStatus(val), []);
  const setCompareThermompnnStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareThermompnnStatus(val), []);
  const setThermompnnError = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnError(val), []);
  const setCompareThermompnnError = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareThermompnnError(val), []);

  const setDynamut2JobId = useCallback((val: any) => useVariantAnalysisStore.getState().setDynamut2JobId(val), []);
  const setCompareDynamut2JobId = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareDynamut2JobId(val), []);
  const setDdmutJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setDdmutJobId(val), []);
  const setCompareDdmutJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareDdmutJobId(val), []);
  const setThermompnnJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnJobId(val), []);
  const setCompareThermompnnJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setCompareThermompnnJobId(val), []);

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
      if (status === null) {
        delete jobTimersRef.current[name];
        return;
      }
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
    setDynamut2Status(null);
    setDynamut2JobId(null);
    delete jobTimersRef.current["dynamut2"];
  }, [setDynamut2Status, setDynamut2JobId]);

  const clearDynaMutComparePoll = useCallback(() => {
    if (dynamutComparePollIntervalRef.current) {
      clearTimeout(dynamutComparePollIntervalRef.current as any);
      dynamutComparePollIntervalRef.current = null;
    }
    setCompareDynamut2Status(null);
    setCompareDynamut2JobId(null);
    delete jobTimersRef.current["compareDynamut2"];
  }, [setCompareDynamut2Status, setCompareDynamut2JobId]);

  const clearDdmutPoll = useCallback(() => {
    if (ddmutPollIntervalRef.current) {
      clearTimeout(ddmutPollIntervalRef.current as any);
      ddmutPollIntervalRef.current = null;
    }
    setDdmutStatus(null);
    setDdmutJobId(null);
    delete jobTimersRef.current["ddmut"];
  }, [setDdmutStatus, setDdmutJobId]);

  const clearDdmutComparePoll = useCallback(() => {
    if (ddmutComparePollIntervalRef.current) {
      clearTimeout(ddmutComparePollIntervalRef.current as any);
      ddmutComparePollIntervalRef.current = null;
    }
    setCompareDdmutStatus(null);
    setCompareDdmutJobId(null);
    delete jobTimersRef.current["compareDdmut"];
  }, [setCompareDdmutStatus, setCompareDdmutJobId]);

  const clearThermoMpnnPoll = useCallback(() => {
    if (thermompnnPollIntervalRef.current) {
      clearTimeout(thermompnnPollIntervalRef.current as any);
      thermompnnPollIntervalRef.current = null;
    }
    setThermompnnStatus(null);
    setThermompnnJobId(null);
    delete jobTimersRef.current["thermompnn"];
  }, [setThermompnnStatus, setThermompnnJobId]);

  const clearThermoMpnnComparePoll = useCallback(() => {
    if (thermompnnComparePollIntervalRef.current) {
      clearTimeout(thermompnnComparePollIntervalRef.current as any);
      thermompnnComparePollIntervalRef.current = null;
    }
    setCompareThermompnnStatus(null);
    setCompareThermompnnJobId(null);
    delete jobTimersRef.current["compareThermompnn"];
  }, [setCompareThermompnnStatus, setCompareThermompnnJobId]);

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
      setFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        dynamut2: data.prediction,
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
      setCompareFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        dynamut2: data.prediction,
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
      setFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        ddmut: data.prediction,
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
      setCompareFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        ddmut: data.prediction,
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

  const fetchPocketInfo = useCallback(async (pdbText: string, activeChain: string, activeResSeq: number, uniprotId?: string, signal?: AbortSignal) => {
    setIsPocketLoading(true);
    setPocketError(null);
    useVariantAnalysisStore.getState().setIsPocketLoading(true);
    useVariantAnalysisStore.getState().setPocketError(null);
    try {
      const pocketData = await apiClient.detectPocket({
        pdbText: pdbText || undefined,
        uniprotId: uniprotId || undefined,
        pdbRef: uniprotId || undefined,
        targetIndex: activeResSeq,
        targetChain: activeChain
      }, signal);
      setComputedPocket(pocketData);
      useVariantAnalysisStore.getState().setComputedPocket(pocketData);
    } catch (err: any) {
      if (signal?.aborted) return;
      console.error("[Pocket Detection Error]:", err);
      const msg = err.message || String(err);
      setPocketError(msg);
      useVariantAnalysisStore.getState().setPocketError(msg);
    } finally {
      if (!signal?.aborted) {
        setIsPocketLoading(false);
        useVariantAnalysisStore.getState().setIsPocketLoading(false);
      }
    }
  }, [apiClient]);

  useEffect(() => {
    if (foldingStatus === "success" && mutantPdb && pdbText && foldedResidueIndex) {
      let isAborted = false;
      const runDiff = async () => {
        try {
          const [diffData, alignData] = await Promise.all([
            apiClient.getStructuralDiff({
              wtPdb: pdbText,
              mutPdb: mutantPdb,
              pos: foldedResidueIndex,
              chain: "A"
            }),
            apiClient.structuralAlign({
              pdb1: pdbText,
              pdb2: mutantPdb,
              targetIndex: foldedResidueIndex,
              alignmentScope: "global"
            })
          ]);
          if (isAborted) return;
          setStructuralDiff(diffData);
          /**
           * Mirror the diff into the store alongside the other diff-derived state. Without
           * this the store's `structuralDiff` was never written by any producer, so the
           * Perturbation inspector's collision and Cα-displacement rows read a permanently
           * null field while `setFoldxMetrics` on the next lines was already mirrored.
           */
          useVariantAnalysisStore.getState().setStructuralDiff(diffData);
          if (alignData.alignedPdb) {
            setCompareMutantPdb(alignData.alignedPdb);
            useVariantAnalysisStore.getState().setCompareMutantPdb(alignData.alignedPdb);
            useVariantAnalysisStore.getState().setFoldxMetrics(alignData.metrics);
          }
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
      setCompareMutantPdb(null);
      useVariantAnalysisStore.getState().setCompareMutantPdb(null);
      useVariantAnalysisStore.getState().setFoldxMetrics(null);
      useVariantAnalysisStore.getState().setStructuralDiff(null);
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

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
import { getCachedVariant, setCachedVariant } from "../services/pipeline/variantCache";

export function useBiophysicalModeling(
  settings: UserSettings,
  addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void,
  apiClient: any,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
) {
  const { addTraceSpan, state: consoleState } = useDevConsole();
  const [mutantPdb, setMutantPdb] = useState<string | null>(null);
  const [foldedResidueIndex, setFoldedResidueIndex] = useState<number | null>(null);
  const [isFolding, setIsFolding] = useState(false);
  const [foldingError, setFoldingError] = useState<string | null>(null);
  const [foldingStatus, setFoldingStatus] = useState<string | null>(null);
  const [foldingDdG, setFoldingDdG] = useState<number | null>(null);

  // Synchronize biophysical energetics and remote job states directly with global Zustand store
  const foldingEnergetics = useVariantAnalysisStore(s => s.foldingEnergetics);

  const dynamut2Status = useVariantAnalysisStore(s => s.dynamut2Status) as ("pending" | "unavailable" | "done" | null);
  const ddmutStatus = useVariantAnalysisStore(s => s.ddmutStatus) as ("pending" | "unavailable" | "done" | null);
  const thermompnnStatus = useVariantAnalysisStore(s => s.thermompnnStatus) as ("pending" | "unavailable" | "done" | "error" | null);
  const thermompnnError = useVariantAnalysisStore(s => s.thermompnnError);

  const dynamut2JobId = useVariantAnalysisStore(s => s.dynamut2JobId);
  const ddmutJobId = useVariantAnalysisStore(s => s.ddmutJobId);
  const thermompnnJobId = useVariantAnalysisStore(s => s.thermompnnJobId);

  const setFoldingEnergetics = useCallback((val: any) => useVariantAnalysisStore.getState().setFoldingEnergetics(val), []);

  const setDynamut2Status = useCallback((val: any) => useVariantAnalysisStore.getState().setDynamut2Status(val), []);
  const setDdmutStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setDdmutStatus(val), []);
  const setThermompnnStatus = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnStatus(val), []);
  const setThermompnnError = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnError(val), []);

  const setDynamut2JobId = useCallback((val: any) => useVariantAnalysisStore.getState().setDynamut2JobId(val), []);
  const setDdmutJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setDdmutJobId(val), []);
  const setThermompnnJobId = useCallback((val: any) => useVariantAnalysisStore.getState().setThermompnnJobId(val), []);

  const [structuralDiff, setStructuralDiff] = useState<StructuralDiffResult | null>(null);

  const [computedPocket, setComputedPocket] = useState<PocketResult | null>(null);
  const [isPocketLoading, setIsPocketLoading] = useState(false);
  const [pocketError, setPocketError] = useState<string | null>(null);

  // Centralized telemetry tracking for biophysics jobs
  const jobTimersRef = useRef<Record<string, { start: number; jobId: string; traceId: string | null; traceStart: number }>>({});
  const jobErrorsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const result = useVariantAnalysisStore.getState().analysisState.result;
    const metadata = result?.metadata;
    if (!metadata?.gene || !metadata.variant || !metadata.uniprotId || !metadata.pipelineRunId) return;
    const cached = getCachedVariant(metadata.gene, metadata.variant);
    if (cached?.analysisResult?.metadata?.pipelineRunId !== metadata.pipelineRunId || cached.uniprotId !== metadata.uniprotId) return;
    setCachedVariant(metadata.gene, metadata.variant, metadata.uniprotId, {
      foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus, thermompnnError,
      dynamut2JobId, ddmutJobId, thermompnnJobId
    });
  }, [foldingEnergetics, dynamut2Status, ddmutStatus, thermompnnStatus, thermompnnError, dynamut2JobId, ddmutJobId, thermompnnJobId]);

  useEffect(() => {
    const track = (name: string, status: string | null, jobId: string | null) => {
      if (status === "pending" && jobId && jobTimersRef.current[name]?.jobId !== jobId) {
        jobTimersRef.current[name] = { start: performance.now(), jobId,
          traceId: consoleState.activeTraceRun?.traceId ?? null,
          traceStart: consoleState.activeTraceRun?.timestamp ?? Date.now() };
        delete jobErrorsRef.current[name];
      }
    };
    track("dynamut2", dynamut2Status, dynamut2JobId);
    track("ddmut", ddmutStatus, ddmutJobId);
    track("thermompnn", thermompnnStatus, thermompnnJobId);
  }, [dynamut2Status, ddmutStatus, thermompnnStatus, dynamut2JobId, ddmutJobId, thermompnnJobId, consoleState.activeTraceRun]);

  useEffect(() => {
    const checkJobEnd = (name: string, status: string | null) => {
      if (status === null) {
        delete jobTimersRef.current[name];
        delete jobErrorsRef.current[name];
        return;
      }
      const timer = jobTimersRef.current[name];
      if (timer && ["done", "unavailable", "error", "failed"].includes(status)) {
        const durationMs = Math.round(performance.now() - timer.start);
        if (timer.traceId) {
          addTraceSpan({
            traceId: timer.traceId,
            name: `${name.toUpperCase()} Biophysical Job Execution`,
            stage: "biophysics",
            startTime: Date.now() - durationMs,
            offsetMs: Math.max(0, Date.now() - durationMs - timer.traceStart),
            durationMs,
            status: status === "done" ? "success" : status === "unavailable" ? "unavailable" : "failed",
            ...(status !== "done" ? { error: jobErrorsRef.current[name] ?? `${name} settled as ${status} without provider diagnostics` } : {}),
            meta: { jobId: timer.jobId }
          });
        }
        delete jobTimersRef.current[name];
      }
    };
    checkJobEnd("dynamut2", dynamut2Status);
    checkJobEnd("ddmut", ddmutStatus);
    checkJobEnd("thermompnn", thermompnnStatus);
  }, [dynamut2Status, ddmutStatus, thermompnnStatus, addTraceSpan]);

  const recordRemoteError = (engine: string, message: string) => {
    jobErrorsRef.current[engine] = message;
    setFoldingEnergetics((prev: any) => ({ ...prev, [engine + "Error"]: message }));
  };

  const dynamutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const ddmutPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const thermompnnPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);
  const lastFetchedFoldRef = useRef<string>("");

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

  const clearDdmutPoll = useCallback(() => {
    if (ddmutPollIntervalRef.current) {
      clearTimeout(ddmutPollIntervalRef.current as any);
      ddmutPollIntervalRef.current = null;
    }
    setDdmutStatus(null);
    setDdmutJobId(null);
    delete jobTimersRef.current["ddmut"];
  }, [setDdmutStatus, setDdmutJobId]);

  const clearThermoMpnnPoll = useCallback(() => {
    if (thermompnnPollIntervalRef.current) {
      clearTimeout(thermompnnPollIntervalRef.current as any);
      thermompnnPollIntervalRef.current = null;
    }
    setThermompnnStatus(null);
    setThermompnnJobId(null);
    delete jobTimersRef.current["thermompnn"];
  }, [setThermompnnStatus, setThermompnnJobId]);

  // 1. DynaMut2 Poller
  useJobPoller({
    jobId: dynamut2JobId,
    status: dynamut2Status,
    endpoint: id => `/api/v1/dynamut2-job/${id}`,
    toolName: "DynaMut2",
    fetchWithAuth,
    onStatusChange: setDynamut2Status,
    onError: message => recordRemoteError("dynamut2", message),
    onListening: () => setFoldingEnergetics((prev: any) => (prev ? { ...prev, dynamut2Listening: true } : prev)),
    onToolFailed: tool => {
      setFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          dynamut2Listening: false,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== tool) : []
        };
      });
    },
    onSuccess: data => {
      setFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        dynamut2: data.prediction,
        dynamut2Error: null,
        dynamut2Listening: false,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
      }));
    },
    notifyOnce
  });

  // 2. DDMut Poller
  useJobPoller({
    jobId: ddmutJobId,
    status: ddmutStatus,
    endpoint: id => `/api/v1/ddmut-job/${id}`,
    toolName: "DDMut",
    fetchWithAuth,
    onStatusChange: setDdmutStatus,
    onError: message => recordRemoteError("ddmut", message),
    onListening: () => setFoldingEnergetics((prev: any) => (prev ? { ...prev, ddmutListening: true } : prev)),
    onToolFailed: tool => {
      setFoldingEnergetics((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          ddmutListening: false,
          pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== tool) : []
        };
      });
    },
    onSuccess: data => {
      setFoldingEnergetics((prev: any) => withStabilityConsensus({
        ...(prev || {}),
        ddmut: data.prediction,
        ddmutError: null,
        ddmutListening: false,
        pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
      }));
    },
    notifyOnce
  });

  // 3. ThermoMPNN Poller
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

  /*
   * The primary variant's diff/superposition effect lived here and never ran: it watched this hook's
   * LOCAL `foldingStatus`/`mutantPdb` (the pipeline writes the store's) and a `pdbText` argument no
   * caller passes. Its only live branch was the "else", which cleared the store's `foldxMetrics` and
   * `structuralDiff` (and a compare-variant model nothing produced) whenever `apiClient` changed identity. With it dead, the
   * 3D superposition fell back to the RAW FoldX variant. The job now belongs to `useFoldxSuperposition`,
   * which pairs the variant with the template FoldX actually used.
   */

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
    dynamut2Status,
    setDynamut2Status,
    ddmutStatus,
    setDdmutStatus,
    thermompnnStatus,
    setThermompnnStatus,
    thermompnnError,
    setThermompnnError,
    dynamut2JobId,
    setDynamut2JobId,
    ddmutJobId,
    setDdmutJobId,
    thermompnnJobId,
    setThermompnnJobId,
    structuralDiff,
    setStructuralDiff,
    computedPocket,
    setComputedPocket,
    isPocketLoading,
    setIsPocketLoading,
    pocketError,
    setPocketError,
    dynamutPollIntervalRef,
    ddmutPollIntervalRef,
    thermompnnPollIntervalRef,
    lastFetchedFoldRef,
    clearDynaMutPoll,
    clearDdmutPoll,
    clearThermoMpnnPoll,
    fetchPocketInfo
  };
}

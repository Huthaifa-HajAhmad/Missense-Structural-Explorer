import { useState, useRef, useCallback, useEffect } from "react";
import { EnergeticsData, StructuralDiffResult, PocketResult, UserSettings } from "../types";
import { buildEnergeticsQueryString } from "../useVariantAnalysis";
import { useDevConsole } from "../context/DevConsoleContext";
import { computeConsensusVerdict } from "../shared/thresholds";
import { AMINO_ACID_3_TO_1 } from "../aminoAcids";

export function useBiophysicalModeling(
  settings: UserSettings,
  addNotification: (type: "success" | "info" | "error" | "warn", message: string) => void,
  apiClient: any,
  fetchWithAuth: (url: string, options?: any) => Promise<Response>,
  pdbText?: string | null
) {
  const { dispatch } = useDevConsole();
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

  useEffect(() => {
    const checkJobEnd = (name: string, status: string | null) => {
      const start = jobTimersRef.current[name];
      if (start && (status === "done" || status === "unavailable" || status === "error" || status === "failed")) {
        const durationMs = Math.round(performance.now() - start);
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
  }, [dynamut2Status, compareDynamut2Status, ddmutStatus, compareDdmutStatus, thermompnnStatus, compareThermompnnStatus]);

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

  const notifyOnce = useCallback((key: string, type: "warn" | "error" | "success", msg: string) => {
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

  const getBackoffDelay = (attempt: number) => {
    if (attempt < 5) return 3000;
    if (attempt < 15) return 5000;
    return 10000;
  };

  // P0-3: generous ceiling on polling — 60 attempts or ~10 minutes elapsed to allow deep models (DDMut) to complete
  const MAX_POLL_ATTEMPTS = 60;
  const MAX_POLL_ELAPSED_MS = 10 * 60 * 1000;

  useEffect(() => {
    if (dynamut2Status === "pending" && dynamut2JobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        // P0-3: hard timeout / attempt cap — never poll forever
        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setDynamut2Status("unavailable");
          setFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
            };
          });
          notifyOnce(`d2_${dynamut2JobId}_timeout`, "warn", "DynaMut2 prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const energetics = foldingEnergeticsRef.current;
          const foldx = energetics?.foldxMean ?? energetics?.foldx ?? "";
          const rasp = energetics?.rasp ?? "";
          const ddmut = energetics?.ddmut ?? "";
          const foldxRepairFailed = energetics?.foldxRepairFailed ? "true" : "false";

          const q = new URLSearchParams();
          if (foldx !== "") q.set("foldx", foldx.toString());
          if (rasp !== "") q.set("rasp", rasp.toString());
          if (ddmut !== "") q.set("ddmut", ddmut.toString());
          q.set("foldxRepairFailed", foldxRepairFailed);

          const res = await fetchWithAuth(`/api/v1/dynamut2-job/${dynamut2JobId}?${q.toString()}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setDynamut2Status("unavailable");
            setFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
              };
            });
            notifyOnce(`d2_${dynamut2JobId}_unavailable`, "error", `DynaMut2 predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "DONE") {
              setDynamut2Status("done");
              setFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                dynamut2: data.prediction,
                consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
                consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
                consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
                consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
              }));
              notifyOnce(`d2_${dynamut2JobId}_done`, "success", "DynaMut2 prediction completed.");
              return;
            } else if (data.status === "ERROR") {
              setDynamut2Status("unavailable");
              setFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
                };
              });
              notifyOnce(`d2_${dynamut2JobId}_error`, "error", "DynaMut2 prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("DynaMut2 polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        dynamutPollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      dynamutPollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (dynamutPollIntervalRef.current) {
          clearTimeout(dynamutPollIntervalRef.current as any);
          dynamutPollIntervalRef.current = null;
        }
      };
    }
  }, [
    dynamut2JobId,
    dynamut2Status,
    fetchWithAuth,
    notifyOnce
  ]);

  useEffect(() => {
    if (compareDynamut2Status === "pending" && compareDynamut2JobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setCompareDynamut2Status("unavailable");
          setCompareFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
            };
          });
          notifyOnce(`cd2_${compareDynamut2JobId}_timeout`, "warn", "Comparison DynaMut2 prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const compEnergetics = compareFoldingEnergeticsRef.current;
          const foldx = compEnergetics?.foldxMean ?? compEnergetics?.foldx ?? "";
          const rasp = compEnergetics?.rasp ?? "";
          const ddmut = compEnergetics?.ddmut ?? "";
          const foldxRepairFailed = compEnergetics?.foldxRepairFailed ? "true" : "false";

          const q = new URLSearchParams();
          if (foldx !== "") q.set("foldx", foldx.toString());
          if (rasp !== "") q.set("rasp", rasp.toString());
          if (ddmut !== "") q.set("ddmut", ddmut.toString());
          q.set("foldxRepairFailed", foldxRepairFailed);

          const res = await fetchWithAuth(`/api/v1/dynamut2-job/${compareDynamut2JobId}?${q.toString()}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setCompareDynamut2Status("unavailable");
            setCompareFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
              };
            });
            notifyOnce(`cd2_${compareDynamut2JobId}_unavailable`, "error", `Comparison DynaMut2 predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "DONE") {
              setCompareDynamut2Status("done");
              setCompareFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                dynamut2: data.prediction,
                consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
                consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
                consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
                consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
              }));
              notifyOnce(`cd2_${compareDynamut2JobId}_done`, "success", "Comparison DynaMut2 prediction completed.");
              return;
            } else if (data.status === "ERROR") {
              setCompareDynamut2Status("done");
              setCompareFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DynaMut2") : []
                };
              });
              notifyOnce(`cd2_${compareDynamut2JobId}_error`, "error", "Comparison DynaMut2 prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("Comparison DynaMut2 polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        dynamutComparePollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      dynamutComparePollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (dynamutComparePollIntervalRef.current) {
          clearTimeout(dynamutComparePollIntervalRef.current as any);
          dynamutComparePollIntervalRef.current = null;
        }
      };
    }
  }, [
    compareDynamut2JobId,
    compareDynamut2Status,
    fetchWithAuth,
    notifyOnce
  ]);

  useEffect(() => {
    if (ddmutStatus === "pending" && ddmutJobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setDdmutStatus("unavailable");
          setFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
            };
          });
          notifyOnce(`ddm_${ddmutJobId}_timeout`, "warn", "DDMut prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const energetics = foldingEnergeticsRef.current;
          const foldx = energetics?.foldxMean ?? energetics?.foldx ?? "";
          const rasp = energetics?.rasp ?? "";
          const dynamut2 = energetics?.dynamut2 ?? "";
          const foldxRepairFailed = energetics?.foldxRepairFailed ? "true" : "false";

          const q = new URLSearchParams();
          if (foldx !== "") q.set("foldx", foldx.toString());
          if (rasp !== "") q.set("rasp", rasp.toString());
          if (dynamut2 !== "") q.set("dynamut2", dynamut2.toString());
          q.set("foldxRepairFailed", foldxRepairFailed);

          const res = await fetchWithAuth(`/api/v1/ddmut-job/${ddmutJobId}?${q.toString()}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setDdmutStatus("unavailable");
            setFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
              };
            });
            notifyOnce(`ddm_${ddmutJobId}_unavailable`, "error", `DDMut predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "DONE") {
              setDdmutStatus("done");
              setFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                ddmut: data.prediction,
                consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
                consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
                consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
                consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
              }));
              notifyOnce(`ddm_${ddmutJobId}_done`, "success", "DDMut prediction completed.");
              return;
            } else if (data.status === "ERROR") {
              setDdmutStatus("unavailable");
              setFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
                };
              });
              notifyOnce(`ddm_${ddmutJobId}_error`, "error", "DDMut prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("DDMut polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        ddmutPollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      ddmutPollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (ddmutPollIntervalRef.current) {
          clearTimeout(ddmutPollIntervalRef.current as any);
          ddmutPollIntervalRef.current = null;
        }
      };
    }
  }, [
    ddmutJobId,
    ddmutStatus,
    fetchWithAuth,
    notifyOnce
  ]);

  useEffect(() => {
    if (compareDdmutStatus === "pending" && compareDdmutJobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setCompareDdmutStatus("unavailable");
          setCompareFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
            };
          });
          notifyOnce(`cddm_${compareDdmutJobId}_timeout`, "warn", "Comparison DDMut prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const compEnergetics = compareFoldingEnergeticsRef.current;
          const foldx = compEnergetics?.foldxMean ?? compEnergetics?.foldx ?? "";
          const rasp = compEnergetics?.rasp ?? "";
          const dynamut2 = compEnergetics?.dynamut2 ?? "";
          const foldxRepairFailed = compEnergetics?.foldxRepairFailed ? "true" : "false";

          const q = new URLSearchParams();
          if (foldx !== "") q.set("foldx", foldx.toString());
          if (rasp !== "") q.set("rasp", rasp.toString());
          if (dynamut2 !== "") q.set("dynamut2", dynamut2.toString());
          q.set("foldxRepairFailed", foldxRepairFailed);

          const res = await fetchWithAuth(`/api/v1/ddmut-job/${compareDdmutJobId}?${q.toString()}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setCompareDdmutStatus("unavailable");
            setCompareFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
              };
            });
            notifyOnce(`cddm_${compareDdmutJobId}_unavailable`, "error", `Comparison DDMut predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "DONE") {
              setCompareDdmutStatus("done");
              setCompareFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                ddmut: data.prediction,
                consensusVerdict: data.consensusVerdict ?? prev?.consensusVerdict,
                consensusProbability: data.consensusProbability ?? prev?.consensusProbability,
                consensusConfMin: data.consensusConfMin ?? prev?.consensusConfMin,
                consensusConfMax: data.consensusConfMax ?? prev?.consensusConfMax,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
              }));
              notifyOnce(`cddm_${compareDdmutJobId}_done`, "success", "Comparison DDMut prediction completed.");
              return;
            } else if (data.status === "ERROR") {
              setCompareDdmutStatus("done");
              setCompareFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "DDMut") : []
                };
              });
              notifyOnce(`cddm_${compareDdmutJobId}_error`, "error", "Comparison DDMut prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("Comparison DDMut polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        ddmutComparePollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      ddmutComparePollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (ddmutComparePollIntervalRef.current) {
          clearTimeout(ddmutComparePollIntervalRef.current as any);
          ddmutComparePollIntervalRef.current = null;
        }
      };
    }
  }, [
    compareDdmutJobId,
    compareDdmutStatus,
    fetchWithAuth,
    notifyOnce
  ]);

  useEffect(() => {
    if (thermompnnStatus === "pending" && thermompnnJobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setThermompnnStatus("error");
          setThermompnnError("ThermoMPNN prediction timed out (max poll attempts reached).");
          setFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
            };
          });
          notifyOnce(`tm_${thermompnnJobId}_timeout`, "warn", "ThermoMPNN prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const res = await fetchWithAuth(`/api/v1/thermompnn-job/${thermompnnJobId}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setThermompnnStatus("error");
            setThermompnnError(`ThermoMPNN predictor is currently unavailable (HTTP ${res.status}).`);
            setFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
              };
            });
            notifyOnce(`tm_${thermompnnJobId}_unavailable`, "error", `ThermoMPNN predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "done") {
              setThermompnnStatus("done");
              setFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                thermompnn: data.prediction,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
              }));
              notifyOnce(`tm_${thermompnnJobId}_done`, "success", "ThermoMPNN prediction completed.");
              return;
            } else if (data.status === "error") {
              setThermompnnStatus("error");
              setThermompnnError(data.error || "ThermoMPNN prediction failed.");
              setFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
                };
              });
              notifyOnce(`tm_${thermompnnJobId}_error`, "error", "ThermoMPNN prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("ThermoMPNN polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        thermompnnPollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      thermompnnPollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (thermompnnPollIntervalRef.current) {
          clearTimeout(thermompnnPollIntervalRef.current as any);
          thermompnnPollIntervalRef.current = null;
        }
      };
    }
  }, [thermompnnJobId, thermompnnStatus, fetchWithAuth, notifyOnce]);

  useEffect(() => {
    if (compareThermompnnStatus === "pending" && compareThermompnnJobId) {
      let attempt = 0;
      let isAborted = false;
      const pollStart = Date.now();

      const poll = async () => {
        if (isAborted) return;

        if (attempt >= MAX_POLL_ATTEMPTS || (Date.now() - pollStart) > MAX_POLL_ELAPSED_MS) {
          setCompareThermompnnStatus("error");
          setCompareThermompnnError("Comparison ThermoMPNN prediction timed out (max poll attempts reached).");
          setCompareFoldingEnergetics((prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
            };
          });
          notifyOnce(`ctm_${compareThermompnnJobId}_timeout`, "warn", "Comparison ThermoMPNN prediction timed out (max poll attempts reached).");
          return;
        }

        try {
          const res = await fetchWithAuth(`/api/v1/thermompnn-job/${compareThermompnnJobId}`);
          if (isAborted) return;
          if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 429) {
            setCompareThermompnnStatus("error");
            setCompareThermompnnError(`Comparison ThermoMPNN predictor is currently unavailable (HTTP ${res.status}).`);
            setCompareFoldingEnergetics((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
              };
            });
            notifyOnce(`ctm_${compareThermompnnJobId}_unavailable`, "error", `Comparison ThermoMPNN predictor is currently unavailable (HTTP ${res.status}).`);
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === "done") {
              setCompareThermompnnStatus("done");
              setCompareFoldingEnergetics((prev: any) => ({
                ...(prev || {}),
                thermompnn: data.prediction,
                pendingTools: prev?.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
              }));
              notifyOnce(`ctm_${compareThermompnnJobId}_done`, "success", "Comparison ThermoMPNN prediction completed.");
              return;
            } else if (data.status === "error") {
              setCompareThermompnnStatus("error");
              setCompareThermompnnError(data.error || "Comparison ThermoMPNN prediction failed.");
              setCompareFoldingEnergetics((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  pendingTools: prev.pendingTools ? prev.pendingTools.filter((t: string) => t !== "ThermoMPNN") : []
                };
              });
              notifyOnce(`ctm_${compareThermompnnJobId}_error`, "error", "Comparison ThermoMPNN prediction failed.");
              return;
            }
          }
        } catch (err: any) {
          console.error("Comparison ThermoMPNN polling error:", err);
        }

        attempt++;
        const delay = getBackoffDelay(attempt);
        thermompnnComparePollIntervalRef.current = setTimeout(poll, delay);
      };

      const delay = getBackoffDelay(attempt);
      thermompnnComparePollIntervalRef.current = setTimeout(poll, delay);

      return () => {
        isAborted = true;
        if (thermompnnComparePollIntervalRef.current) {
          clearTimeout(thermompnnComparePollIntervalRef.current as any);
          thermompnnComparePollIntervalRef.current = null;
        }
      };
    }
  }, [compareThermompnnJobId, compareThermompnnStatus, fetchWithAuth, notifyOnce]);

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

import { useState, useRef, useCallback } from "react";
import { PdbHomolog, NearestResidue, StructureProvenance } from "../types";
import {
  getDeduplicatedPromise,
  translateVariantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  parseMutationResidues,
  generateMutantResponseSchema
} from "../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../data";
import { useDevConsole } from "../context/DevConsoleContext";
export function toFoldxMutation(proteinVariant: string): string | null {
  const aminoAcidMap: Record<string, string> = {
    Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
    Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V"
  };
  const clean = proteinVariant.replace(/^p\./i, "").replace(/[()]/g, "").trim();

  // If already in FoldX format (e.g. RA408W)
  if (/^[ARNDCQEGHILKMFPSTWYV][A-Z]\d+[ARNDCQEGHILKMFPSTWYV]$/i.test(clean)) {
    return clean.toUpperCase();
  }

  const normalize3 = (str: string) => {
    if (str.length !== 3) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
  if (match3) {
    const wt3 = normalize3(match3[1]);
    const mut3 = normalize3(match3[3]);
    const wt = aminoAcidMap[wt3];
    const mut = aminoAcidMap[mut3];
    if (wt && mut) {
      return `${wt}A${match3[2]}${mut}`;
    }
  }

  const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (match1) {
    const wt = match1[1].toUpperCase();
    const mut = match1[3].toUpperCase();
    return `${wt}A${match1[2]}${mut}`;
  }

  return null;
}

export function isGenomicOrCdnaNotation(variant: string): boolean {
  const trimmed = variant.trim();
  return (
    /^(?:chr)?[0-9XYMT]+:g\./i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?c\.\d+/i.test(trimmed) ||
    /^(?:[A-Z0-9_.]+:)?g\.\d+/i.test(trimmed) ||
    /^(?:chr)?[0-9XYMT]+:\d+/i.test(trimmed) ||
    /^chr/i.test(trimmed)
  );
}

export interface UseAnalysisPipelineOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  apiClient: any;
  settings: any;
  userDirections: string;
  setAnalysisState: React.Dispatch<React.SetStateAction<any>>;
  setLoadingStep: (step: string) => void;
  setIsBiophysicalLoading: (loading: boolean) => void;
  setIsClinicalLoading: (loading: boolean) => void;
  setIsNarrativeLoading: (loading: boolean) => void;
  setGene: (gene: string) => void;
  setVariant: (variant: string) => void;
  setUniprotId: (uniprotId: string) => void;
  setSearchVal: (searchVal: string) => void;
  setCustomGene: (gene: string) => void;
  setCustomVariant: (variant: string) => void;
  setCustomUniprot: (uniprotId: string) => void;
  setSelectedResidueIndex: (index: number | null) => void;
  setDisruptionPredictor: (val: any) => void;
  setComputedPocket: (pocket: any) => void;
  setIsPocketLoading: (loading: boolean) => void;
  setPocketError: (err: string | null) => void;
  setPdbText: (pdb: string | null) => void;
  addToHistory: (gene: string, variant: string, uniprotId: string) => void;
  resetViewerState: () => void;
  clearDynaMutPoll: () => void;
  clearDynaMutComparePoll: () => void;
  // Biophysical modeling setters for concurrent FoldX execution
  setIsFolding: (folding: boolean) => void;
  setFoldingError: (err: string | null) => void;
  setFoldingStatus: (status: string | null) => void;
  setMutantPdb: (pdb: string | null) => void;
  setFoldedResidueIndex: (index: number | null) => void;
  setFoldingDdG: (ddG: number | null) => void;
  setFoldingEnergetics: (energetics: any) => void;
  setDynamut2JobId: (id: string | null) => void;
  setDynamut2Status: (status: "pending" | "unavailable" | "done" | null) => void;
  setDdmutJobId: (id: string | null) => void;
  setDdmutStatus: (status: "pending" | "unavailable" | "done" | null) => void;
  setThermompnnJobId: (id: string | null) => void;
  setThermompnnStatus: (status: "pending" | "unavailable" | "done" | "error" | null) => void;
  setThermompnnError: (err: string | null) => void;
  lastFetchedFoldRef: React.MutableRefObject<string>;
}

export function useAnalysisPipeline() {
  const { dispatch } = useDevConsole();
  const analysisAbortRef = useRef<AbortController | null>(null);
  const mutantFoldAbortRef = useRef<AbortController | null>(null);
  const compareFoldAbortRef = useRef<AbortController | null>(null);
  const pendingResiduesRef = useRef<Set<string>>(new Set());
  const activeRequestIdRef = useRef<number>(0);

  const [homologs, setHomologs] = useState<PdbHomolog[]>([]);
  const [isHomologsLoading, setIsHomologsLoading] = useState(false);
  const [computedResiduesCache, setComputedResiduesCache] = useState<Record<string, NearestResidue[]>>({});
  const [disruptionPredictor, setDisruptionPredictor] = useState<{ level: "high" | "low" | "unknown"; reason: string; plddt: number | null } | null>(null);

  const abortAllPendingRequests = (clearDynaMutPoll?: () => void, clearDynaMutComparePoll?: () => void) => {
    activeRequestIdRef.current += 1;
    if (clearDynaMutPoll) clearDynaMutPoll();
    if (clearDynaMutComparePoll) clearDynaMutComparePoll();
    if (analysisAbortRef.current) {
      try {
        analysisAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort analysis request", e);
      }
    }
    if (mutantFoldAbortRef.current) {
      try {
        mutantFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort mutant fold request", e);
      }
    }
    if (compareFoldAbortRef.current) {
      try {
        compareFoldAbortRef.current.abort();
      } catch (e) {
        console.error("Failed to abort compare fold request", e);
      }
    }
  };

  const translateVariantNotation = async (
    notation: string,
    signal: AbortSignal,
    options: Pick<UseAnalysisPipelineOptions, "apiClient" | "setAnalysisState" | "setLoadingStep">
  ) => {
    options.setAnalysisState((prev: any) => ({ ...prev, isLoading: true, error: null }));
    options.setLoadingStep("Step 1/4: Translating genomic / cDNA variant notation via Ensembl VEP...");

    try {
      const startTime = performance.now();
      const data = await options.apiClient.translateVariant(notation, signal);
      const durationMs = Math.round(performance.now() - startTime);
      dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "VEP Notation Translation", durationMs, status: "success" } });
      return {
        gene: data.gene,
        variant: data.variant,
        uniprotId: data.uniprotId,
        transcriptMeta: {
          transcriptId: data.transcriptId,
          isManeSelect: data.isManeSelect,
          isManePlusClinical: data.isManePlusClinical,
          isCanonical: data.isCanonical,
          maneRefSeqId: data.maneRefSeqId,
          transcriptWarning: data.transcriptWarning
        }
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - (options as any)._startTime || 0); // fallback or 0
      dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "VEP Notation Translation", durationMs: 0, status: "failed" } });
      if (signal.aborted) throw err;
      throw new Error(err.message || "Failed to translate notation");
    }
  };

  const fetchHomologs = useCallback(async (
    targetUniprot: string,
    apiClient: any,
    signal?: AbortSignal
  ) => {
    setIsHomologsLoading(true);
    setHomologs([]);
    const startTime = performance.now();
    try {
      const homologsList = await apiClient.getHomologs(targetUniprot, signal);
      const durationMs = Math.round(performance.now() - startTime);
      dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "UniProt Homologs Fetch", durationMs, status: "success" } });
      if (!signal?.aborted && Array.isArray(homologsList)) {
        setHomologs(homologsList);
      }
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - startTime);
      dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "UniProt Homologs Fetch", durationMs, status: "failed" } });
      if (!signal?.aborted && err.name !== "AbortError") {
        console.error("Error fetching homologous structures:", err.message || err);
      }
    } finally {
      if (!signal?.aborted) {
        setIsHomologsLoading(false);
      }
    }
  }, []);

  const fetchNearestResidues = useCallback(async (
    targetUniprot: string,
    targetVariant: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    signal?: AbortSignal
  ) => {
    const cacheKey = `${targetUniprot}_${residueIndex}`;

    if (computedResiduesCache[cacheKey]) return;
    if (pendingResiduesRef.current.has(cacheKey)) return;

    pendingResiduesRef.current.add(cacheKey);
    try {
      const validatedData = await apiClient.getNearestResidues({
        pdbText,
        targetIndex: residueIndex,
        distanceThreshold: 5
      }, signal);

      const mapped = validatedData.residues.map((r: any) => ({
        name: `${r.name}${r.index}`,
        distance: `${r.distance} Å`,
        properties: r.properties,
        role: r.role,
        classBadge: r.classBadge,
        source: "computed" as const
      }));

      if (!signal?.aborted) {
        setComputedResiduesCache(prev => {
          const next = { ...prev, [cacheKey]: mapped };
          const keys = Object.keys(next);
          if (keys.length > 200) {
            const oldestKey = keys[0];
            delete next[oldestKey];
          }
          return next;
        });
      }
    } catch (err: any) {
      if (!signal?.aborted) {
        console.error("Error fetching nearest residues:", err);
      }
    } finally {
      pendingResiduesRef.current.delete(cacheKey);
    }
  }, [computedResiduesCache]);

  const fetchPocketData = useCallback(async (
    targetUniprot: string,
    residueIndex: number,
    pdbText: string,
    apiClient: any,
    setIsPocketLoading: (loading: boolean) => void,
    setPocketError: (err: string | null) => void,
    setComputedPocket: (pocket: any) => void,
    signal?: AbortSignal
  ) => {
    setIsPocketLoading(true);
    setPocketError(null);
    try {
      const validatedData = await apiClient.findPocket({ pdbText, mutIndex: residueIndex }, signal);
      setComputedPocket(validatedData);
    } catch (err: any) {
      if (signal?.aborted) return;
      console.error("Pocket finder error:", err);
      setPocketError(err.message || "Failed to load pocket coordinates.");
    } finally {
      setIsPocketLoading(false);
    }
  }, []);

  const executeAnalysis = async (
    targetGeneArg: string,
    targetVariantArg: string,
    targetUniprotArg?: string,
    providedSignal?: AbortSignal,
    options?: UseAnalysisPipelineOptions
  ) => {
    if (!options) return;
    const {
      fetchWithAuth,
      apiClient,
      settings,
      userDirections,
      setAnalysisState,
      setLoadingStep,
      setIsBiophysicalLoading,
      setIsClinicalLoading,
      setIsNarrativeLoading,
      setGene,
      setVariant,
      setUniprotId,
      setSearchVal,
      setCustomGene,
      setCustomVariant,
      setCustomUniprot,
      setSelectedResidueIndex,
      setPdbText,
      addToHistory,
      resetViewerState,
      clearDynaMutPoll,
      clearDynaMutComparePoll,
      setComputedPocket,
      setIsPocketLoading,
      setPocketError
    } = options;

    const requestId = ++activeRequestIdRef.current;
    abortAllPendingRequests(clearDynaMutPoll, clearDynaMutComparePoll);
    activeRequestIdRef.current = requestId;

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    setAnalysisState({ isLoading: true, error: null, result: null });
    setIsBiophysicalLoading(true);
    setIsClinicalLoading(true);

    let targetGene = targetGeneArg.trim();
    let targetVariant = targetVariantArg.trim();
    let targetUniprot = (targetUniprotArg || "").trim();
    let transcriptMeta: any = null;

    try {
      const isCdnaOrVcf = isGenomicOrCdnaNotation(targetVariant);
      if (isCdnaOrVcf) {
        const transResult = await translateVariantNotation(targetVariant, activeSignal, { apiClient, setAnalysisState, setLoadingStep });
        targetGene = transResult.gene;
        targetVariant = transResult.variant;
        targetUniprot = transResult.uniprotId;
        transcriptMeta = transResult.transcriptMeta;
      }

      setGene(targetGene);
      setVariant(targetVariant);
      setUniprotId(targetUniprot);
      setSearchVal(`${targetGene} ${targetVariant}`);
      setCustomGene(targetGene);
      setCustomVariant(targetVariant);
      setCustomUniprot(targetUniprot);

      resetViewerState();
      fetchHomologs(targetUniprot, apiClient, activeSignal);

      const posMatch = targetVariant.match(/\d+/);

      setLoadingStep("Step 2/4: Fetching AlphaFold & PDB 3D structures...");
      const pdbKey = `warmup_${targetGene}_${targetVariant}_${targetUniprot}`;
      const pdbStart = performance.now();
      const pdbWarmupPromise = getDeduplicatedPromise(pdbKey, () =>
        apiClient.getPdb(targetUniprot, posMatch ? parseInt(posMatch[0], 10) : undefined, activeSignal)
          .then((res: any) => {
            const durationMs = Math.round(performance.now() - pdbStart);
            dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "PDB / AlphaFold 3D Fetch", durationMs, status: "success" } });
            return res;
          })
          .catch((err: any) => {
            console.error("[Pipeline] PDB warmup failed:", err);
            const durationMs = Math.round(performance.now() - pdbStart);
            dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "PDB / AlphaFold 3D Fetch", durationMs, status: "failed" } });
            return null;
          })
      );

      // Concurrently fire generate-mutant FoldX pipeline (Component 2 Parallelism Redesign)
      const foldKey = `${targetUniprot}_${targetVariant}`;
      if (options.lastFetchedFoldRef.current !== foldKey && posMatch) {
        options.lastFetchedFoldRef.current = foldKey;

        // Abort previous FoldX request if in flight
        if (mutantFoldAbortRef.current) {
          try {
            mutantFoldAbortRef.current.abort();
          } catch (e) {
            console.error("[Pipeline] Failed to abort previous mutant fold request", e);
          }
        }
        const foldController = new AbortController();
        mutantFoldAbortRef.current = foldController;
        const foldTimeoutId = setTimeout(() => {
          foldController.abort();
          options.setFoldingError("Simulation timed out after 5 minutes.");
          options.setFoldingStatus("failed");
          options.setIsFolding(false);
        }, 300000);

        options.setIsFolding(true);
        options.setFoldingError(null);
        options.setFoldingStatus(null);

        const foldxMutation = toFoldxMutation(targetVariant);
        if (!foldxMutation) {
          console.error("[Pipeline Error] Could not convert protein variant to FoldX mutation format:", targetVariant);
          options.setFoldingError("Invalid mutation format for FoldX simulation.");
          options.setFoldingStatus("failed");
          options.setIsFolding(false);
        } else {
          (async () => {
            try {
              // Decouple FoldX from client PDB fetch: call /generate-mutant immediately
              const res = await fetchWithAuth("/api/v1/generate-mutant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  uniprotId: targetUniprot,
                  mutation: foldxMutation,
                }),
                signal: foldController.signal
              });

              if (foldController.signal.aborted || activeRequestIdRef.current !== requestId) return;

              if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP ${res.status}`);
              }

              const raw = await res.json();
              const parsed = generateMutantResponseSchema.safeParse(raw);
              type GenerateMutantData = ReturnType<typeof generateMutantResponseSchema.parse>;
              const data: GenerateMutantData = parsed.success ? parsed.data : (raw as GenerateMutantData);

              if (foldController.signal.aborted || activeRequestIdRef.current !== requestId) return;

              if (data.status === "success" || data.status === "completed") {
                options.setMutantPdb(data.pdb ?? null);
                options.setFoldedResidueIndex(
                  data.foldedResidueIndex ?? parseInt(posMatch[0], 10)
                );
                options.setFoldingDdG(data.ddG ?? null);
                options.setFoldingStatus("success");

                if (data.energetics) {
                  const prov = data.provenance;
                  const structureProvenance: StructureProvenance | undefined = prov
                    ? {
                        source: prov.structureSource ?? "alphafold",
                        pdbId: prov.structurePdbId ?? undefined,
                        chainId: prov.structureChainId ?? undefined,
                        resolution: prov.structureResolution ?? undefined,
                        method: prov.structureMethod ?? undefined,
                        identity: prov.structureIdentity ?? undefined,
                        foldxVersion: prov.foldxVersion,
                        foldxRuns: prov.foldxRuns,
                        seed: prov.seed,
                        raspDatasetSnapshot: prov.raspDatasetSnapshot,
                        vesmModel: prov.vesmModel,
                        timestamp: prov.timestamp
                      }
                    : undefined;

                  options.setFoldingEnergetics((prev: any) => ({
                    ...(prev || {}),
                    ...data.energetics,
                    dynamut2: prev?.dynamut2 ?? data.energetics?.dynamut2 ?? null,
                    ddmut: prev?.ddmut ?? data.energetics?.ddmut ?? null,
                    thermompnn: prev?.thermompnn ?? data.energetics?.thermompnn ?? null,
                    structureProvenance
                  }));
                }              } else if (data.status === "queued" || data.status === "running") {
                const jobId = data.foldxJobId;
                if (!jobId) {
                  throw new Error("No foldxJobId returned for queued biophysical simulation.");
                }

                let delay = 2000;
                while (true) {
                  if (foldController.signal.aborted || activeRequestIdRef.current !== requestId) return;

                  // Wait with backoff
                  await new Promise(resolve => setTimeout(resolve, delay));
                  delay = Math.min(5000, delay + 500);

                  if (foldController.signal.aborted || activeRequestIdRef.current !== requestId) return;

                  const pollRes = await fetchWithAuth(`/api/v1/foldx-job/${jobId}`, {
                    method: "GET",
                    headers: { "Accept": "application/json" },
                    signal: foldController.signal
                  });

                  if (foldController.signal.aborted || activeRequestIdRef.current !== requestId) return;

                  if (!pollRes.ok) {
                    const pollErrData = await pollRes.json().catch(() => ({}));
                    throw new Error(pollErrData.error || `Polling failed with status ${pollRes.status}`);
                  }

                  const pollData = await pollRes.json();

                  // Map remote jobs dynamically from polling response (Bug 2 Fix)
                  if (pollData.dynamut2JobId != null) options.setDynamut2JobId(pollData.dynamut2JobId);
                  if (pollData.dynamut2Status != null)
                    options.setDynamut2Status(pollData.dynamut2Status as "pending" | "unavailable" | "done" | null);
                  if (pollData.ddmutJobId != null) options.setDdmutJobId(pollData.ddmutJobId);
                  if (pollData.ddmutStatus != null)
                    options.setDdmutStatus(pollData.ddmutStatus as "pending" | "unavailable" | "done" | null);
                  if (pollData.thermompnnJobId != null) options.setThermompnnJobId(pollData.thermompnnJobId);
                  if (pollData.thermompnnStatus != null)
                    options.setThermompnnStatus(
                      pollData.thermompnnStatus as "pending" | "unavailable" | "done" | "error" | null
                    );
                  if (pollData.thermompnnError != null) options.setThermompnnError(pollData.thermompnnError);
                  const allRemoteSubmitted = 
                    (pollData.dynamut2JobId != null || pollData.dynamut2Status === "unavailable" || pollData.dynamut2Status === "done") &&
                    (pollData.ddmutJobId != null || pollData.ddmutStatus === "unavailable" || pollData.ddmutStatus === "done") &&
                    (pollData.thermompnnJobId != null || pollData.thermompnnStatus === "unavailable" || pollData.thermompnnStatus === "done" || pollData.thermompnnStatus === "error");

                  // Async-chip UX: FoldX completion drives the primary structure/ΔΔG out by
                  // itself. DynaMut2/DDMut/ThermoMPNN become independent chips, updated by their
                  // own poll loops — never gate the FoldX render on upstream availability.
                  if (pollData.status === "completed") {
                    const rawResult = pollData.result;
                    const parsed = generateMutantResponseSchema.safeParse(rawResult);
                    type GenerateMutantData = ReturnType<typeof generateMutantResponseSchema.parse>;
                    const resResult: GenerateMutantData = parsed.success ? parsed.data : (rawResult as GenerateMutantData);

                    options.setMutantPdb(resResult.pdb ?? null);
                    options.setFoldedResidueIndex(
                      resResult.foldedResidueIndex ?? parseInt(posMatch[0], 10)
                    );
                    options.setFoldingDdG(resResult.ddG ?? null);
                    options.setFoldingStatus("success");

                    if (resResult.energetics) {
                      const prov = resResult.provenance;
                      const structureProvenance: StructureProvenance | undefined = prov
                        ? {
                            source: prov.structureSource ?? "alphafold",
                            pdbId: prov.structurePdbId ?? undefined,
                            chainId: prov.structureChainId ?? undefined,
                            resolution: prov.structureResolution ?? undefined,
                            method: prov.structureMethod ?? undefined,
                            identity: prov.structureIdentity ?? undefined,
                            foldxVersion: prov.foldxVersion,
                            foldxRuns: prov.foldxRuns,
                            seed: prov.seed,
                            raspDatasetSnapshot: prov.raspDatasetSnapshot,
                            vesmModel: prov.vesmModel,
                            timestamp: prov.timestamp
                          }
                        : undefined;

                      options.setFoldingEnergetics((prev: any) => ({
                        ...(prev || {}),
                        ...resResult.energetics,
                        dynamut2: prev?.dynamut2 ?? resResult.energetics?.dynamut2 ?? null,
                        ddmut: prev?.ddmut ?? resResult.energetics?.ddmut ?? null,
                        thermompnn: prev?.thermompnn ?? resResult.energetics?.thermompnn ?? null,
                        structureProvenance
                      }));
                    }
                    break;
                  } else if (pollData.status === "failed") {
                    throw new Error(pollData.error || "Background FoldX execution failed.");
                  }
                }
              }

              if (data.dynamut2JobId != null) options.setDynamut2JobId(data.dynamut2JobId);
              if (data.dynamut2Status != null)
                options.setDynamut2Status(data.dynamut2Status as "pending" | "unavailable" | "done" | null);
              if (data.ddmutJobId != null) options.setDdmutJobId(data.ddmutJobId);
              if (data.ddmutStatus != null)
                options.setDdmutStatus(data.ddmutStatus as "pending" | "unavailable" | "done" | null);
              if (data.thermompnnJobId != null) options.setThermompnnJobId(data.thermompnnJobId);
              if (data.thermompnnStatus != null)
                options.setThermompnnStatus(
                  data.thermompnnStatus as "pending" | "unavailable" | "done" | "error" | null
                );
              if (data.thermompnnError != null) options.setThermompnnError(data.thermompnnError);

            } catch (err: any) {
              if (foldController.signal.aborted || err.name === "AbortError" || activeRequestIdRef.current !== requestId) return;
              console.error("[Pipeline Error] FoldX pipeline failed:", err);
              options.setFoldingError(err.message || "FoldX simulation failed.");
              options.setFoldingStatus("failed");
            } finally {
              clearTimeout(foldTimeoutId);
              if (!foldController.signal.aborted && activeRequestIdRef.current === requestId) {
                options.setIsFolding(false);
              }
            }
          })();;
        }
      }

      // P1-14: The pipeline is actually awaiting the Gemini biophysical narrative here (not ESM-2).
      // The latter fires in parallel from /analyze-variant; this label should reflect the real blocker.
      setLoadingStep("Step 3/4: Computing AI biophysical assessment...");
      const bpKey = `biophysical_${targetGene}_${targetVariant}_${targetUniprot}`;
      const bpStart = performance.now();
      
      const biophysicalPromise = getDeduplicatedPromise(bpKey, () =>
        apiClient.getBiophysicalAnalysis({
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot
        }, activeSignal)
          .then((res: any) => {
            const durationMs = Math.round(performance.now() - bpStart);
            dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "Biophysical Analysis (Core)", durationMs, status: "success" } });
            return res;
          })
          .catch((err: any) => {
            if (!activeSignal.aborted && err.name !== "AbortError") {
              console.error("[Pipeline] Biophysical analysis failed:", err);
            }
            const durationMs = Math.round(performance.now() - bpStart);
            dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "Biophysical Analysis (Core)", durationMs, status: "failed" } });
            throw err;
          })
      );

      const parsedResidues = parseMutationResidues(targetVariant);
      setIsNarrativeLoading(false);

      pdbWarmupPromise.then((pdb: any) => {
        if (pdb && activeRequestIdRef.current === requestId && !activeSignal.aborted) {
          setPdbText(pdb);
          if (posMatch) {
            const residueIndex = parseInt(posMatch[0], 10);
            fetchPocketData(
              targetUniprot,
              residueIndex,
              pdb,
              apiClient,
              setIsPocketLoading,
              setPocketError,
              setComputedPocket,
              activeSignal
            );
          }
          setAnalysisState((prev: any) => {
            if (prev.result) return prev;
            return {
              isLoading: false,
              error: null,
              result: {
                analysis: "Biophysical analysis in progress...",
                insights: null,
                isDemoData: false,
                ruleBasedInsights: null,
                metadata: {
                  gene: targetGene,
                  variant: targetVariant,
                  uniprotId: targetUniprot,
                  residueIndex: posMatch ? parseInt(posMatch[0], 10) : null,
                  wildType: parsedResidues?.wt || "",
                  mutant: parsedResidues?.mut || "",
                  analysisVersion: {
                    thresholds: "ACMG v1.0.0-concordance",
                    geminiModel: "gemini-3.5-flash",
                    foldxVersion: "FoldX 5.0",
                    timestamp: new Date().toISOString()
                  }
                },
                predictorData: null,
                conservationData: null,
                landscapeData: null,
                stringInteractions: null,
                disruptionPredictor: { level: "low" as const, reason: "Default", plddt: 100 },
                uniprotFeatures: null,
                gnomadConstraint: null,
                transcriptId: transcriptMeta?.transcriptId,
                isManeSelect: transcriptMeta?.isManeSelect,
                isManePlusClinical: transcriptMeta?.isManePlusClinical,
                isCanonical: transcriptMeta?.isCanonical,
                maneRefSeqId: transcriptMeta?.maneRefSeqId,
                transcriptWarning: transcriptMeta?.transcriptWarning,
                gnomadFrequency: null,
                aouFrequency: null,
                esm2: null,
                esm3Eval: null,
                esmcEval: null,
                esm2Eval: null,
                saprotEval: null
              }
            };
          });
        }
      });

      const triggerNarrative = (bpResult: any) => {
        addToHistory(targetGene, targetVariant, targetUniprot);

        if (posMatch) {
          setSelectedResidueIndex(parseInt(posMatch[0], 10));
        }

        setLoadingStep("Step 4/4: Generating AI clinical narrative...");
        setIsClinicalLoading(false);
        setIsNarrativeLoading(true);

        (async () => {
          try {
            const narrativeStart = performance.now();
            const narrativeData = await apiClient.getNarrative({
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              userDirections: userDirections || undefined,
              acmgWeighting: settings.acmgWeighting,
              clinvar: bpResult?.clinvar || null,
              predictorData: bpResult?.predictorData || null,
              conservationData: bpResult?.conservationData || null,
              stringInteractions: bpResult?.stringInteractions || null,
              gnomadConstraint: bpResult?.gnomadConstraint || null,
              gnomadFrequency: bpResult?.gnomadFrequency || null,
              uniprotFeatures: bpResult?.uniprotFeatures || null,
              sequence: bpResult?.metadata?.sequence || null
            }, activeSignal);
            
            const durationMs = Math.round(performance.now() - narrativeStart);
            dispatch({ type: "ADD_TELEMETRY_SPAN", span: { name: "AI Clinical Narrative Generation", durationMs, status: "success" } });

            if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;
            setAnalysisState((prev: any) => {
              if (!prev.result) return prev;
              const prevInsights = prev.result.insights || { biochemicalShift: "", structuralImpact: "", acmgCriteria: [], plausibility: "" };
              return {
                ...prev,
                result: {
                  ...prev.result,
                  analysis: narrativeData.analysis,
                  insights: {
                    ...prevInsights,
                    biochemicalShift: narrativeData.insights?.biochemicalShift || prevInsights.biochemicalShift || "",
                    structuralImpact: narrativeData.insights?.structuralImpact || prevInsights.structuralImpact || "",
                    acmgCriteria: narrativeData.insights?.acmgCriteria || [],
                    acmgVerdict: narrativeData.insights?.acmgVerdict || prev.result.ruleBasedInsights?.acmgVerdict || "",
                    partialEvidence: narrativeData.insights?.partialEvidence || prev.result.ruleBasedInsights?.partialEvidence,
                    pathogenicity: narrativeData.insights?.pathogenicity || prevInsights.pathogenicity,
                    plausibility: narrativeData.insights?.plausibility || ""
                  }
                }
              };
            });
          } catch (narrativeErr: any) {
            if (!activeSignal.aborted) {
              console.error("[Pipeline Error] Narrative generation failed:", narrativeErr);
              setAnalysisState((prev: any) => {
                if (!prev.result) return prev;
                return {
                  ...prev,
                  result: {
                    ...prev.result,
                    analysis: `### ❌ Narrative Generation Failed\n\nAn error occurred while generating the clinical narrative: **${narrativeErr.message || narrativeErr}**.\n\nPlease check your network connection or API key settings and try again.`
                  }
                };
              });
            }
          } finally {
            if (activeRequestIdRef.current === requestId) {
              setIsNarrativeLoading(false);
            }
          }
        })();
      };

      biophysicalPromise
        .then((resResult: any) => {
          if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;
          setIsBiophysicalLoading(false);
          setIsClinicalLoading(false);

          if (resResult) {
            // The UI treats UniProt as optional; the server may resolve it from the gene.
            // Thread that resolved accession into the subsequent narrative request.
            if (!targetUniprot && resResult.metadata?.uniprotId) {
              targetUniprot = resResult.metadata.uniprotId;
              setUniprotId(targetUniprot);
            }

            setAnalysisState({
              isLoading: false,
              error: null,
              result: {
                analysis: resResult.analysis || "Analysis completed.",
                insights: resResult.insights || null,
                isDemoData: false,
                ruleBasedInsights: resResult.ruleBasedInsights || null,
                metadata: resResult.metadata || {
                  gene: targetGene,
                  variant: targetVariant,
                  uniprotId: targetUniprot,
                  residueIndex: posMatch ? parseInt(posMatch[0], 10) : null,
                  wildType: parsedResidues?.wt || "",
                  mutant: parsedResidues?.mut || "",
                  analysisVersion: {
                    thresholds: "ACMG v1.0.0-concordance",
                    geminiModel: "gemini-3.5-flash",
                    foldxVersion: "FoldX 5.0",
                    timestamp: new Date().toISOString()
                  }
                },
                predictorData: resResult.predictorData || null,
                conservationData: resResult.conservationData || null,
                landscapeData: null,
                stringInteractions: resResult.stringInteractions || null,
                disruptionPredictor: resResult.disruptionPredictor || { level: "low" as const, reason: "Default", plddt: 100 },
                uniprotFeatures: resResult.uniprotFeatures,
                gnomadConstraint: resResult.gnomadConstraint,
                transcriptId: transcriptMeta?.transcriptId ?? resResult.predictorData?.transcriptId,
                isManeSelect: transcriptMeta?.isManeSelect ?? resResult.predictorData?.isManeSelect,
                isManePlusClinical: transcriptMeta?.isManePlusClinical ?? resResult.predictorData?.isManePlusClinical,
                isCanonical: transcriptMeta?.isCanonical ?? resResult.predictorData?.isCanonical,
                maneRefSeqId: transcriptMeta?.maneRefSeqId ?? resResult.predictorData?.maneRefSeqId,
                transcriptWarning: transcriptMeta?.transcriptWarning ?? resResult.transcriptWarning,
                gnomadFrequency: resResult.gnomadFrequency || null,
                aouFrequency: resResult.aouFrequency || null,
                esm2: resResult.esm2 || null,
                esm3Eval: { loading: true },
                esmcEval: { loading: true },
                esm2Eval: { loading: true },
                saprotEval: { loading: true }
              }
            });

            triggerNarrative(resResult);

            // Progressive query for Landscape Data
            console.log("[Pipeline] Starting progressive fetch for Landscape data...");
            apiClient.getLandscapeData({
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot
            }, activeSignal)
              .then((landscapeRes: any) => {
                if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;
                console.log("[Pipeline] Progressive Landscape data loaded successfully");
                setAnalysisState((prev: any) => {
                  if (!prev.result) return prev;
                  return {
                    ...prev,
                    result: {
                      ...prev.result,
                      landscapeData: landscapeRes.landscapeData
                    }
                  };
                });
              })
              .catch((landErr: any) => {
                if (!activeSignal.aborted) {
                  console.warn("[Pipeline Warning] Progressive landscape fetch failed:", landErr);
                }
              });

            // Progressive query for Deep Structural Models (ESM3, ESMC, ESM2-3B, SaProt)
            console.log("[Pipeline] Starting progressive fetch for heavy structural models...");
            apiClient.getStructuralAssessments({
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              acmgWeighting: settings.acmgWeighting
            }, activeSignal)
              .then((structRes: any) => {
                if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;
                console.log("[Pipeline] Progressive heavy structural models loaded successfully");
                setAnalysisState((prev: any) => {
                  if (!prev.result) return prev;
                  return {
                    ...prev,
                    result: {
                      ...prev.result,
                      esm3Eval: structRes.esm3Eval,
                      esmcEval: structRes.esmcEval,
                      esm2Eval: structRes.esm2Eval,
                      saprotEval: structRes.saprotEval,
                      ruleBasedInsights: structRes.ruleBasedInsights || prev.result.ruleBasedInsights
                    }
                  };
                });
              })
              .catch((structErr: any) => {
                if (!activeSignal.aborted) {
                  console.warn("[Pipeline Warning] Progressive structural assessments fetch failed:", structErr);
                  setAnalysisState((prev: any) => {
                    if (!prev.result) return prev;
                    return {
                      ...prev,
                      result: {
                        ...prev.result,
                        esm3Eval: { error: structErr.message || "Failed" },
                        esmcEval: { error: structErr.message || "Failed" },
                        esm2Eval: { error: structErr.message || "Failed" },
                        saprotEval: { error: structErr.message || "Failed" }
                      }
                    };
                  });
                }
              });

          } else {
            throw new Error("Biophysical result payload empty.");
          }
        })
        .catch((bpError: any) => {
          if (activeRequestIdRef.current === requestId) {
            setIsBiophysicalLoading(false);
            setIsClinicalLoading(false);
            setIsNarrativeLoading(false);
          }
          if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;

          setAnalysisState({
            isLoading: false,
            error: `Biophysical predictor data query failed: ${bpError?.message || "Unknown error"}`,
            result: {
              analysis: "Biophysical analysis data unavailable.",
              insights: null,
              isDemoData: false,
              ruleBasedInsights: null,
              metadata: {
                gene: targetGene,
                variant: targetVariant,
                uniprotId: targetUniprot,
                residueIndex: posMatch ? parseInt(posMatch[0], 10) : null,
                wildType: parsedResidues?.wt || "",
                mutant: parsedResidues?.mut || "",
                analysisVersion: {
                  thresholds: "ACMG v1.0.0-concordance",
                  geminiModel: "gemini-3.5-flash",
                  foldxVersion: "FoldX 5.0",
                  timestamp: new Date().toISOString()
                }
              },
              predictorData: null,
              conservationData: null,
              landscapeData: null,
              stringInteractions: null,
              disruptionPredictor: { level: "unknown" as const, reason: "Analysis query failed", plddt: null },
              uniprotFeatures: null,
              gnomadConstraint: null,
              transcriptId: transcriptMeta?.transcriptId,
              isManeSelect: transcriptMeta?.isManeSelect,
              isManePlusClinical: transcriptMeta?.isManePlusClinical,
              isCanonical: transcriptMeta?.isCanonical,
              maneRefSeqId: transcriptMeta?.maneRefSeqId,
              transcriptWarning: transcriptMeta?.transcriptWarning,
              gnomadFrequency: null,
              aouFrequency: null,
              esm2: null,
              esm3Eval: null,
              esmcEval: null,
              esm2Eval: null,
              saprotEval: null
            }
          });
          
          triggerNarrative(null);
        });
    } catch (err: any) {
      if (!activeSignal.aborted && err.name !== "AbortError") {
        console.error("[Pipeline Error] Analysis failed:", err);
      }
      if (activeRequestIdRef.current === requestId) {
        setIsBiophysicalLoading(false);
        setIsClinicalLoading(false);
        setIsNarrativeLoading(false);
      }
      if (activeSignal.aborted || err.name === "AbortError") return;

      const key = `${targetUniprot}_${targetVariant}`;
      if (FALLBACK_ANALYSES[key] && !settings.geminiSessionId) {
        const mutMatch = targetVariant.match(/\d+/);
        setAnalysisState({
          isLoading: false,
          error: null,
          result: {
            analysis: FALLBACK_ANALYSES[key],
            insights: FALLBACK_INSIGHTS[key] || null,
            isDemoData: true,
            metadata: {
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              residueIndex: mutMatch ? parseInt(mutMatch[0], 10) : null,
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
        const parsedRes = parseMutationResidues(targetVariant);
        const mutMatch = targetVariant.match(/\d+/);
        const posVal = mutMatch ? parseInt(mutMatch[0], 10) : null;
        setAnalysisState({
          isLoading: false,
          error: `Analysis query error: ${err.message || "Unknown error."}`,
          result: {
            isDemoData: false,
            metadata: {
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              residueIndex: posVal,
              wildType: parsedRes?.wt || "",
              mutant: parsedRes?.mut || "",
              pdbId: null,
              pdbSource: "AlphaFold",
              analysisVersion: {
                thresholds: "ACMG v1.0.0-concordance",
                geminiModel: "gemini-3.5-flash",
                foldxVersion: "FoldX 5.0",
                timestamp: new Date().toISOString()
              }
            },
            insights: {
              biochemicalShift: `⚠️ **Biochemical Shift Unavailable** (${err.message || "Failed"})`,
              structuralImpact: `⚠️ **Structural Impact Unavailable** (${err.message || "Failed"})`,
              acmgCriteria: [],
              plausibility: ""
            }
          }
        });
      }
    }
  };

  return {
    analysisAbortRef,
    mutantFoldAbortRef,
    compareFoldAbortRef,
    pendingResiduesRef,
    activeRequestIdRef,
    homologs, setHomologs,
    isHomologsLoading, setIsHomologsLoading,
    computedResiduesCache, setComputedResiduesCache,
    disruptionPredictor, setDisruptionPredictor,
    abortAllPendingRequests,
    translateVariantNotation,
    fetchHomologs,
    fetchNearestResidues,
    fetchPocketData,
    executeAnalysis
  };
}

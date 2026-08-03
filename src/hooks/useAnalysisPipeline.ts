import { useState, useRef, useCallback } from "react";
import { PdbHomolog, NearestResidue } from "../types";
import {
  getDeduplicatedPromise,
  translateVariantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  parseMutationResidues
} from "../variantAnalysisUtils";
import { FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "../data";

export interface UseAnalysisPipelineOptions {
  fetchWithAuth: (url: string, options?: any) => Promise<Response>;
  settings: any;
  userDirections: string;
  setAnalysisState: React.Dispatch<React.SetStateAction<any>>;
  setLoadingStep: (step: string) => void;
  setIsBiophysicalLoading: (loading: boolean) => void;
  setIsClinicalLoading: (loading: boolean) => void;
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
}

export function useAnalysisPipeline() {
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
    options: Pick<UseAnalysisPipelineOptions, "fetchWithAuth" | "setAnalysisState" | "setLoadingStep">
  ) => {
    options.setAnalysisState((prev: any) => ({ ...prev, isLoading: true, error: null }));
    options.setLoadingStep("Step 1/4: Translating cDNA variant notation via Ensembl VEP...");

    try {
      const response = await options.fetchWithAuth("/api/v1/translate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: notation }),
        signal
      });

      const resText = await response.text();
      if (!response.ok) {
        let errMsg = `Failed to translate cDNA notation (${response.status})`;
        try {
          const errJson = JSON.parse(resText);
          if (errJson.error) errMsg = errJson.error;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = translateVariantResponseSchema.parse(JSON.parse(resText));
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
      if (signal.aborted) throw err;
      throw new Error(`cDNA Translation error: ${err.message || "Failed to translate notation"}`);
    }
  };

  const fetchHomologs = useCallback(async (
    targetUniprot: string,
    fetchWithAuth: (url: string, options?: any) => Promise<Response>,
    signal?: AbortSignal
  ) => {
    setIsHomologsLoading(true);
    setHomologs([]);
    try {
      const res = await fetchWithAuth(`/api/v1/homologs/${encodeURIComponent(targetUniprot)}`, { signal });
      if (!res.ok) {
        throw new Error(`Homolog API returned status ${res.status}`);
      }
      const data = await res.json();
      if (!signal?.aborted && Array.isArray(data.homologs)) {
        setHomologs(data.homologs);
      }
    } catch (err: any) {
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
    fetchWithAuth: (url: string, options?: any) => Promise<Response>,
    signal?: AbortSignal
  ) => {
    const cacheKey = `${targetUniprot}_${residueIndex}`;

    if (computedResiduesCache[cacheKey]) return;
    if (pendingResiduesRef.current.has(cacheKey)) return;

    pendingResiduesRef.current.add(cacheKey);
    try {
      const res = await fetchWithAuth("/api/v1/nearest-residues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdbText,
          targetIndex: residueIndex,
          n: 5
        }),
        signal
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch nearest residues: ${res.status}`);
      }
      const data = await res.json();
      const validatedData = nearestResiduesResponseSchema.parse(data);

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
    fetchWithAuth: (url: string, options?: any) => Promise<Response>,
    setIsPocketLoading: (loading: boolean) => void,
    setPocketError: (err: string | null) => void,
    setComputedPocket: (pocket: any) => void,
    signal?: AbortSignal
  ) => {
    setIsPocketLoading(true);
    setPocketError(null);
    try {
      const res = await fetchWithAuth("/api/v1/pocket-finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdbText, targetIndex: residueIndex }),
        signal
      });
      if (!res.ok) throw new Error(`Could not fetch binding pocket (status: ${res.status})`);
      const data = await res.json();
      const validatedData = pocketFinderResponseSchema.parse(data);
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
      settings,
      userDirections,
      setAnalysisState,
      setLoadingStep,
      setIsBiophysicalLoading,
      setIsClinicalLoading,
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
      clearDynaMutComparePoll
    } = options;

    const requestId = ++activeRequestIdRef.current;
    abortAllPendingRequests(clearDynaMutPoll, clearDynaMutComparePoll);
    activeRequestIdRef.current = requestId;

    let activeSignal: AbortSignal;
    if (providedSignal) {
      activeSignal = providedSignal;
    } else {
      const controller = new AbortController();
      analysisAbortRef.current = controller;
      activeSignal = controller.signal;
    }

    setAnalysisState({ isLoading: true, error: null, result: null });
    setIsBiophysicalLoading(true);
    setIsClinicalLoading(true);

    let targetGene = targetGeneArg.trim();
    let targetVariant = targetVariantArg.trim();
    let targetUniprot = (targetUniprotArg || "").trim();
    let transcriptMeta: any = null;

    try {
      const isCdnaOrVcf = /^c\./i.test(targetVariant) || /^g\./i.test(targetVariant) || /^\d+:/.test(targetVariant) || /^chr/i.test(targetVariant);
      if (isCdnaOrVcf) {
        const transResult = await translateVariantNotation(targetVariant, activeSignal, { fetchWithAuth, setAnalysisState, setLoadingStep });
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
      fetchHomologs(targetUniprot, fetchWithAuth, activeSignal);

      const posMatch = targetVariant.match(/\d+/);
      const posQuery = posMatch ? `?pos=${posMatch[0]}` : "";

      setLoadingStep("Step 2/4: Fetching AlphaFold & PDB 3D structures...");
      const pdbKey = `warmup_${targetGene}_${targetVariant}_${targetUniprot}`;
      const pdbWarmupPromise = getDeduplicatedPromise(pdbKey, () =>
        fetchWithAuth(`/api/v1/pdb/${encodeURIComponent(targetUniprot)}${posQuery}`, { signal: activeSignal })
          .then(async res => {
            if (!res.ok) return null;
            const data = await res.json();
            return data.pdbText || null;
          })
          .catch(() => null)
      );

      setLoadingStep("Step 3/4: Calculating ESM-2 & FoldX biophysical metrics...");
      const bpKey = `biophysical_${targetGene}_${targetVariant}_${targetUniprot}`;
      const biophysicalPromise = getDeduplicatedPromise(bpKey, () =>
        fetchWithAuth("/api/v1/analyze-variant-biophysical", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gene: targetGene,
            variant: targetVariant,
            uniprotId: targetUniprot
          }),
          signal: activeSignal
        }).then(async res => {
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Biophysical analysis returned ${res.status}`);
          }
          return res.json();
        })
      );

      pdbWarmupPromise.then(pdb => {
        if (pdb && activeRequestIdRef.current === requestId && !activeSignal.aborted) {
          setPdbText(pdb);
        }
      });

      const biophysicalResult = await biophysicalPromise;
      if (activeRequestIdRef.current !== requestId || activeSignal.aborted) return;

      setIsBiophysicalLoading(false);

      const parsedResidues = parseMutationResidues(targetVariant);

      setAnalysisState({
        isLoading: false,
        error: null,
        result: {
          analysis: biophysicalResult.analysis || "Analysis completed.",
          insights: biophysicalResult.insights || null,
          isDemoData: false,
          ruleBasedInsights: biophysicalResult.ruleBasedInsights || null,
          metadata: biophysicalResult.metadata || {
            gene: targetGene,
            variant: targetVariant,
            uniprotId: targetUniprot,
            residueIndex: posMatch ? parseInt(posMatch[0], 10) : null,
            wildType: parsedResidues?.wt || "",
            mutant: parsedResidues?.mut || "",
            analysisVersion: {
              thresholds: "ACMG v1.0.0-concordance",
              geminiModel: "gemini-2.5-flash",
              foldxVersion: "FoldX 5.0",
              timestamp: new Date().toISOString()
            }
          },
          predictorData: biophysicalResult.predictorData || null,
          conservationData: biophysicalResult.conservationData || null,
          landscapeData: biophysicalResult.landscapeData || null,
          stringInteractions: biophysicalResult.stringInteractions || null,
          disruptionPredictor: biophysicalResult.disruptionPredictor || { level: "low" as const, reason: "Default", plddt: 100 },
          uniprotFeatures: biophysicalResult.uniprotFeatures,
          gnomadConstraint: biophysicalResult.gnomadConstraint,
          transcriptId: transcriptMeta?.transcriptId ?? biophysicalResult.predictorData?.transcriptId,
          isManeSelect: transcriptMeta?.isManeSelect ?? biophysicalResult.predictorData?.isManeSelect,
          isManePlusClinical: transcriptMeta?.isManePlusClinical ?? biophysicalResult.predictorData?.isManePlusClinical,
          isCanonical: transcriptMeta?.isCanonical ?? biophysicalResult.predictorData?.isCanonical,
          maneRefSeqId: transcriptMeta?.maneRefSeqId ?? biophysicalResult.predictorData?.maneRefSeqId,
          transcriptWarning: transcriptMeta?.transcriptWarning ?? biophysicalResult.transcriptWarning,
          gnomadFrequency: biophysicalResult.gnomadFrequency || null,
          aouFrequency: biophysicalResult.aouFrequency || null,
          esm2: biophysicalResult.esm2 || null,
          esm3Eval: biophysicalResult.esm3Eval || null,
          esmcEval: biophysicalResult.esmcEval || null,
          esm2Eval: biophysicalResult.esm2Eval || null,
          saprotEval: biophysicalResult.saprotEval || null
        }
      });
      addToHistory(targetGene, targetVariant, targetUniprot);

      if (posMatch) {
        setSelectedResidueIndex(parseInt(posMatch[0], 10));
      }

      setLoadingStep("Step 4/4: Generating AI clinical narrative...");
      (async () => {
        try {
          const narrativeResponse = await fetchWithAuth("/api/v1/analyze-variant-narrative", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              userDirections: userDirections || undefined,
              acmgWeighting: settings.acmgWeighting,
              clinvar: biophysicalResult.clinvar,
              predictorData: biophysicalResult.predictorData,
              conservationData: biophysicalResult.conservationData,
              stringInteractions: biophysicalResult.stringInteractions,
              gnomadConstraint: biophysicalResult.gnomadConstraint,
              gnomadFrequency: biophysicalResult.gnomadFrequency,
              uniprotFeatures: biophysicalResult.uniprotFeatures,
              sequence: biophysicalResult.metadata?.sequence || null
            }),
            signal: activeSignal
          });
          if (narrativeResponse.ok) {
            const narrativeData = await narrativeResponse.json();
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
          }
        } catch (narrativeErr: any) {
          if (!activeSignal.aborted) {
            console.error("Narrative fetch failed:", narrativeErr);
          }
        } finally {
          setIsClinicalLoading(false);
        }
      })();
    } catch (err: any) {
      setIsBiophysicalLoading(false);
      setIsClinicalLoading(false);
      if (activeSignal.aborted) return;

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
                geminiModel: "gemini-2.5-flash",
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
                geminiModel: "gemini-2.5-flash",
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

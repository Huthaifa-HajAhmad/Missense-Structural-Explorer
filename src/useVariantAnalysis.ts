import { useState, useEffect, useRef, useCallback, useMemo } from "react";
export * from './variantAnalysisUtils';
import {
  getDeduplicatedPromise,
  analyzeVariantResponseSchema,
  generateMutantResponseSchema,
  nearestResiduesResponseSchema,
  pocketFinderResponseSchema,
  resolveGeneResponseSchema,
  translateVariantResponseSchema,
  buildEnergeticsQueryString,
  isVcfOrCdnaNotation,
  AMINO_ACID_NAMES_MAP,
  AMINO_ACID_PROPERTIES,
  parseMutationResidues,
  getAlternativeVariants,
  fetchWithRetry,
  getErrorMessage,
  STORAGE_KEY
} from './variantAnalysisUtils';

import { VARIANT_PRESETS, FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "./data";
import { AnalysisState, VariantPreset, UserSettings, AnalysisResult, NearestResidue, PocketResult, EnergeticsData, StructuralDiffResult, BiophysicalApiResponse, AcmgVerdict, ACMGCriteriaItem, PdbHomolog } from "./types";
import { useSettings } from "./context/SettingsContext";
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";
import { useSearchHistory } from "./hooks/useSearchHistory";
import { useBiophysicalModeling } from "./hooks/useBiophysicalModeling";
import { usePredictorData } from "./hooks/usePredictorData";
import { useClinicalEvidence } from "./hooks/useClinicalEvidence";
import { computeConsensusVerdict } from "./shared/thresholds";
export default function useVariantAnalysis() {
  const {
    theme,
    isDark,
    setTheme,
    toggleTheme,
    settings,
    setSettings,
    updateSetting,
    resetSettingsToDefault,
    showPolarContacts,
    setShowPolarContacts,
    isSettingsOpen,
    setIsSettingsOpen,
  } = useSettings();

  const analysisAbortRef = useRef<AbortController | null>(null);
  const mutantFoldAbortRef = useRef<AbortController | null>(null);
  const compareFoldAbortRef = useRef<AbortController | null>(null);
  const pendingResiduesRef = useRef<Set<string>>(new Set());
  const activeRequestIdRef = useRef<number>(0);

  const fetchWithAuth = useCallback(async (
    url: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<Response> => {
    const headers = { ...(options.headers as Record<string, string> || {}) };
    if (settings.geminiSessionId) {
      headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
    }
    if (settings.appApiToken) {
      headers["Authorization"] = `Bearer ${settings.appApiToken}`;
    }
    if (settings.biohubApiToken) {
      headers["x-biohub-token"] = settings.biohubApiToken;
    }
    if (settings.tamarindApiKey) {
      headers["x-tamarind-api-key"] = settings.tamarindApiKey;
    }
    
    let response = await fetchWithRetry(url, { ...options, headers });
    
    // Attempt re-auth if 401 is returned (e.g., SESSION_EXPIRED) and we have an API key
    if (response.status === 401 && settings.geminiApiKey) {
      if (import.meta.env.DEV) {
        console.warn(`Auth failed (401) for ${url}, attempting transparent re-authentication...`);
      }
      try {
        const reauthHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (settings.appApiToken) {
          reauthHeaders["Authorization"] = `Bearer ${settings.appApiToken}`;
        }
        const sessionRes = await fetch("/api/v1/session/keys", {
          method: "POST",
          headers: reauthHeaders,
          body: JSON.stringify({ apiKey: settings.geminiApiKey }),
          signal: options.signal
        });
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData.sessionId) {
            updateSetting("geminiSessionId", sessionData.sessionId);
            updateSetting("geminiSessionExpiresAt", sessionData.expiresAt || (Date.now() + 3600000));
            
            // Retry original request with the new session ID and bearer token
            const retryHeaders: Record<string, string> = {
              ...headers,
              "X-Gemini-Session-ID": sessionData.sessionId
            };
            if (settings.appApiToken) {
              retryHeaders["Authorization"] = `Bearer ${settings.appApiToken}`;
            }
            if (settings.biohubApiToken) {
              retryHeaders["x-biohub-token"] = settings.biohubApiToken;
            }
            response = await fetchWithRetry(url, { ...options, headers: retryHeaders });
          }
        }
      } catch (reauthErr) {
        console.error("Transparent re-authentication failed:", reauthErr);
      }
    }
    
    return response;
  }, [settings.geminiSessionId, settings.geminiApiKey, settings.appApiToken, settings.biohubApiToken, updateSetting]);

  const abortAllPendingRequests = () => {
    activeRequestIdRef.current += 1;
    clearDynaMutPoll();
    clearDynaMutComparePoll();
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

  // Styling Classes — Claude Science Design System
  // Light: warm cream bg (#F9F8F6), white cards, warm borders (#E5E1DC), clay accent (#C46849)
  // Dark:  warm charcoal bg (#191816), surface (#2A2724), border (#3C3934)
  const classRoot = isDark
    ? "bg-[#191816] text-[#F9F8F6]"
    : "bg-[#F9F8F6] text-[#191816]";
  const classHeader = isDark
    ? "bg-[#2A2724] border-[#3C3934]"
    : "bg-white border-[#E5E1DC] shadow-[0_1px_0_0_#E5E1DC]";
  const classHeaderTitle = isDark ? "text-[#F9F8F6]" : "text-[#191816]";
  const classHeaderSub   = isDark ? "text-[#827B70]" : "text-[#8F897E]";

  const classCard = isDark
    ? "bg-[#2A2724] border border-[#3C3934] shadow-[0_2px_8px_rgba(0,0,0,0.5)] rounded-xl"
    : "bg-white border border-[#E5E1DC] shadow-[0_1px_3px_rgba(25,24,22,0.04)] rounded-xl";
  const classCardHeader = isDark
    ? "text-[#F9F8F6] pb-3 border-b border-[#3C3934]"
    : "text-[#191816] pb-3 border-b border-[#ECEAE4]";
  const classCardTitle    = isDark ? "text-[#F9F8F6]" : "text-[#191816]";
  const classCardSubText  = isDark ? "text-[#B2ABA0]" : "text-[#666055]";
  const classTextMute     = isDark ? "text-[#827B70]" : "text-[#8F897E]";
  const classTextBody     = isDark ? "text-[#B2ABA0]" : "text-[#666055]";
  const classTextBright   = isDark ? "text-[#F9F8F6] font-bold" : "text-[#191816] font-bold";
  const classBorderSec    = isDark ? "border-[#3C3934]/60" : "border-[#ECEAE4]";
  const classBorderCardSep = isDark ? "border-[#3C3934]" : "border-[#E5E1DC]";

  const classInput = isDark
    ? "bg-[#201E1B] border-[#3C3934] text-[#F9F8F6] placeholder-[#827B70] focus:border-[#C46849]"
    : "bg-white border-[#E5E1DC] text-[#191816] placeholder-[#8F897E] focus:border-[#C46849] focus:bg-white";
  const classInputLabel  = isDark ? "text-[#F9F8F6]" : "text-[#191816]";
  const classBadgeAccent = isDark
    ? "bg-[#C46849]/10 text-[#D4836A] border border-[#C46849]/20"
    : "bg-[#FBF0EB] text-[#C46849] border border-[#F5DDD3]";
  const classSubCard = isDark
    ? "bg-[#201E1B]/60 border-[#3C3934]/60 text-[#B2ABA0]"
    : "bg-[#FAF9F6] border-[#ECEAE4] text-[#666055]";

  const [gene, setGene] = useState("");
  const { history, setHistory, addToHistory, clearHistory } = useSearchHistory(settings.maxHistoryItems, settings.saveHistory);

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
  const [homologs, setHomologs] = useState<PdbHomolog[]>([]);
  const [isHomologsLoading, setIsHomologsLoading] = useState(false);

  const [viewMode, setViewMode] = useState<"wildtype" | "mutant">("wildtype");
  const [disruptionPredictor, setDisruptionPredictor] = useState<{ level: "high" | "low"; reason: string; plddt: number } | null>(null);

  const [notifications, setNotifications] = useState<{ id: string; type: "success" | "info" | "error"; message: string }[]>([]);
  const [esmFoldPdb, setEsmFoldPdb] = useState<string | null>(null);
  const [isEsmFolding, setIsEsmFolding] = useState<boolean>(false);
  const [esmFoldingError, setEsmFoldingError] = useState<string | null>(null);
  const [active3dModelTab, setActive3dModelTab] = useState<"alphafold2" | "esmfold2">("alphafold2");

  const addNotification = useCallback((type: "success" | "info" | "error", message: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 6000);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const biophysical = useBiophysicalModeling(settings, addNotification, fetchWithAuth);
  const {
    mutantPdb, setMutantPdb, foldedResidueIndex, setFoldedResidueIndex,
    isFolding, setIsFolding, foldingError, setFoldingError,
    foldingStatus, setFoldingStatus, foldingDdG, setFoldingDdG,
    foldingEnergetics, setFoldingEnergetics,
    compareMode, setCompareMode,
    compareVariant, setCompareVariant,
    compareMutantPdb, setCompareMutantPdb,
    compareFoldedResidueIndex, setCompareFoldedResidueIndex,
    isFoldingCompare, setIsFoldingCompare,
    foldingCompareError, setFoldingCompareError,
    compareFoldingStatus, setCompareFoldingStatus,
    compareFoldingDdG, setCompareFoldingDdG,
    compareFoldingEnergetics, setCompareFoldingEnergetics,
    comparisonLayout, setComparisonLayout,
    dynamut2Status, setDynamut2Status,
    compareDynamut2Status, setCompareDynamut2Status,
    ddmutStatus, setDdmutStatus,
    compareDdmutStatus, setCompareDdmutStatus,
    thermompnnStatus, setThermompnnStatus,
    compareThermompnnStatus, setCompareThermompnnStatus,
    dynamut2JobId, setDynamut2JobId,
    compareDynamut2JobId, setCompareDynamut2JobId,
    ddmutJobId, setDdmutJobId,
    compareDdmutJobId, setCompareDdmutJobId,
    thermompnnJobId, setThermompnnJobId,
    compareThermompnnJobId, setCompareThermompnnJobId,
    structuralDiff, setStructuralDiff,
    compareStructuralDiff, setCompareStructuralDiff,
    computedPocket, setComputedPocket,
    isPocketLoading, setIsPocketLoading,
    pocketError, setPocketError,
    dynamutPollIntervalRef, dynamutComparePollIntervalRef,
    ddmutPollIntervalRef, ddmutComparePollIntervalRef,
    thermompnnPollIntervalRef, thermompnnComparePollIntervalRef,
    lastFetchedFoldRef,
    clearDynaMutPoll, clearDynaMutComparePoll,
    clearDdmutPoll, clearDdmutComparePoll,
    clearThermoMpnnPoll, clearThermoMpnnComparePoll,
    fetchPocketInfo
  } = biophysical;

  const currentGeneRef = useRef(gene);
  const currentVariantRef = useRef(variant);
  const currentCompareVariantRef = useRef(compareVariant);
  const foldingEnergeticsRef = useRef(foldingEnergetics);
  const compareFoldingEnergeticsRef = useRef(compareFoldingEnergetics);
  useEffect(() => {
    currentGeneRef.current = gene;
    currentVariantRef.current = variant;
    currentCompareVariantRef.current = compareVariant;
    foldingEnergeticsRef.current = foldingEnergetics;
    compareFoldingEnergeticsRef.current = compareFoldingEnergetics;
  }, [gene, variant, compareVariant, foldingEnergetics, compareFoldingEnergetics]);

  const predictor = usePredictorData();
  const {
    analysisState, setAnalysisState,
    loadingStep, setLoadingStep,
    isBiophysicalLoading, setIsBiophysicalLoading,
    isClinicalLoading, setIsClinicalLoading
  } = predictor;

  const clinical = useClinicalEvidence();
  const {
    triageOverride, setTriageOverride
  } = clinical;

  useEffect(() => {
    return () => {
      clearDynaMutPoll();
      clearDynaMutComparePoll();
      clearDdmutPoll();
      clearDdmutComparePoll();
    };
  }, [clearDynaMutPoll, clearDynaMutComparePoll, clearDdmutPoll, clearDdmutComparePoll]);

  const [pdbText, setPdbText] = useState<string | null>(null);

  const resetViewerState = () => {
    clearDynaMutPoll();
    clearDynaMutComparePoll();
    setViewMode("wildtype");
    setMutantPdb(null);
    setEsmFoldPdb(null);
    setIsEsmFolding(false);
    setEsmFoldingError(null);
    setFoldedResidueIndex(null);
    setFoldingError(null);
    setFoldingStatus(null);
    setFoldingDdG(null);
    setFoldingEnergetics(null);
    setDynamut2Status(null);
    setCompareMode(false);
    setCompareVariant("p.Arg408Pro");
    setCompareMutantPdb(null);
    setCompareFoldedResidueIndex(null);
    setIsFolding(false);
    setIsFoldingCompare(false);
    setFoldingCompareError(null);
    setCompareFoldingStatus(null);
    setCompareFoldingDdG(null);
    setCompareFoldingEnergetics(null);
    setCompareDynamut2Status(null);
    setPdbText(null);
    setComputedPocket(null);
    setIsPocketLoading(false);
    lastFetchedFoldRef.current = "";
    setPocketError(null);
  };

  const [isHowToInspectOpen, setIsHowToInspectOpen] = useState<boolean>(false);
  const [isLegendOpen, setIsLegendOpen] = useState<boolean>(false);

  const formatEnergyString = (text: string | null | undefined): string => {
    if (!text) return "";
    if (settings.energyUnit === "kcal/mol") return text;
    return text.replace(/([-+]?\d+(?:\.\d+)?)\s*kcal\/mol(?!\s*\[~[^\]]*kJ\/mol\])/gi, (match, valStr) => {
      if (valStr) {
        const kcal = parseFloat(valStr);
        const kj = kcal * 4.184;
        return `${match} [~${kj.toFixed(1)} kJ/mol]`;
      }
      return match;
    });
  };

  const [computedResiduesCache, setComputedResiduesCache] = useState<Record<string, NearestResidue[]>>({});

  const handleSelectHistoryItem = (item: { gene: string; variant: string; uniprotId: string }) => {
    abortAllPendingRequests();

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    setGene(item.gene);
    setVariant(item.variant);
    setUniprotId(item.uniprotId);
    setSearchVal(`${item.gene} ${item.variant}`);
    setCustomGene(item.gene);
    setCustomVariant(item.variant);
    setCustomUniprot(item.uniprotId);
    setCustomPdbUrl(null);

    // Clear mutant states
    resetViewerState();

    const mutMatch = item.variant.match(/\d+/);
    if (mutMatch) {
      setSelectedResidueIndex(parseInt(mutMatch[0], 10));
    } else {
      setSelectedResidueIndex(null);
    }

    executeAnalysis(item.gene, item.variant, item.uniprotId, activeSignal);
  };

  const handleSelectPreset = (preset: VariantPreset) => {
    abortAllPendingRequests();

    setGene(preset.gene);
    setVariant(preset.variant);
    setUniprotId(preset.uniprotId);
    setSearchVal(`${preset.gene} ${preset.variant}`);
    setCustomPdbUrl(null);
    
    // Clear mutant states when switching presets
    resetViewerState();
    
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
      setAnalysisState({
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
              geminiModel: "gemini-2.5-flash",
              foldxVersion: "FoldX 5.0",
              timestamp: new Date().toISOString()
            }
          }
        }
      });
    } else {
      setAnalysisState({
        isLoading: false,
        error: null,
        result: null
      });
    }
  };

  const translateVariantNotation = async (notation: string, signal: AbortSignal) => {
    setAnalysisState(prev => ({ ...prev, isLoading: true, error: null }));
    setLoadingStep("Step 1/4: Translating cDNA variant notation via Ensembl VEP...");
    
    try {
      const response = await fetchWithAuth("/api/v1/translate-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variant: notation }),
        signal
      });

      const resText = await response.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse translation response: ${parseErr.message}`);
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Coordinate translation failed."));
      }

      return translateVariantResponseSchema.parse(data);
    } catch (err: any) {
      if (signal.aborted) {
        throw err;
      }
      throw new Error(`Translation Error: ${err.message}`);
    }
  };

  const executeAnalysis = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal, originalNotation?: string) => {
    try {
      parseMutationResidues(targetVariant);
    } catch (err: any) {
      setAnalysisState({
        isLoading: false,
        error: `Validation Error: ${err.message}`,
        result: null
      });
      return;
    }

    const requestId = ++activeRequestIdRef.current;

    let activeSignal = signal;
    if (!activeSignal) {
      if (analysisAbortRef.current) {
        analysisAbortRef.current.abort();
      }
      const controller = new AbortController();
      analysisAbortRef.current = controller;
      activeSignal = controller.signal;
    }

    setAnalysisState({ isLoading: true, error: null, result: null });
    setIsBiophysicalLoading(true);
    setIsClinicalLoading(true);
    fetchHomologs(targetUniprot, activeSignal);
    
    // Clear structural model comparison states for fresh run
    setViewMode("wildtype");
    setDisruptionPredictor(null);
    setTriageOverride(false);
    setMutantPdb(null);
    setFoldedResidueIndex(null);
    setFoldingError(null);
    setEsmFoldPdb(null);
    setIsEsmFolding(false);
    setEsmFoldingError(null);
    
    // Set initial stateful loader step
    setLoadingStep("Step 2/4: Loading 3D structural templates & sequence features...");

    let biophysicalResult: BiophysicalApiResponse | null = null;
    let biophysicalError: string | null = null;

    try {
      // Trigger FoldX, DynaMut2, and DDMut calculations concurrently at start of search submission
      fetchMutantFold(targetGene, targetVariant, targetUniprot, activeSignal);

      // Parallelize fetching of EBI AlphaFold structure to warm cache (HIGH-9)
      const posMatch = targetVariant.match(/\d+/);
      const posQuery = posMatch ? `?pos=${posMatch[0]}` : "";
      const warmupHeaders: Record<string, string> = {};
      if (settings.geminiSessionId) {
        warmupHeaders["X-Gemini-Session-ID"] = settings.geminiSessionId;
      }
      if (settings.appApiToken) {
        warmupHeaders["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      
      const pdbKey = `warmup_${targetGene}_${targetVariant}_${targetUniprot}`;
      const pdbWarmupPromise = getDeduplicatedPromise(pdbKey, () =>
        fetch(`/api/v1/alphafold-pdb/${targetUniprot}${posQuery}`, {
          signal: activeSignal,
          headers: warmupHeaders
        }).then(async (res) => {
          if (!res.ok) throw new Error(`PDB fetch failed`);
          return res.text();
        })
      );
      
      pdbWarmupPromise.then(() => {
        setLoadingStep(prev => {
          if (prev.includes("Step 2/4")) {
            return "Step 3/4: Loaded AlphaFold structure. Running in-silico ensemble pipelines...";
          }
          return prev;
        });
      }).catch(err => {
        console.warn("AlphaFold PDB concurrent pre-fetch request failed or aborted:", err);
      });

      biophysicalResult = null;
      biophysicalError = null;

      // Concurrently kick off the biophysical description query so it resolves quickly in parallel
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
        }).then(async (res) => {
          if (!res.ok) {
            let errorMsg = "The biophysical analysis request failed.";
            try {
              const errData = await res.json();
              if (errData?.error?.message) {
                errorMsg = errData.error.message;
              }
            } catch (_) {}
            throw new Error(errorMsg);
          }
          return res.json();
        })
      );

      biophysicalPromise.then((bpData) => {
        setIsBiophysicalLoading(false);
        biophysicalResult = bpData;
        setLoadingStep(prev => {
          if (prev.includes("Step 2/4") || prev.includes("Step 3/4")) {
            return "Step 4/4: Modeling biophysical force-fields and ACMG rule classifiers...";
          }
          return prev;
        });
        setAnalysisState(prev => {
          if (!prev.result) return prev;
          const prevInsights = prev.result.insights || {
            biochemicalShift: "",
            structuralImpact: "",
            acmgCriteria: [],
            plausibility: ""
          };
          return {
            ...prev,
            result: {
              ...prev.result,
              insights: {
                ...prevInsights,
                biochemicalShift: bpData.biochemicalShift,
                structuralImpact: bpData.structuralImpact
              }
            }
          };
        });
      }).catch(err => {
        setIsBiophysicalLoading(false);
        const errorMsg = err.message || "Unknown network error.";
        biophysicalError = errorMsg;
        console.warn("Parallel biophysical insights pre-fetch failed:", err);
        setAnalysisState(prev => {
          if (!prev.result) return prev;
          const prevInsights = prev.result.insights || {
            biochemicalShift: "",
            structuralImpact: "",
            acmgCriteria: [],
            plausibility: ""
          };
          return {
            ...prev,
            result: {
              ...prev.result,
              insights: {
                ...prevInsights,
                biochemicalShift: `⚠️ **Biophysical Shift Unavailable**\n\n${errorMsg}`,
                structuralImpact: `⚠️ **Structural Impact Unavailable**\n\n${errorMsg}`
              }
            }
          };
        });
      });

      const analyzeKey = `analyze_${targetGene}_${targetVariant}_${targetUniprot}_${userDirections || ""}`;
      const analyzePromise = getDeduplicatedPromise(analyzeKey, () =>
        fetchWithAuth("/api/v1/analyze-variant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gene: targetGene,
            variant: targetVariant,
            uniprotId: targetUniprot,
            userDirections: userDirections || undefined,
            acmgWeighting: settings.acmgWeighting,
            originalNotation: originalNotation || undefined
          }),
          signal: activeSignal
        }).then(async (res) => {
          const resText = await res.text();
          let data: any = null;
          try {
            data = JSON.parse(resText);
          } catch (e: any) {
            if (!res.ok) {
              throw new Error(`Genomic analysis endpoint failed (status: ${res.status}).`);
            }
            throw new Error("Failed to parse response JSON.");
          }
          if (!res.ok) {
            throw new Error(getErrorMessage(data, "Genomic analysis endpoint failed."));
          }
          return analyzeVariantResponseSchema.parse(data);
        })
      );

      const validatedData = await analyzePromise;


      const predictorVal = validatedData.disruptionPredictor || { level: "low" as const, reason: "PDB structure mapping not resolved", plddt: 100 };
      setDisruptionPredictor(predictorVal);
      setTriageOverride(false);

      // Build initial insights incorporating buffered biophysical results or error messages to prevent data race drops (FE-2)
      let initialInsights: any = null;
      if (biophysicalResult) {
        const bp = biophysicalResult as BiophysicalApiResponse;
        initialInsights = {
          biochemicalShift: bp.biochemicalShift,
          structuralImpact: bp.structuralImpact,
          acmgCriteria: [],
          plausibility: ""
        };
      } else if (biophysicalError) {
        initialInsights = {
          biochemicalShift: `⚠️ **Biophysical Shift Unavailable**\n\n${biophysicalError}`,
          structuralImpact: `⚠️ **Structural Impact Unavailable**\n\n${biophysicalError}`,
          acmgCriteria: [],
          plausibility: ""
        };
      }

      setAnalysisState({
        isLoading: false,
        error: null,
        result: {
          analysis: null,
          insights: initialInsights,
          ruleBasedInsights: validatedData.ruleBasedInsights ? {
            plausibility: validatedData.ruleBasedInsights.plausibility,
            acmgVerdict: validatedData.ruleBasedInsights.acmgVerdict as AcmgVerdict,
            acmgCriteria: validatedData.ruleBasedInsights.acmgCriteria as ACMGCriteriaItem[],
            partialEvidence: validatedData.ruleBasedInsights.partialEvidence
          } : null,
          clinvar: validatedData.clinvar ? {
            classification: validatedData.clinvar.classification,
            lastEvaluated: validatedData.clinvar.lastEvaluated,
            reviewStatus: validatedData.clinvar.reviewStatus,
            alleleFrequencies: validatedData.clinvar.alleleFrequencies.map(af => ({
              source: af.source,
              value: af.value
            })),
            trait: validatedData.clinvar.trait,
            uid: validatedData.clinvar.uid
          } : null,
          isDemoData: false,
          metadata: {
            gene: validatedData.metadata.gene,
            variant: validatedData.metadata.variant,
            uniprotId: validatedData.metadata.uniprotId,
            residueIndex: validatedData.metadata.residueIndex,
            wildType: validatedData.metadata.wildType,
            mutant: validatedData.metadata.mutant,
            pdbId: validatedData.metadata.pdbId || null,
            pdbSource: validatedData.metadata.pdbSource || null,
            analysisVersion: {
              thresholds: "ACMG v1.0.0-concordance",
              geminiModel: "gemini-2.5-flash",
              foldxVersion: "FoldX 5.0",
              timestamp: new Date().toISOString()
            }
          },
          predictorData: validatedData.predictorData || null,
          conservationData: validatedData.conservationData || null,
          landscapeData: validatedData.landscapeData || null,
          stringInteractions: validatedData.stringInteractions || null,
          disruptionPredictor: predictorVal,
          uniprotFeatures: validatedData.uniprotFeatures,
          gnomadConstraint: validatedData.gnomadConstraint,
          transcriptId: validatedData.transcriptId,
          isCanonical: validatedData.isCanonical,
          transcriptWarning: validatedData.transcriptWarning,
          gnomadFrequency: validatedData.gnomadFrequency ? {
            maxAF: validatedData.gnomadFrequency.maxAF,
            groupMaxAF: validatedData.gnomadFrequency.groupMaxAF ?? null,
            genomeAF: validatedData.gnomadFrequency.genomeAF,
            exomeAF: validatedData.gnomadFrequency.exomeAF,
            nHomozygous: validatedData.gnomadFrequency.nHomozygous,
            dataset: validatedData.gnomadFrequency.dataset,
            genomeAC: validatedData.gnomadFrequency.genomeAC ?? null,
            exomeAC: validatedData.gnomadFrequency.exomeAC ?? null,
            genomeAN: validatedData.gnomadFrequency.genomeAN ?? null,
            exomeAN: validatedData.gnomadFrequency.exomeAN ?? null
          } : null,
          aouFrequency: validatedData.aouFrequency ? {
            aouAC: validatedData.aouFrequency.aouAC ?? null,
            aouAN: validatedData.aouFrequency.aouAN ?? null,
            aouHet: validatedData.aouFrequency.aouHet ?? null,
            aouHom: validatedData.aouFrequency.aouHom ?? null
          } : null,
          esm2: validatedData.esm2 || null,
          esm3Eval: validatedData.esm3Eval || null,
          esmcEval: validatedData.esmcEval || null
        }
      });
      addToHistory(targetGene, targetVariant, targetUniprot);

      if (validatedData.metadata?.residueIndex) {
        setSelectedResidueIndex(validatedData.metadata.residueIndex);
      }

      // Asynchronously fetch narrative to avoid blocking UI dashboard render
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
              clinvar: validatedData.clinvar,
              predictorData: validatedData.predictorData,
              conservationData: validatedData.conservationData,
              stringInteractions: validatedData.stringInteractions,
              gnomadConstraint: validatedData.gnomadConstraint,
              gnomadFrequency: validatedData.gnomadFrequency,
              uniprotFeatures: validatedData.uniprotFeatures,
              sequence: validatedData.metadata?.sequence || null
            }),
            signal: activeSignal
          });
          if (narrativeResponse.ok) {
            const narrativeData = await narrativeResponse.json();
            setAnalysisState(prev => {
              if (!prev.result) return prev;
              const prevInsights = prev.result.insights || {
                biochemicalShift: "",
                structuralImpact: "",
                acmgCriteria: [],
                plausibility: ""
              };
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
          } else {
            console.error("Narrative analysis response not ok:", narrativeResponse.status);
            setAnalysisState(prev => {
              if (!prev.result) return prev;
              const prevInsights = prev.result.insights || {
                biochemicalShift: "",
                structuralImpact: "",
                acmgCriteria: [],
                plausibility: ""
              };
              return {
                ...prev,
                result: {
                  ...prev.result,
                  analysis: "⚠️ **AI Narrative Explanation Unavailable**\n\nThe Gemini AI explanation service could not be loaded. Please retry.",
                  insights: {
                    ...prevInsights,
                    acmgCriteria: []
                  }
                }
              };
            });
          }
          setIsClinicalLoading(false);
        } catch (narrativeErr: any) {
          if (activeSignal.aborted) return;
          console.error("Narrative analysis request failed:", narrativeErr);
          setAnalysisState(prev => {
            if (!prev.result) return prev;
            const prevInsights = prev.result.insights || {
              biochemicalShift: "",
              structuralImpact: "",
              acmgCriteria: [],
              plausibility: ""
            };
            return {
              ...prev,
              result: {
                ...prev.result,
                analysis: `⚠️ **AI Narrative Explanation Unavailable**\n\nThe Gemini AI explanation service request failed (${narrativeErr.message}).`,
                insights: {
                  ...prevInsights,
                  acmgCriteria: []
                }
              }
            };
          });
        } finally {
          setIsClinicalLoading(false);
        }
      })();
    } catch (err: any) {
      setIsBiophysicalLoading(false);
      setIsClinicalLoading(false);
      
      if (activeSignal.aborted) {
        if (import.meta.env.DEV) {
          console.log("Analysis execution aborted.");
        }
        return;
      }

      if (import.meta.env.DEV) {
        console.error("Analysis execution error:", err);
      }
      
      const key = `${targetUniprot}_${targetVariant}`;
      if (FALLBACK_ANALYSES[key] && !settings.geminiSessionId) {
        if (import.meta.env.DEV) {
          console.log(`[Fallback] API failed or timed out. Gracefully falling back to preconfigured dataset for ${key}...`);
        }
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
        
        const partialResult = {
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
            biochemicalShift: (biophysicalResult as any)?.biochemicalShift || `⚠️ **Biochemical Shift Unavailable**\n\nThe primary variant database query failed: ${err.message || err}`,
            structuralImpact: (biophysicalResult as any)?.structuralImpact || `⚠️ **Structural Impact Unavailable**\n\nThe primary variant database query failed: ${err.message || err}`,
            acmgCriteria: [],
            plausibility: ""
          }
        };

        setAnalysisState({
          isLoading: false,
          error: `Database query failed: ${err.message || "Endpoint error."} Displaying partial biophysical structure and insights.`,
          result: partialResult
        });
      }
    }
  };

  const mapMutationToFoldXFormat = (variantStr: string): string => {
    const clean = variantStr.replace(/^p\./i, "");
    
    const normalize3 = (str: string) => {
      if (str.length !== 3) return str;
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    };

    const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
    if (match3) {
      const wt3 = normalize3(match3[1]);
      const pos = parseInt(match3[2], 10);
      const mut3 = normalize3(match3[3]);
      const wt = AMINO_ACID_3_TO_1[wt3];
      const mut = AMINO_ACID_3_TO_1[mut3];
      if (!wt || !mut) {
        throw new Error(`Invalid HGVS missense format: Unrecognized 3-letter amino acid code '${!wt ? wt3 : mut3}'`);
      }
      return `${wt}A${pos}${mut}`;
    }

    const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
    if (match1) {
      const wt = match1[1].toUpperCase();
      const pos = match1[2];
      const mut = match1[3].toUpperCase();
      if (!AMINO_ACID_1_TO_3[wt] || !AMINO_ACID_1_TO_3[mut]) {
        throw new Error(`Invalid HGVS missense format: Unrecognized 1-letter amino acid code '${!AMINO_ACID_1_TO_3[wt] ? wt : mut}'`);
      }
      return `${wt}A${pos}${mut}`;
    }

    throw new Error("Invalid HGVS missense format: Must represent a single amino acid substitution (e.g., p.Arg215Trp or R215W)");
  };

  const fetchPocketData = useCallback(async (
    targetUniprot: string,
    residueIndex: number,
    pdbText: string,
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
  }, [settings.geminiSessionId]);

  useEffect(() => {
    if (pdbText && uniprotId && selectedResidueIndex !== null) {
      const controller = new AbortController();
      fetchPocketData(uniprotId, selectedResidueIndex, pdbText, controller.signal);
      return () => {
                controller.abort();
      };
    } else {
      setComputedPocket(null);
    }
  }, [pdbText, uniprotId, selectedResidueIndex, fetchPocketData]);

  const fetchHomologs = useCallback(async (targetUniprot: string, signal?: AbortSignal) => {
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
  }, [fetchWithAuth]);


  const fetchNearestResidues = useCallback(async (
    targetUniprot: string,
    targetVariant: string,
    residueIndex: number,
    pdbText: string,
    signal?: AbortSignal
  ) => {
    const cacheKey = `${targetUniprot}_${residueIndex}`;
    
    // Check in-progress fetches or cache hits
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
            // Evict oldest (first) key to enforce eviction bounds and prevent memory leaks
            const oldestKey = keys[0];
            delete next[oldestKey];
          }
          return next;
        });
      }
    } catch (err: any) {
      if (signal?.aborted) {
        // Ignored
      } else {
        console.error("Error fetching nearest residues:", err);
      }
    } finally {
      pendingResiduesRef.current.delete(cacheKey);
    }
  }, [computedResiduesCache]);

  const fetchStructuralDiff = useCallback(async (wtPdb: string, mutPdb: string, pos: number, chain: string, isCompare: boolean, signal: AbortSignal) => {
    try {
      const res = await fetchWithAuth("/api/v1/structural-diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wtPdb, mutPdb, pos, chain }),
        signal
      });
      if (!res.ok) {
        throw new Error(`Failed to calculate structural diff (status: ${res.status})`);
      }
      const data = await res.json();
      if (isCompare) {
        setCompareStructuralDiff(data);
      } else {
        setStructuralDiff(data);
      }
    } catch (err: any) {
      if (!signal.aborted) {
        console.error("Error fetching structural diff:", err);
      }
    }
  }, []);

  const fetchEsmFold = useCallback(async (sequence: string) => {
    if (!sequence) return;
    setIsEsmFolding(true);
    setEsmFoldingError(null);
    try {
      const response = await fetchWithAuth("/api/v1/esmfold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence })
      });
      if (!response.ok) {
        throw new Error(`ESMFold service failed with status ${response.status}`);
      }
      const data = await response.json();
      if (data.pdb) {
        setEsmFoldPdb(data.pdb);
      } else {
        throw new Error("No structure returned from ESMFold service.");
      }
    } catch (err: any) {
      console.error("[ESMFold] Failed to fetch folded structure:", err);
      setEsmFoldingError(err.message || "Failed to fold protein sequence.");
      addNotification("error", `ESMFold folding failed: ${err.message}`);
    } finally {
      setIsEsmFolding(false);
    }
  }, [fetchWithAuth, addNotification]);

  const fetchMutantFold = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal) => {
    const effectiveUniprot = targetUniprot || analysisState.result?.metadata?.uniprotId || customUniprot || "";
    console.log("[fetchMutantFold] Initiating call with:", { targetGene, targetVariant, targetUniprot, effectiveUniprot, hasSignal: !!signal });
    if (!targetGene || !targetVariant || !effectiveUniprot) {
      console.warn("[fetchMutantFold] Skipping call due to missing parameters:", { targetGene, targetVariant, effectiveUniprot });
      return;
    }

    const key = `${targetGene}_${targetVariant}`;
    lastFetchedFoldRef.current = key;

    let activeSignal = signal;
    if (!activeSignal) {
      if (mutantFoldAbortRef.current) {
        console.log("[fetchMutantFold] Aborting previous folding request");
        mutantFoldAbortRef.current.abort();
      }
      const controller = new AbortController();
      mutantFoldAbortRef.current = controller;
      activeSignal = controller.signal;
    }

    setIsFolding(true);
    setFoldingError(null);
    setFoldingStatus(null);
    setFoldingDdG(null);
    try {
      const posMatch = targetVariant.match(/\d+/);
      const posQuery = posMatch ? `?pos=${posMatch[0]}` : "";
      const wtPdbHeaders: Record<string, string> = {};
      if (settings.geminiSessionId) {
        wtPdbHeaders["X-Gemini-Session-ID"] = settings.geminiSessionId;
      }
      if (settings.appApiToken) {
        wtPdbHeaders["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const wtPdbRes = await fetch(`/api/v1/alphafold-pdb/${effectiveUniprot}${posQuery}`, {
        signal: activeSignal,
        headers: wtPdbHeaders
      });
      if (!wtPdbRes.ok) {
        throw new Error(`Failed to load wild-type template structure (status: ${wtPdbRes.status})`);
      }
      const wtPdb = await wtPdbRes.text();
      setPdbText(wtPdb);
      if (selectedResidueIndex !== null) {
        fetchNearestResidues(effectiveUniprot, targetVariant, selectedResidueIndex, wtPdb, activeSignal);
      }

      const mutation = mapMutationToFoldXFormat(targetVariant);
      if (import.meta.env.DEV) {
        console.log(`[Biophysical Modeling] Mapping mutation to FoldX input format: ${mutation}`);
      }

      // KICK OFF DYNAMUT2 SUBMISSION & POLLING (Asynchronously)
      const submitDynaMut2 = async () => {
        try {
          const res = await fetchWithAuth("/api/v1/dynamut2-submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wtPdb, mutation }),
            signal: activeSignal,
            timeout: 60000
          });
          if (!res.ok) throw new Error(`Submit DynaMut2 returned status ${res.status}`);
          const submitData = await res.json();
          const returnedStatus = submitData.dynamut2Status;
          setDynamut2Status(
            returnedStatus === "pending" || returnedStatus === "unavailable" || returnedStatus === "done"
              ? returnedStatus
              : null
          );
          if (submitData.dynamut2JobId) {
            clearDynaMutPoll();
            setDynamut2JobId(submitData.dynamut2JobId);
            let attempts = 0;
            const maxAttempts = 30;
            const jobId = submitData.dynamut2JobId;
            addNotification("info", `DynaMut2 calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
            
            let finished = false;
            const poll = async () => {
              if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
                clearDynaMutPoll();
                return;
              }
              attempts++;
              try {
                const queryStr = buildEnergeticsQueryString(foldingEnergeticsRef.current) + `&uniprotId=${effectiveUniprot}&mutation=${mutation}`;
                const pollRes = await fetchWithAuth(`/api/v1/dynamut2-job/${jobId}?${queryStr}`, {
                  method: "GET",
                  signal: activeSignal
                });
                if (pollRes.status === 429) {
                  console.warn(`[DynaMut2 Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
                  const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
                  dynamutPollIntervalRef.current = setTimeout(poll, delay) as any;
                  return;
                }
                if (!pollRes.ok) {
                  throw new Error(`Poll request failed (status: ${pollRes.status})`);
                }
                const pollData = await pollRes.json();
                if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
                  clearDynaMutPoll();
                  return;
                }
                if (pollData.status === "DONE" && pollData.prediction !== null) {
                  setFoldingEnergetics(prev => {
                    const base: EnergeticsData = prev || {
                      foldx: null,
                      dynamut2: null,
                      ddmut: null,
                      rasp: null
                    };
                    const updated: EnergeticsData = {
                      ...base,
                      dynamut2: pollData.prediction
                    };
                    updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                    return updated;
                  });
                  setDynamut2Status("done");
                  clearDynaMutPoll();
                  addNotification("success", `DynaMut2 prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
                  finished = true;
                } else if (pollData.status === "ERROR") {
                  setDynamut2Status("unavailable");
                  clearDynaMutPoll();
                  addNotification("error", `DynaMut2 prediction failed for ${targetGene} ${targetVariant}.`);
                  finished = true;
                }
              } catch (pollErr: any) {
                if (activeSignal?.aborted) return;
                console.error("[DynaMut2 Polling Error]:", pollErr);
                setDynamut2Status("unavailable");
                clearDynaMutPoll();
                addNotification("error", `DynaMut2 polling encountered an error: ${pollErr.message || pollErr}.`);
                finished = true;
              }
              
              if (!finished) {
                if (attempts >= maxAttempts) {
                  setDynamut2Status("unavailable");
                  clearDynaMutPoll();
                  addNotification("error", `DynaMut2 prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
                } else {
                  const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
                  dynamutPollIntervalRef.current = setTimeout(poll, delay) as any;
                }
              }
            };

            await poll();
          }
        } catch (submitErr: any) {
          if (activeSignal?.aborted) return;
          console.error("[DynaMut2 Submission Error]:", submitErr);
          setDynamut2Status("unavailable");
        }
      };

      // KICK OFF DDMUT SUBMISSION & POLLING (Asynchronously)
      const submitDDMut = async () => {
        try {
          const res = await fetchWithAuth("/api/v1/ddmut-submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wtPdb, mutation }),
            signal: activeSignal,
            timeout: 60000
          });
          if (!res.ok) throw new Error(`Submit DDMut returned status ${res.status}`);
          const submitData = await res.json();
          const returnedDdmutStatus = submitData.ddmutStatus;
          setDdmutStatus(
            returnedDdmutStatus === "pending" || returnedDdmutStatus === "unavailable" || returnedDdmutStatus === "done"
              ? returnedDdmutStatus
              : null
          );
          if (submitData.ddmutJobId) {
            clearDdmutPoll();
            setDdmutJobId(submitData.ddmutJobId);
            let attempts = 0;
            const maxAttempts = 30;
            const jobId = submitData.ddmutJobId;
            addNotification("info", `DDMut calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
            
            let finished = false;
            const poll = async () => {
              if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
                clearDdmutPoll();
                return;
              }
              attempts++;
              try {
                const queryStr = buildEnergeticsQueryString(foldingEnergeticsRef.current) + `&uniprotId=${effectiveUniprot}&mutation=${mutation}`;
                const pollRes = await fetchWithAuth(`/api/v1/ddmut-job/${jobId}?${queryStr}`, {
                  method: "GET",
                  signal: activeSignal
                });
                if (pollRes.status === 429) {
                  console.warn(`[DDMut Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
                  const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
                  ddmutPollIntervalRef.current = setTimeout(poll, delay) as any;
                  return;
                }
                if (!pollRes.ok) {
                  throw new Error(`Poll request failed (status: ${pollRes.status})`);
                }
                const pollData = await pollRes.json();
                if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
                  clearDdmutPoll();
                  return;
                }
                if (pollData.status === "DONE" && pollData.prediction !== null) {
                  setFoldingEnergetics(prev => {
                    const base: EnergeticsData = prev || {
                      foldx: null,
                      dynamut2: null,
                      ddmut: null,
                      rasp: null
                    };
                    const updated: EnergeticsData = {
                      ...base,
                      ddmut: pollData.prediction
                    };
                    updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                    return updated;
                  });
                  setDdmutStatus("done");
                  clearDdmutPoll();
                  addNotification("success", `DDMut prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
                  finished = true;
                } else if (pollData.status === "ERROR") {
                  setDdmutStatus("unavailable");
                  clearDdmutPoll();
                  addNotification("error", `DDMut prediction failed for ${targetGene} ${targetVariant}.`);
                  finished = true;
                }
              } catch (pollErr: any) {
                if (activeSignal?.aborted) return;
                console.error("[DDMut Polling Error]:", pollErr);
                setDdmutStatus("unavailable");
                clearDdmutPoll();
                addNotification("error", `DDMut polling encountered an error: ${pollErr.message || pollErr}.`);
                finished = true;
              }
              
              if (!finished) {
                if (attempts >= maxAttempts) {
                  setDdmutStatus("unavailable");
                  clearDdmutPoll();
                  addNotification("error", `DDMut prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
                } else {
                  const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
                  ddmutPollIntervalRef.current = setTimeout(poll, delay) as any;
                }
              }
            };

            await poll();
          }
        } catch (submitErr: any) {
          if (activeSignal?.aborted) return;
          console.error("[DDMut Submission Error]:", submitErr);
          setDdmutStatus("unavailable");
        }
      };

      // Trigger parallel submissions asynchronously (no await)
      submitDynaMut2();
      submitDDMut();

      console.log("[fetchMutantFold] Sending verify-stability request with mutation:", mutation);
      const foldxMutation = mapMutationToFoldXFormat(targetVariant);
      const mutMatch = foldxMutation.match(/^([A-Z])([A-Z])(\d+)([A-Z])$/i);
      if (!mutMatch) {
        throw new Error(`Invalid mutation format: ${foldxMutation}`);
      }
      const wtLetter = mutMatch[1];
      const chainLetter = mutMatch[2];
      const posNum = parseInt(mutMatch[3], 10);
      const mtLetter = mutMatch[4];

      const mutantKey = `mutant_${targetGene}_${targetVariant}_${effectiveUniprot}`;
      const responsePromise = getDeduplicatedPromise(mutantKey, () =>
        fetchWithAuth("/api/v1/biophysics/verify-stability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uniprotId: effectiveUniprot,
            mutation: {
              chain: chainLetter,
              position: posNum,
              wt: wtLetter,
              mt: mtLetter
            },
            engine: active3dModelTab === "esmfold2" ? "esmfold" : "alphafold",
            wtPdb
          }),
          signal: activeSignal,
          timeout: 300000
        }).then(async (res) => {
          const resText = await res.text();
          let data;
          try {
            data = JSON.parse(resText);
          } catch (parseErr: any) {
            throw new Error(`Failed to parse response JSON: ${parseErr.message}. Response: ${resText.slice(0, 300)}`);
          }
          if (!res.ok) {
            let errMsg = "Biophysical mutant simulation failed.";
            errMsg = getErrorMessage(data, errMsg);
            throw new Error(errMsg);
          }
          return generateMutantResponseSchema.parse(data);
        })
      );

      const validatedData = await responsePromise;
      setMutantPdb(validatedData.pdb);
      setFoldedResidueIndex(validatedData.foldedResidueIndex);
      setFoldingStatus(validatedData.status);
      setFoldingDdG(validatedData.ddG);
      
      // Update energetics while merging existing background results (preventing races)
      setFoldingEnergetics(prev => {
        const base: EnergeticsData = validatedData.energetics || {
          foldx: validatedData.ddG,
          dynamut2: null,
          ddmut: null,
          rasp: null,
          thermompnn: null
        };
        const updated: EnergeticsData = {
          ...base,
          dynamut2: prev?.dynamut2 ?? base.dynamut2 ?? null,
          ddmut: prev?.ddmut ?? base.ddmut ?? null,
          thermompnn: prev?.thermompnn ?? base.thermompnn ?? null
        };
        updated.consensusVerdict = computeConsensusVerdict(updated);
        return updated;
      });

      // Start ThermoMPNN polling if pending
      if (validatedData.thermompnnStatus === "pending" && validatedData.thermompnnJobId) {
        setThermompnnStatus("pending");
        setThermompnnJobId(validatedData.thermompnnJobId);
        
        let attempts = 0;
        const maxAttempts = 60; // 10 mins (10s intervals)
        const jobId = validatedData.thermompnnJobId;
        addNotification("info", `ThermoMPNN calculation submitted. Polling in background...`);

        let finished = false;
        const poll = async () => {
          if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
            clearThermoMpnnPoll();
            return;
          }
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(foldingEnergeticsRef.current) + `&uniprotId=${effectiveUniprot}&mutation=${mutation}`;
            const pollRes = await fetchWithAuth(`/api/v1/thermompnn-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              thermompnnPollIntervalRef.current = setTimeout(poll, delay) as any;
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (targetGene !== currentGeneRef.current || targetVariant !== currentVariantRef.current) {
              clearThermoMpnnPoll();
              return;
            }
            if (pollData.status === "done" && pollData.prediction !== null) {
              setFoldingEnergetics(prev => {
                const base: EnergeticsData = prev || {
                  foldx: null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null,
                  thermompnn: null
                };
                const updated: EnergeticsData = {
                  ...base,
                  thermompnn: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setThermompnnStatus("done");
              clearThermoMpnnPoll();
              addNotification("success", `ThermoMPNN prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction.toFixed(2)} kcal/mol)`);
              finished = true;
            } else if (pollData.status === "error" || pollData.status === "failed") {
              setThermompnnStatus("unavailable");
              clearThermoMpnnPoll();
              addNotification("error", `ThermoMPNN prediction failed for ${targetGene} ${targetVariant}.`);
              finished = true;
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[ThermoMPNN Polling Error]:", pollErr);
            setThermompnnStatus("unavailable");
            clearThermoMpnnPoll();
            finished = true;
          }

          if (!finished) {
            if (attempts >= maxAttempts) {
              setThermompnnStatus("unavailable");
              clearThermoMpnnPoll();
              addNotification("error", `ThermoMPNN prediction timed out for ${targetGene} ${targetVariant}.`);
            } else {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              thermompnnPollIntervalRef.current = setTimeout(poll, delay) as any;
            }
          }
        };

        poll();
      } else {
        setThermompnnStatus(
          validatedData.thermompnnStatus === "done" || validatedData.thermompnnStatus === "unavailable"
            ? (validatedData.thermompnnStatus as any)
            : null
        );
      }

      const posVal = posMatch ? parseInt(posMatch[0], 10) : 0;
      if (validatedData.pdb && wtPdb && posVal) {
        fetchStructuralDiff(wtPdb, validatedData.pdb, posVal, "A", false, activeSignal);
      }
    } catch (err: any) {
      lastFetchedFoldRef.current = "";
      console.warn("[fetchMutantFold] Caught error:", err);
      if (activeSignal?.aborted || err.name === "AbortError" || (err.message && err.message.toLowerCase().includes("aborted"))) {
        console.log("fetchMutantFold aborted/canceled.");
        return;
      }
      console.error("Mutant biophysical folding error:", err);
      setFoldingError(err.message || "Failed to generate biophysical structural model.");
    } finally {
      if (!activeSignal?.aborted) {
        setIsFolding(false);
      }
    }
  };

  const fetchCompareMutantFold = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal) => {
    let activeSignal = signal;
    if (!activeSignal) {
      if (compareFoldAbortRef.current) {
        compareFoldAbortRef.current.abort();
      }
      const controller = new AbortController();
      compareFoldAbortRef.current = controller;
      activeSignal = controller.signal;
    }

    setIsFoldingCompare(true);
    setFoldingCompareError(null);
    setCompareFoldingStatus(null);
    setCompareFoldingDdG(null);
    try {
      const posMatch = targetVariant.match(/\d+/);
      const posQuery = posMatch ? `?pos=${posMatch[0]}` : "";
      const wtPdbHeaders: Record<string, string> = {};
      if (settings.geminiSessionId) {
        wtPdbHeaders["X-Gemini-Session-ID"] = settings.geminiSessionId;
      }
      if (settings.appApiToken) {
        wtPdbHeaders["Authorization"] = `Bearer ${settings.appApiToken}`;
      }
      const wtPdbRes = await fetch(`/api/v1/alphafold-pdb/${targetUniprot}${posQuery}`, {
        signal: activeSignal,
        headers: wtPdbHeaders
      });
      if (!wtPdbRes.ok) {
        throw new Error(`Failed to load wild-type template structure (status: ${wtPdbRes.status})`);
      }
      const wtPdb = await wtPdbRes.text();

      const foldxMutation = mapMutationToFoldXFormat(targetVariant);
      const mutMatch = foldxMutation.match(/^([A-Z])([A-Z])(\d+)([A-Z])$/i);
      if (!mutMatch) {
        throw new Error(`Invalid mutation format: ${foldxMutation}`);
      }
      const wtLetter = mutMatch[1];
      const chainLetter = mutMatch[2];
      const posNum = parseInt(mutMatch[3], 10);
      const mtLetter = mutMatch[4];

      const response = await fetchWithAuth("/api/v1/biophysics/verify-stability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uniprotId: targetUniprot,
          mutation: {
            chain: chainLetter,
            position: posNum,
            wt: wtLetter,
            mt: mtLetter
          },
          engine: active3dModelTab === "esmfold2" ? "esmfold" : "alphafold",
          wtPdb
        }),
        signal: activeSignal,
        timeout: 300000
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = "Biophysical comparison mutant simulation failed.";
        try {
          const errData = JSON.parse(text);
          errMsg = getErrorMessage(errData, errMsg);
        } catch (_) {
          errMsg = `Biophysical comparison mutant simulation failed (status: ${response.status}). Response: ${text.slice(0, 300)}`;
        }
        throw new Error(errMsg);
      }

      const resText = await response.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse comparison response JSON: ${parseErr.message}. Response: ${resText.slice(0, 300)}`);
      }

      const validatedData = generateMutantResponseSchema.parse(data);
      setCompareMutantPdb(validatedData.pdb);
      setCompareFoldedResidueIndex(validatedData.foldedResidueIndex);
      setCompareFoldingStatus(validatedData.status);
      setCompareFoldingDdG(validatedData.ddG);
      setCompareFoldingEnergetics(validatedData.energetics || {
        foldx: validatedData.ddG,
        dynamut2: null,
        ddmut: null,
        rasp: null,
        thermompnn: null
      });

      const posVal = posMatch ? parseInt(posMatch[0], 10) : 0;
      if (validatedData.pdb && wtPdb && posVal) {
        fetchStructuralDiff(wtPdb, validatedData.pdb, posVal, "A", true, activeSignal);
      }

      // Start comparison ThermoMPNN polling if pending
      if (validatedData.thermompnnStatus === "pending" && validatedData.thermompnnJobId) {
        setCompareThermompnnStatus("pending");
        setCompareThermompnnJobId(validatedData.thermompnnJobId);
        
        let attempts = 0;
        const maxAttempts = 60; // 10 mins (10s intervals)
        const jobId = validatedData.thermompnnJobId;
        addNotification("info", `Comparison ThermoMPNN calculation submitted. Polling in background...`);

        let finished = false;
        const poll = async () => {
          if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
            clearThermoMpnnComparePoll();
            return;
          }
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(compareFoldingEnergeticsRef.current) + `&uniprotId=${targetUniprot}&mutation=${foldxMutation}`;
            const pollRes = await fetchWithAuth(`/api/v1/thermompnn-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              thermompnnComparePollIntervalRef.current = setTimeout(poll, delay) as any;
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
              clearThermoMpnnComparePoll();
              return;
            }
            if (pollData.status === "done" && pollData.prediction !== null) {
              setCompareFoldingEnergetics(prev => {
                const base: EnergeticsData = prev || {
                  foldx: null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null,
                  thermompnn: null
                };
                const updated: EnergeticsData = {
                  ...base,
                  thermompnn: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setCompareThermompnnStatus("done");
              clearThermoMpnnComparePoll();
              addNotification("success", `Comparison ThermoMPNN prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction.toFixed(2)} kcal/mol)`);
              finished = true;
            } else if (pollData.status === "error" || pollData.status === "failed") {
              setCompareThermompnnStatus("unavailable");
              clearThermoMpnnComparePoll();
              addNotification("error", `Comparison ThermoMPNN prediction failed for ${targetGene} ${targetVariant}.`);
              finished = true;
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[Comparison ThermoMPNN Polling Error]:", pollErr);
            setCompareThermompnnStatus("unavailable");
            clearThermoMpnnComparePoll();
            finished = true;
          }

          if (!finished) {
            if (attempts >= maxAttempts) {
              setCompareThermompnnStatus("unavailable");
              clearThermoMpnnComparePoll();
              addNotification("error", `Comparison ThermoMPNN prediction timed out for ${targetGene} ${targetVariant}.`);
            } else {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              thermompnnComparePollIntervalRef.current = setTimeout(poll, delay) as any;
            }
          }
        };

        poll();
      } else {
        setCompareThermompnnStatus(
          validatedData.thermompnnStatus === "done" || validatedData.thermompnnStatus === "unavailable"
            ? (validatedData.thermompnnStatus as any)
            : null
        );
      }

      const returnedStatus = validatedData.dynamut2Status;
      setCompareDynamut2Status(
        returnedStatus === "pending" || returnedStatus === "unavailable" || returnedStatus === "done"
          ? returnedStatus
          : null
      );

      const returnedDdmutStatus = validatedData.ddmutStatus;
      setCompareDdmutStatus(
        returnedDdmutStatus === "pending" || returnedDdmutStatus === "unavailable" || returnedDdmutStatus === "done"
          ? returnedDdmutStatus
          : null
      );

      if (validatedData.dynamut2JobId) {
        clearDynaMutComparePoll();
        setCompareDynamut2JobId(validatedData.dynamut2JobId);
        let attempts = 0;
        const maxAttempts = 30;
        const jobId = validatedData.dynamut2JobId;
        addNotification("info", `Comparison DynaMut2 calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        let finished = false;
        const poll = async () => {
          if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
            clearDynaMutComparePoll();
            return;
          }
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(compareFoldingEnergeticsRef.current);
            const pollRes = await fetchWithAuth(`/api/v1/dynamut2-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DynaMut2 Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              dynamutComparePollIntervalRef.current = setTimeout(poll, delay) as any;
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
              clearDynaMutComparePoll();
              return;
            }
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setCompareFoldingEnergetics(prev => {
                const base: EnergeticsData = prev || {
                  foldx: validatedData.ddG,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated: EnergeticsData = {
                  ...base,
                  dynamut2: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setCompareDynamut2Status("done");
              clearDynaMutComparePoll();
              addNotification("success", `Comparison DynaMut2 prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
              finished = true;
            } else if (pollData.status === "ERROR") {
              setCompareDynamut2Status("unavailable");
              clearDynaMutComparePoll();
              addNotification("error", `Comparison DynaMut2 prediction failed for ${targetGene} ${targetVariant}.`);
              finished = true;
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DynaMut2 Polling Error]:", pollErr);
            setCompareDynamut2Status("unavailable");
            clearDynaMutComparePoll();
            addNotification("error", `Comparison DynaMut2 polling encountered an error: ${pollErr.message || pollErr}.`);
            finished = true;
          }
          
          if (!finished) {
            if (attempts >= maxAttempts) {
              setCompareDynamut2Status("unavailable");
              clearDynaMutComparePoll();
              addNotification("error", `Comparison DynaMut2 prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
            } else {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              dynamutComparePollIntervalRef.current = setTimeout(poll, delay) as any;
            }
          }
        };

        await poll();
      }

      if (validatedData.ddmutJobId) {
        clearDdmutComparePoll();
        setCompareDdmutJobId(validatedData.ddmutJobId);
        let attempts = 0;
        const maxAttempts = 30;
        const jobId = validatedData.ddmutJobId;
        addNotification("info", `Comparison DDMut calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        let finished = false;
        const poll = async () => {
          if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
            clearDdmutComparePoll();
            return;
          }
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(compareFoldingEnergeticsRef.current);
            const pollRes = await fetchWithAuth(`/api/v1/ddmut-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DDMut Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              ddmutComparePollIntervalRef.current = setTimeout(poll, delay) as any;
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (targetGene !== currentGeneRef.current || targetVariant !== currentCompareVariantRef.current) {
              clearDdmutComparePoll();
              return;
            }
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setCompareFoldingEnergetics(prev => {
                const base: EnergeticsData = prev || {
                  foldx: validatedData.ddG,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated: EnergeticsData = {
                  ...base,
                  ddmut: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setCompareDdmutStatus("done");
              clearDdmutComparePoll();
              addNotification("success", `Comparison DDMut prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
              finished = true;
            } else if (pollData.status === "ERROR") {
              setCompareDdmutStatus("unavailable");
              clearDdmutComparePoll();
              addNotification("error", `Comparison DDMut prediction failed for ${targetGene} ${targetVariant}.`);
              finished = true;
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DDMut Polling Error]:", pollErr);
            setCompareDdmutStatus("unavailable");
            clearDdmutComparePoll();
            addNotification("error", `Comparison DDMut polling encountered an error: ${pollErr.message || pollErr}.`);
            finished = true;
          }
          
          if (!finished) {
            if (attempts >= maxAttempts) {
              setCompareDdmutStatus("unavailable");
              clearDdmutComparePoll();
              addNotification("error", `Comparison DDMut prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
            } else {
              const delay = Math.min(30000, 5000 * Math.pow(1.5, attempts - 1));
              ddmutComparePollIntervalRef.current = setTimeout(poll, delay) as any;
            }
          }
        };

        await poll();
      }
    } catch (err: any) {
      if (activeSignal?.aborted || err.name === "AbortError" || (err.message && err.message.toLowerCase().includes("aborted"))) {
        console.log("fetchCompareMutantFold aborted/canceled.");
        return;
      }
      console.error("Comparison biophysical folding error:", err);
      setFoldingCompareError(err.message || "Failed to generate comparison biophysical structural model.");
    } finally {
      if (!activeSignal?.aborted) {
        setIsFoldingCompare(false);
      }
    }
  };

  useEffect(() => {
    const key = `${gene}_${variant}`;
    const activeUniprot = uniprotId || analysisState.result?.metadata?.uniprotId || "";
    if (!mutantPdb && !isFolding && gene && variant && activeUniprot && lastFetchedFoldRef.current !== key) {
      fetchMutantFold(gene, variant, activeUniprot);
    }
  }, [mutantPdb, gene, variant, uniprotId, analysisState.result?.metadata?.uniprotId]);

  const refreshPredictorJob = useCallback(async (jobType: "dynamut2" | "ddmut") => {
    const jobId = jobType === "dynamut2" ? dynamut2JobId : ddmutJobId;
    if (!jobId) {
      addNotification("info", `No active job found. Resubmitting ${jobType === "dynamut2" ? "DynaMut2" : "DDMut"}...`);
      const activeUniprot = uniprotId || analysisState.result?.metadata?.uniprotId || "";
      if (gene && variant && activeUniprot) {
        fetchMutantFold(gene, variant, activeUniprot);
      } else {
        addNotification("error", "Cannot submit prediction: Gene or Variant information is incomplete.");
      }
      return;
    }

    addNotification("info", `Checking status for ${jobType === "dynamut2" ? "DynaMut2" : "DDMut"} job #${jobId}...`);
    try {
      const queryStr = buildEnergeticsQueryString(foldingEnergeticsRef.current);
      const pollRes = await fetchWithAuth(`/api/v1/${jobType}-job/${jobId}?${queryStr}`, {
        method: "GET"
      });
      if (pollRes.status === 429) {
        addNotification("error", "Rate limit reached. Please wait a few seconds before retrying.");
        return;
      }
      if (!pollRes.ok) {
        throw new Error(`Job status check returned status ${pollRes.status}`);
      }
      const pollData = await pollRes.json();
      if (pollData.status === "DONE" && pollData.prediction !== null) {
        setFoldingEnergetics(prev => {
          const base: EnergeticsData = prev || {
            foldx: null,
            dynamut2: null,
            ddmut: null,
            rasp: null
          };
          const updated: EnergeticsData = {
            ...base,
            [jobType]: pollData.prediction
          };
          updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
          return updated;
        });
        if (jobType === "dynamut2") {
          setDynamut2Status("done");
        } else {
          setDdmutStatus("done");
        }
        addNotification("success", `${jobType === "dynamut2" ? "DynaMut2" : "DDMut"} prediction completed!`);
      } else if (pollData.status === "ERROR") {
        if (jobType === "dynamut2") {
          setDynamut2Status("unavailable");
        } else {
          setDdmutStatus("unavailable");
        }
        addNotification("error", `${jobType === "dynamut2" ? "DynaMut2" : "DDMut"} prediction failed.`);
      } else {
        addNotification("info", `${jobType === "dynamut2" ? "DynaMut2" : "DDMut"} job is still running/queued (status: ${pollData.status}).`);
      }
    } catch (err: any) {
      console.error(`[Manual Refresh Error]:`, err);
      addNotification("error", `Failed to check job status: ${err.message || err}`);
    }
  }, [dynamut2JobId, ddmutJobId, gene, variant, uniprotId, analysisState.result, fetchWithAuth, addNotification]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    abortAllPendingRequests();

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    const targetGene = (customGene || "").trim().toUpperCase();
    let targetVariant = (customVariant || "").replace(/[()]/g, "").trim();
    const targetGenomic = (customGenomic || "").trim();
    const targetUniprot = (customUniprot || "").trim().toUpperCase();

    if (targetGenomic) {
      targetVariant = targetGenomic;
    }

    const isCoordinate = isVcfOrCdnaNotation(targetVariant);
    if (isCoordinate) {
      if (!targetVariant) return;
    } else {
      if (!targetGene || !targetVariant) return;
    }

    if (isCoordinate) {
      try {
        let notationToTranslate = targetVariant;
        const dashedMatch = targetVariant.match(/^(?:chr)?([0-9XYMT]+)-(\d+)-([ACGTN]+)-([ACGTN]+)$/i);
        if (dashedMatch) {
          notationToTranslate = `chr${dashedMatch[1]}:g.${dashedMatch[2]}${dashedMatch[3].toUpperCase()}>${dashedMatch[4].toUpperCase()}`;
        }
        const resolved = await translateVariantNotation(notationToTranslate, activeSignal);
        
        setGene(resolved.gene);
        setVariant(resolved.variant);
        setUniprotId(resolved.uniprotId);
        setSearchVal(`${resolved.gene} ${resolved.variant}`);
        setCustomGene(resolved.gene);
        setCustomVariant(resolved.variant);
        setCustomUniprot(resolved.uniprotId);
        if (resolved.genomicCoordinates) {
          setCustomGenomic(resolved.genomicCoordinates);
        } else if (dashedMatch) {
          setCustomGenomic(targetGenomic);
        } else {
          setCustomGenomic("");
        }
        
        const resMatch = resolved.variant.match(/\d+/);
        setSelectedResidueIndex(resMatch ? parseInt(resMatch[0], 10) : null);
        
        executeAnalysis(resolved.gene, resolved.variant, resolved.uniprotId, activeSignal, notationToTranslate);
      } catch (err: any) {
        if (activeSignal.aborted) return;
        setAnalysisState({
          isLoading: false,
          error: err.message,
          result: null
        });
      }
      return;
    }
    
    try {
      parseMutationResidues(targetVariant);
    } catch (err: any) {
      setAnalysisState({
        isLoading: false,
        error: `Validation Error: ${err.message}`,
        result: null
      });
      return;
    }
    
    setAnalysisState(prev => ({ ...prev, isLoading: true, error: null }));
    
    // If UniProt ID is already provided, skip resolution
    if (targetUniprot) {
      setGene(targetGene);
      setVariant(targetVariant);
      setUniprotId(targetUniprot);
      setCustomPdbUrl(null);
      
      const resMatch = targetVariant.match(/\d+/);
      if (resMatch) {
        setSelectedResidueIndex(parseInt(resMatch[0], 10));
      } else {
        setSelectedResidueIndex(null);
      }
      executeAnalysis(targetGene, targetVariant, targetUniprot, activeSignal, undefined);
      return;
    }

    setLoadingStep("Step 1/4: Resolving gene name to UniProt coordinates...");

    try {
      const resolveRes = await fetchWithAuth("/api/v1/resolve-gene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gene: targetGene }),
        signal: activeSignal
      });

      const resText = await resolveRes.text();
      let resolveData;
      try {
        resolveData = JSON.parse(resText);
      } catch (resolveErr: any) {
        if (!resolveRes.ok) {
          throw new Error(`Failed to resolve gene (status: ${resolveRes.status}). Response: ${resText.slice(0, 300)}`);
        }
        throw new Error(`Failed to parse gene resolution JSON: ${resolveErr.message}. Response: ${resText.slice(0, 300)}`);
      }

      if (!resolveRes.ok) {
        throw new Error(getErrorMessage(resolveData, "Failed to resolve gene."));
      }

      if (activeSignal.aborted) return;

      const validated = resolveGeneResponseSchema.parse(resolveData);
      const resolvedUniprot = validated.uniprotId;
      const resolvedPdbUrl = validated.pdbUrl;

      setGene(targetGene);
      setVariant(targetVariant);
      setUniprotId(resolvedUniprot);
      setCustomPdbUrl(resolvedPdbUrl);
      setCustomUniprot(resolvedUniprot);
      
      const resMatch = targetVariant.match(/\d+/);
      if (resMatch) {
        setSelectedResidueIndex(parseInt(resMatch[0], 10));
      } else {
        setSelectedResidueIndex(null);
      }

      executeAnalysis(targetGene, targetVariant, resolvedUniprot, activeSignal, undefined);
    } catch (err: any) {
      if (activeSignal.aborted) {
        console.log("handleSearchSubmit custom search aborted.");
        return;
      }
      setAnalysisState({
        isLoading: false,
        error: `Gene resolution failed: ${err.message}`,
        result: null
      });
    }
  };

  const handleCopyReport = () => {
    if (!analysisState.result?.analysis) return;
    navigator.clipboard.writeText(analysisState.result.analysis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getDisruptionWarning = useCallback((energetics: EnergeticsData | null, diff: StructuralDiffResult | null) => {
    // 1. Steric clash threshold: vdw > 2.0 kcal/mol, stericClashWarning, or structural diff clash increase > 0
    const vdwVal = energetics?.vdw ?? 0;
    const clashDiff = diff?.clashes?.diff ?? 0;
    const isClash = !!(energetics?.stericClashWarning || vdwVal > 2.0 || clashDiff > 0);
    
    // 2. Repacking threshold: local RMSD > 1.5 Å from either FoldX or Kabsch structural diff
    const rmsdVal = diff?.localRmsd ?? energetics?.localSidechainRmsd ?? 0.0;
    const isRepackWarning = rmsdVal > 1.5;
    
    // 3. Destabilization threshold: foldxMean > 1.5 kcal/mol
    const foldxMean = energetics?.foldxMean ?? energetics?.foldx ?? 0.0;
    const isSevereDestab = foldxMean > 1.5;
    
    if (isClash) {
      const detail = clashDiff > 0 
        ? `introducing ${clashDiff} new steric clash(es)` 
        : `a steric clash delta of ${vdwVal.toFixed(2)} kcal/mol`;
      return {
        type: 'clash' as const,
        title: 'Severe Steric Clash Alert',
        description: `Variant introduces a steric clash (${detail}). This is expected to push surrounding atoms, disrupting local sidechain packing.`
      };
    }
    
    if (isRepackWarning) {
      return {
        type: 'clash' as const,
        title: 'Sidechain Repack Alert',
        description: `Local sidechain repacking shows a structural displacement (RMSD) of ${rmsdVal.toFixed(2)} Å, indicating high conformational rearrangement.`
      };
    }
    
    if (isSevereDestab) {
      return {
        type: 'clash' as const,
        title: 'Severe Destabilization Alert',
        description: `Free energy calculation predicts a severe destabilization of +${foldxMean.toFixed(2)} kcal/mol, indicating a high probability of fold collapse.`
      };
    }
    
    return null;
  }, []);

  const disruptionWarningVariant1 = useMemo(() => getDisruptionWarning(foldingEnergetics, structuralDiff), [foldingEnergetics, structuralDiff, getDisruptionWarning]);
  const disruptionWarningVariant2 = useMemo(() => getDisruptionWarning(compareFoldingEnergetics, compareStructuralDiff), [compareFoldingEnergetics, compareStructuralDiff, getDisruptionWarning]);

  return {
    state: {
      theme,
      isDark,
      gene,
      variant,
      uniprotId,
      selectedResidueIndex,
      hoveredResidueIndex,
      searchVal,
      customGene,
      customVariant,
      customUniprot,
      customGenomic,
      showCustomInputs,
      copied,
      customPdbUrl,
      viewMode,
      active3dModelTab,
      disruptionPredictor,
      triageOverride,
      mutantPdb,
      foldedResidueIndex,
      isFolding,
      foldingError,
      foldingStatus,
      foldingDdG,
      foldingEnergetics,
      compareMode,
      compareVariant,
      compareMutantPdb,
      compareFoldedResidueIndex,
      isFoldingCompare,
      foldingCompareError,
      compareFoldingStatus,
      compareFoldingDdG,
      compareFoldingEnergetics,
      comparisonLayout,
      dynamut2Status,
      compareDynamut2Status,
      ddmutStatus,
      compareDdmutStatus,
      thermompnnStatus,
      compareThermompnnStatus,
      structuralDiff,
      compareStructuralDiff,
      showPolarContacts,
      pdbText,
      computedPocket,
      isPocketLoading,
      pocketError,
      isBiophysicalLoading,
      isClinicalLoading,
      settings,
      isSettingsOpen,
      isHowToInspectOpen,
      isLegendOpen,
      analysisState,
      loadingStep,
      history,
      userDirections,
      notifications,
      esmFoldPdb,
      isEsmFolding,
      esmFoldingError,

      // Styling and computed classes
      classRoot,
      classHeader,
      classHeaderTitle,
      classHeaderSub,
      classCard,
      classCardHeader,
      classCardTitle,
      classCardSubText,
      classTextMute,
      classTextBody,
      classTextBright,
      classBorderSec,
      classBorderCardSep,
      classInput,
      classInputLabel,
      classBadgeAccent,
      classSubCard,
      
      // Warnings & computed pathogenicity
      disruptionWarningVariant1,
      disruptionWarningVariant2,
      computedResiduesCache,
      homologs,
      isHomologsLoading,
    },
    actions: {
      setTheme,
      toggleTheme,
      addNotification,
      removeNotification,
      setGene,
      setVariant,
      setUniprotId,
      setSelectedResidueIndex,
      setHoveredResidueIndex,
      setSearchVal,
      setCustomGene,
      setCustomVariant,
      setCustomUniprot,
      setCustomGenomic,
      setShowCustomInputs,
      setCopied,
      setCustomPdbUrl,
      setViewMode,
      setActive3dModelTab,
      setTriageOverride,
      setMutantPdb,
      setFoldedResidueIndex,
      setIsFolding,
      setFoldingError,
      setFoldingStatus,
      setFoldingDdG,
      setFoldingEnergetics,
      setCompareMode,
      setCompareVariant,
      setCompareMutantPdb,
      setCompareFoldedResidueIndex,
      setIsFoldingCompare,
      setFoldingCompareError,
      setCompareFoldingStatus,
      setCompareFoldingDdG,
      setCompareFoldingEnergetics,
      setComparisonLayout,
      setThermompnnStatus,
      setCompareThermompnnStatus,
      setShowPolarContacts,
      setPdbText,
      setComputedPocket,
      setIsPocketLoading,
      setPocketError,
      setSettings,
      setIsSettingsOpen,
      setIsHowToInspectOpen,
      setIsLegendOpen,
      setAnalysisState,
      setLoadingStep,
      setHistory,
      setUserDirections,
      
      // Functions
      addToHistory,
      clearHistory,
      handleSelectHistoryItem,
      updateSetting,
      resetSettingsToDefault,
      formatEnergyString,
      handleSelectPreset,
      executeAnalysis,
      fetchMutantFold,
      fetchEsmFold,
      fetchCompareMutantFold,
      handleSearchSubmit,
      handleCopyReport,
      fetchNearestResidues,
      resetViewerState,
      refreshPredictorJob,
    }
  };
}

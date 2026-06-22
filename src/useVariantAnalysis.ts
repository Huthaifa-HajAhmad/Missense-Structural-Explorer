import { useState, useEffect, useRef } from "react";
import { z } from "zod";

// Zod validation schemas for server responses (MOD-6)
export const analyzeVariantResponseSchema = z.object({
  analysis: z.string(),
  insights: z.object({
    biochemicalShift: z.string(),
    structuralImpact: z.string(),
    pathogenicity: z.string().optional(),
    acmgCriteria: z.preprocess(
      (val) => val ?? [],
      z.array(z.object({
        code: z.string(),
        reason: z.string()
      }))
    )
  }).nullable().optional(),
  clinvar: z.object({
    classification: z.string(),
    lastEvaluated: z.string(),
    reviewStatus: z.string(),
    alleleFrequencies: z.array(z.object({
      source: z.string(),
      value: z.any()
    })),
    trait: z.string(),
    uid: z.string().nullable()
  }).nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: z.number().nullable(),
    wildType: z.string(),
    mutant: z.string()
  })
});

export const generateMutantResponseSchema = z.object({
  pdb: z.string(),
  ddG: z.number().nullable(),
  status: z.enum(["success", "scwrl", "fallback"]),
  foldedResidueIndex: z.number()
});

export const pocketFinderResponseSchema = z.object({
  pocketResidues: z.array(z.object({
    index: z.number(),
    name: z.string(),
    distance: z.number(),
    score: z.number(),
    role: z.string(),
    type: z.string()
  })),
  pocketScore: z.number(),
  pocketVolume: z.number(),
  likelyCofactor: z.string(),
  status: z.enum(["success", "fallback"])
});

export const resolveGeneResponseSchema = z.object({
  gene: z.string(),
  uniprotId: z.string(),
  pdbUrl: z.string().nullable()
});

export const translateVariantResponseSchema = z.object({
  gene: z.string(),
  variant: z.string(),
  uniprotId: z.string()
});
import { VARIANT_PRESETS, FALLBACK_ANALYSES, FALLBACK_INSIGHTS } from "./data";
import { AnalysisState, VariantPreset, UserSettings, AnalysisResult } from "./types";
import { useSettings } from "./context/SettingsContext";
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  initialDelay = 1000,
  backoffFactor = 2
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      
      // If it's a 503 (Cold Start) or 504 (Timeout) and we have retries left:
      if ((response.status === 503 || response.status === 504) && attempt < maxRetries) {
        attempt++;
        const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
        console.warn(`[Retry] Endpoint ${url} returned status ${response.status}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };
          const timeoutId = setTimeout(() => {
            options.signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
        continue;
      }
      return response;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw err;
      }
      if (attempt < maxRetries) {
        attempt++;
        const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
        console.warn(`[Retry] Endpoint ${url} threw error: ${err.message || err}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeoutId);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };
          const timeoutId = setTimeout(() => {
            options.signal?.removeEventListener("abort", onAbort);
            resolve();
          }, delay);
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
        continue;
      }
      throw err;
    }
  }
}
function getErrorMessage(data: any, defaultMsg = "Request failed"): string {
  if (!data) return defaultMsg;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data === "string") return data;
  return defaultMsg;
}

// Simple XOR and Base64 helper for local storage privacy (SEC-7)
const STORAGE_KEY = "variantHistory_enc";
const SECRET_SALT = "ClinicalGenomicsObfuscationSalt"; // Simple key for obfuscation

function obfuscate(text: string): string {
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ SECRET_SALT.charCodeAt(i % SECRET_SALT.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(result);
}

function deobfuscate(encoded: string): string {
  try {
    const text = atob(encoded);
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i) ^ SECRET_SALT.charCodeAt(i % SECRET_SALT.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (err) {
    console.error("Failed to decrypt local storage history:", err);
    return "";
  }
}

// Coordinate pattern checkers for VCF and cDNA (F-3)
export function isVcfOrCdnaNotation(input: string): boolean {
  const trimmed = input.trim();
  const genomicRegex = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
  const cdnaRegex = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;
  return genomicRegex.test(trimmed) || cdnaRegex.test(trimmed);
}

export const AMINO_ACID_NAMES_MAP: Record<string, string> = {
  A: "Alanine [Ala]",
  R: "Arginine [Arg]",
  N: "Asparagine [Asn]",
  D: "Aspartate [Asp]",
  C: "Cysteine [Cys]",
  Q: "Glutamine [Gln]",
  E: "Glutamate [Glu]",
  G: "Glycine [Gly]",
  H: "Histidine [His]",
  I: "Isoleucine [Ile]",
  L: "Leucine [Leu]",
  K: "Lysine [Lys]",
  M: "Methionine [Met]",
  F: "Phenylalanine [Phe]",
  P: "Proline [Pro]",
  S: "Serine [Ser]",
  T: "Threonine [Thr]",
  W: "Tryptophan [Trp]",
  Y: "Tyrosine [Tyr]",
  V: "Valine [Val]"
};

/**
 * Normalized physical and biochemical properties of amino acids (0-100 scale).
 * 
 * Citations & Scientific Sourcing:
 * - Hydrophobicity: Derived from the Kyte-Doolittle hydropathy scale.
 *   Kyte J, Doolittle RF. "A simple method for displaying the hydropathic character of a protein." 
 *   J Mol Biol. 1982 May 5;157(1):105-32. PMID: 7108955.
 * - Charge / Polarity: Standard biochemical classification of residues at physiological pH.
 * - Size: Based on amino acid van der Waals volume measurements, normalized.
 * - Grantham Scale comparisons are referenced downstream in the biochemical shift descriptions.
 *   Grantham R. "Amino acid difference formula to help explain protein evolution."
 *   Science. 1974 Sep 6;185(4154):862-4. PMID: 4843792.
 */
export const AMINO_ACID_PROPERTIES: Record<string, { hydrophobicity: number; charge: number; size: number; polarity: number }> = {
  A: { hydrophobicity: 60, charge: 50, size: 25, polarity: 15 },
  R: { hydrophobicity: 5,  charge: 100,size: 85, polarity: 100 },
  N: { hydrophobicity: 20, charge: 50, size: 50, polarity: 75 },
  D: { hydrophobicity: 10, charge: 0,  size: 45, polarity: 100 },
  C: { hydrophobicity: 70, charge: 35, size: 40, polarity: 60 },
  E: { hydrophobicity: 10, charge: 0,  size: 60, polarity: 100 },
  Q: { hydrophobicity: 20, charge: 50, size: 65, polarity: 75 },
  G: { hydrophobicity: 45, charge: 50, size: 10, polarity: 15 },
  H: { hydrophobicity: 25, charge: 75, size: 75, polarity: 85 },
  I: { hydrophobicity: 100,charge: 50, size: 75, polarity: 10 },
  L: { hydrophobicity: 95, charge: 50, size: 75, polarity: 10 },
  K: { hydrophobicity: 5,  charge: 95, size: 80, polarity: 100 },
  M: { hydrophobicity: 75, charge: 50, size: 75, polarity: 15 },
  F: { hydrophobicity: 85, charge: 50, size: 90, polarity: 10 },
  P: { hydrophobicity: 55, charge: 52, size: 55, polarity: 15 },
  S: { hydrophobicity: 30, charge: 45, size: 30, polarity: 70 },
  T: { hydrophobicity: 40, charge: 45, size: 45, polarity: 70 },
  W: { hydrophobicity: 65, charge: 48, size: 100,polarity: 20 },
  Y: { hydrophobicity: 50, charge: 45, size: 95, polarity: 50 },
  V: { hydrophobicity: 90, charge: 50, size: 60, polarity: 10 }
};

export function parseMutationResidues(variantStr: string) {
  const aminoAcidMap: Record<string, string> = {
    Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
    Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V"
  };
  const clean = variantStr.replace(/^p\./i, "");
  
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
    if (!wt || !mut) {
      throw new Error(`Invalid HGVS missense format: Unrecognized 3-letter amino acid code '${!wt ? wt3 : mut3}'`);
    }
    return { wt, mut };
  }

  const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (match1) {
    const wt = match1[1].toUpperCase();
    const mut = match1[3].toUpperCase();
    const validCodes = Object.values(aminoAcidMap);
    if (!validCodes.includes(wt) || !validCodes.includes(mut)) {
      throw new Error(`Invalid HGVS missense format: Unrecognized 1-letter amino acid code '${!validCodes.includes(wt) ? wt : mut}'`);
    }
    return { wt, mut };
  }

  throw new Error("Invalid HGVS missense format: Must represent a single amino acid substitution (e.g., p.Arg215Trp or R215W)");
}

export const getAlternativeVariants = (currentGene: string): string[] => {
  const normalized = currentGene.toUpperCase();
  if (normalized === "PAH") {
    return ["p.Arg408Trp", "p.Arg261Gln", "p.Ala259Thr", "p.Gly272Cys"];
  }
  if (normalized === "FGFR3") {
    return ["p.Gly380Arg", "p.Ala391Glu", "p.Lys650Glu", "p.Asn540Lys"];
  }
  if (normalized === "GBA1") {
    return ["p.Leu483Pro", "p.Asn409Ser", "p.Asp448His", "p.Glu365Lys"];
  }
  return ["p.Ala40Val", "p.Leu100Pro", "p.Glu150Lys"];
};

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

  const abortAllPendingRequests = () => {
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

  // Styling Classes
  const classRoot = isDark ? "bg-[#0f172a] text-slate-200" : "bg-slate-50 text-slate-800";
  const classHeader = isDark ? "bg-[#1e293b] border-slate-800" : "bg-white border-slate-200 shadow-sm";
  const classHeaderTitle = isDark ? "text-white" : "text-slate-900";
  const classHeaderSub = isDark ? "text-slate-400" : "text-slate-500";
  
  const classCard = isDark ? "bg-[#1e293b] border border-slate-800 shadow-[0_4px_20px_rgba(0,0,0,0.3)] rounded-xl" : "bg-white border border-slate-200 shadow-[0_4px_16px_rgba(0,0,0,0.06)] rounded-xl";
  const classCardHeader = isDark ? "text-white pb-3 border-b border-slate-800/60" : "text-slate-900 pb-3 border-b border-slate-100";
  const classCardTitle = isDark ? "text-white" : "text-slate-900";
  const classCardSubText = isDark ? "text-slate-400" : "text-slate-500";
  const classTextMute = isDark ? "text-slate-400" : "text-slate-500";
  const classTextBody = isDark ? "text-slate-300" : "text-slate-600";
  const classTextBright = isDark ? "text-white" : "text-slate-900 font-bold";
  const classBorderSec = isDark ? "border-slate-800/60" : "border-slate-200/80";
  const classBorderCardSep = isDark ? "border-slate-800" : "border-slate-200";
  
  const classInput = isDark ? "bg-slate-900 border-slate-700 text-slate-100 placeholder-slate-500" : "bg-slate-50 border-slate-200 text-slate-950 placeholder-slate-400 focus:bg-white";
  const classInputLabel = isDark ? "text-white" : "text-slate-800";
  const classBadgeAccent = isDark ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" : "bg-indigo-50 text-indigo-600 border border-indigo-100/80";
  const classSubCard = isDark ? "bg-slate-950/40 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700";

  const [gene, setGene] = useState("PAH");
  const [history, setHistory] = useState<Array<{ gene: string; variant: string; uniprotId: string }>>(() => {
    try {
      const savedEnc = localStorage.getItem(STORAGE_KEY);
      if (savedEnc) {
        const decrypted = deobfuscate(savedEnc);
        if (decrypted) {
          return JSON.parse(decrypted);
        }
      }
      const savedPlain = localStorage.getItem("variantHistory");
      if (savedPlain) {
        const parsed = JSON.parse(savedPlain);
        localStorage.setItem(STORAGE_KEY, obfuscate(savedPlain));
        localStorage.removeItem("variantHistory");
        return parsed;
      }
      return [];
    } catch (e) {
      return [];
    }
  });

  const addToHistory = (g: string, v: string, u: string) => {
    setHistory((prev) => {
      const filtered = prev.filter(
        (item) =>
          !(item.gene.toUpperCase() === g.toUpperCase() && item.variant.toLowerCase() === v.toLowerCase())
      );
      const updated = [{ gene: g.toUpperCase(), variant: v, uniprotId: u }, ...filtered].slice(0, settings.maxHistoryItems);
      try {
        const serialized = JSON.stringify(updated);
        localStorage.setItem(STORAGE_KEY, obfuscate(serialized));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("variantHistory");
    } catch (e) {
      console.error(e);
    }
    setHistory([]);
  };

  const [variant, setVariant] = useState("p.Arg408Trp");
  const [uniprotId, setUniprotId] = useState("P00439");
  const [selectedResidueIndex, setSelectedResidueIndex] = useState<number | null>(408);
  const [hoveredResidueIndex, setHoveredResidueIndex] = useState<number | null>(null);

  const [searchVal, setSearchVal] = useState("PAH p.Arg408Trp");
  const [customGene, setCustomGene] = useState("");
  const [customVariant, setCustomVariant] = useState("");
  const [customUniprot, setCustomUniprot] = useState("");
  const [showCustomInputs, setShowCustomInputs] = useState(false);

  const [copied, setCopied] = useState(false);
  const [customPdbUrl, setCustomPdbUrl] = useState<string | null>(null);
  const [userDirections, setUserDirections] = useState("");

  const [viewMode, setViewMode] = useState<"wildtype" | "mutant">("wildtype");
  const [mutantPdb, setMutantPdb] = useState<string | null>(null);
  const [foldedResidueIndex, setFoldedResidueIndex] = useState<number | null>(null);
  const [isFolding, setIsFolding] = useState(false);
  const [foldingError, setFoldingError] = useState<string | null>(null);
  const [foldingStatus, setFoldingStatus] = useState<"success" | "scwrl" | "fallback" | null>(null);
  const [foldingDdG, setFoldingDdG] = useState<number | null>(null);

  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [compareVariant, setCompareVariant] = useState<string>("p.Arg215Pro");
  const [compareMutantPdb, setCompareMutantPdb] = useState<string | null>(null);
  const [compareFoldedResidueIndex, setCompareFoldedResidueIndex] = useState<number | null>(null);
  const [isFoldingCompare, setIsFoldingCompare] = useState<boolean>(false);
  const [foldingCompareError, setFoldingCompareError] = useState<string | null>(null);
  const [compareFoldingStatus, setCompareFoldingStatus] = useState<"success" | "scwrl" | "fallback" | null>(null);
  const [compareFoldingDdG, setCompareFoldingDdG] = useState<number | null>(null);
  const [comparisonLayout, setComparisonLayout] = useState<"superimposed" | "side-by-side">("superimposed");

  const [isHowToInspectCollapsed, setIsHowToInspectCollapsed] = useState<boolean>(false);
  const [isLegendCollapsed, setIsLegendCollapsed] = useState<boolean>(false);

  const formatEnergyString = (text: string | null | undefined): string => {
    if (!text) return "";
    if (settings.energyUnit === "kcal/mol") return text;
    return text.replace(/([-+]?\d+(?:\.\d+)?)\s*kcal\/mol/gi, (match, valStr) => {
      if (valStr) {
        const kcal = parseFloat(valStr);
        const kj = kcal * 4.184;
        return `${match} [~${kj.toFixed(1)} kJ/mol]`;
      }
      return match;
    });
  };

  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    isLoading: false,
    error: null,
    result: {
      analysis: FALLBACK_ANALYSES["Q13564_p.Arg215Trp"],
      insights: FALLBACK_INSIGHTS["Q13564_p.Arg215Trp"],
      metadata: {
        gene: "NAE1",
        variant: "p.Arg215Trp",
        uniprotId: "Q13564",
        residueIndex: 215,
        wildType: "Arg",
        mutant: "Trp"
      }
    }
  });

  const [loadingStep, setLoadingStep] = useState<string>("Initiating molecular analysis...");

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
    setViewMode("wildtype");
    setMutantPdb(null);
    setFoldedResidueIndex(null);
    setFoldingError(null);
    setCompareMode(false);
    setCompareMutantPdb(null);
    setCompareFoldedResidueIndex(null);
    setFoldingCompareError(null);

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
    setViewMode("wildtype");
    setMutantPdb(null);
    setFoldedResidueIndex(null);
    setFoldingError(null);
    setCompareMode(false);
    setCompareMutantPdb(null);
    setCompareFoldedResidueIndex(null);
    setFoldingCompareError(null);
    
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
          metadata: {
            gene: preset.gene,
            variant: preset.variant,
            uniprotId: preset.uniprotId,
            residueIndex: mutMatch ? parseInt(mutMatch[1], 10) : null,
            wildType: "",
            mutant: ""
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
    setLoadingStep("Translating genomic coordinate / cDNA variant notation via Ensembl VEP...");
    
    try {
      const response = await fetch("/api/v1/translate-variant", {
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
      if (err.name === "AbortError" || signal.aborted) {
        throw err;
      }
      throw new Error(`Translation Error: ${err.message}`);
    }
  };

  const executeAnalysis = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal) => {
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

    let activeSignal = signal;
    if (!activeSignal) {
      if (analysisAbortRef.current) {
        analysisAbortRef.current.abort();
      }
      const controller = new AbortController();
      analysisAbortRef.current = controller;
      activeSignal = controller.signal;
    }

    setAnalysisState(prev => ({ ...prev, isLoading: true, error: null }));
    
    // Clear structural model comparison states for fresh run
    setViewMode("wildtype");
    setMutantPdb(null);
    setFoldedResidueIndex(null);
    setFoldingError(null);
    
    // Animate loader steps for elegant clinical diagnostics
    setLoadingStep("1. Interrogating genomic substitution models...");
    const timer1 = setTimeout(() => {
      setLoadingStep("2. Loading 3D spatial coordinate models from AlphaFold...");
    }, 1200);
    const timer2 = setTimeout(() => {
      setLoadingStep("3. Invoking Gemini biophysical analysis algorithm...");
    }, 2500);

    try {
      // Parallelize fetching of EBI AlphaFold structure to warm cache (HIGH-9)
      const pdbWarmupPromise = fetch(`/api/v1/alphafold-pdb/${targetUniprot}`, { signal: activeSignal }).catch(err => {
        console.warn("AlphaFold PDB concurrent pre-fetch request failed or aborted:", err);
      });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.geminiApiKey) {
        headers["X-Gemini-API-Key"] = settings.geminiApiKey;
      }

      const response = await fetchWithRetry("/api/v1/analyze-variant", {
        method: "POST",
        headers,
        body: JSON.stringify({
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot,
          userDirections: userDirections || undefined
        }),
        signal: activeSignal
      });

      clearTimeout(timer1);
      clearTimeout(timer2);

      const resText = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(resText);
      } catch (e: any) {
        if (!response.ok) {
          throw new Error(`Genomic analysis endpoint failed (status: ${response.status}). Response: ${resText.slice(0, 300)}`);
        }
        throw new Error(`Failed to parse response JSON: ${e.message}. Response: ${resText.slice(0, 300)}`);
      }

      if (!response.ok) {
        const isConfigError = data.isConfigError || data.error?.details?.isConfigError;
        if (response.status === 503 && isConfigError) {
          const fallbackKey = `${targetUniprot}_${targetVariant}`;
          if (FALLBACK_ANALYSES[fallbackKey]) {
            setAnalysisState({
              isLoading: false,
              error: null,
              result: {
                analysis: FALLBACK_ANALYSES[fallbackKey],
                insights: FALLBACK_INSIGHTS[fallbackKey] || null,
                metadata: {
                  gene: targetGene,
                  variant: targetVariant,
                  uniprotId: targetUniprot,
                  residueIndex: (data.metadata?.residueIndex || null),
                  wildType: "",
                  mutant: ""
                }
              }
            });
            addToHistory(targetGene, targetVariant, targetUniprot);
            return;
          }
        }
        throw new Error(getErrorMessage(data, "Genomic analysis endpoint failed."));
      }

      const validatedData = analyzeVariantResponseSchema.parse(data);

      setAnalysisState({
        isLoading: false,
        error: null,
        result: validatedData as AnalysisResult
      });
      addToHistory(targetGene, targetVariant, targetUniprot);

      if (validatedData.metadata?.residueIndex) {
        setSelectedResidueIndex(validatedData.metadata.residueIndex);
      }
    } catch (err: any) {
      clearTimeout(timer1);
      clearTimeout(timer2);
      
      if (err.name === "AbortError" || activeSignal.aborted) {
        console.log("Analysis execution aborted.");
        return;
      }

      console.error("Analysis execution error:", err);
      
      const fallbackKey = `${targetUniprot}_${targetVariant}`;
      if (FALLBACK_ANALYSES[fallbackKey]) {
        setAnalysisState({
          isLoading: false,
          error: null,
          result: {
            analysis: FALLBACK_ANALYSES[fallbackKey],
            insights: FALLBACK_INSIGHTS[fallbackKey] || null,
            metadata: {
              gene: targetGene,
              variant: targetVariant,
              uniprotId: targetUniprot,
              residueIndex: parseInt(targetVariant.replace(/\D/g, ""), 10) || null,
              wildType: "",
              mutant: ""
            }
          }
        });
        addToHistory(targetGene, targetVariant, targetUniprot);
      } else {
        setAnalysisState({
          isLoading: false,
          error: `Biophysical calculation failed: ${err.message || "Endpoint error."} Ensure Google Gemini API Key is configured in the search panel or Settings.`,
          result: null
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

  const fetchMutantFold = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal) => {
    let activeSignal = signal;
    if (!activeSignal) {
      if (mutantFoldAbortRef.current) {
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
      const wtPdbRes = await fetch(`/api/v1/alphafold-pdb/${targetUniprot}`, { signal: activeSignal });
      if (!wtPdbRes.ok) {
        throw new Error(`Failed to load wild-type template structure (status: ${wtPdbRes.status})`);
      }
      const wtPdb = await wtPdbRes.text();

      const mutation = mapMutationToFoldXFormat(targetVariant);
      console.log(`[Biophysical Modeling] Mapping mutation to FoldX input format: ${mutation}`);

      const response = await fetchWithRetry("/api/v1/generate-mutant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wtPdb,
          mutation,
          uniprotId: targetUniprot
        }),
        signal: activeSignal
      });

      if (!response.ok) {
        const text = await response.text();
        let errMsg = "Biophysical mutant simulation failed.";
        try {
          const errData = JSON.parse(text);
          errMsg = getErrorMessage(errData, errMsg);
        } catch (_) {
          errMsg = `Biophysical mutant simulation failed (status: ${response.status}). Response: ${text.slice(0, 300)}`;
        }
        throw new Error(errMsg);
      }

      const resText = await response.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (parseErr: any) {
        throw new Error(`Failed to parse response JSON: ${parseErr.message}. Response: ${resText.slice(0, 300)}`);
      }

      const validatedData = generateMutantResponseSchema.parse(data);
      setMutantPdb(validatedData.pdb);
      setFoldedResidueIndex(validatedData.foldedResidueIndex);
      setFoldingStatus(validatedData.status);
      setFoldingDdG(validatedData.ddG);
    } catch (err: any) {
      if (err.name === "AbortError" || activeSignal.aborted) {
        console.log("fetchMutantFold aborted/canceled.");
        return;
      }
      console.error("Mutant biophysical folding error:", err);
      setFoldingError(err.message || "Failed to generate biophysical structural model.");
    } finally {
      if (!activeSignal.aborted) {
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
      const wtPdbRes = await fetch(`/api/v1/alphafold-pdb/${targetUniprot}`, { signal: activeSignal });
      if (!wtPdbRes.ok) {
        throw new Error(`Failed to load wild-type template structure (status: ${wtPdbRes.status})`);
      }
      const wtPdb = await wtPdbRes.text();

      const mutation = mapMutationToFoldXFormat(targetVariant);
      console.log(`[Biophysical Modeling] Mapping comparison mutation to FoldX format: ${mutation}`);

      const response = await fetchWithRetry("/api/v1/generate-mutant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wtPdb,
          mutation,
          uniprotId: targetUniprot
        }),
        signal: activeSignal
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
    } catch (err: any) {
      if (err.name === "AbortError" || activeSignal.aborted) {
        console.log("fetchCompareMutantFold aborted/canceled.");
        return;
      }
      console.error("Comparison biophysical folding error:", err);
      setFoldingCompareError(err.message || "Failed to generate comparison biophysical structural model.");
    } finally {
      if (!activeSignal.aborted) {
        setIsFoldingCompare(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (viewMode === "mutant" && !mutantPdb && !isFolding && gene && variant && uniprotId) {
      fetchMutantFold(gene, variant, uniprotId, controller.signal);
    }
    return () => {
      controller.abort();
    };
  }, [viewMode, mutantPdb, gene, variant, uniprotId]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    abortAllPendingRequests();

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    if (showCustomInputs) {
      if (!customGene || !customVariant) return;

      if (isVcfOrCdnaNotation(customVariant)) {
        try {
          const resolved = await translateVariantNotation(customVariant, activeSignal);
          
          setGene(resolved.gene);
          setVariant(resolved.variant);
          setUniprotId(resolved.uniprotId);
          setSearchVal(`${resolved.gene} ${resolved.variant}`);
          setCustomGene(resolved.gene);
          setCustomVariant(resolved.variant);
          setCustomUniprot(resolved.uniprotId);
          
          const resMatch = resolved.variant.match(/\d+/);
          setSelectedResidueIndex(resMatch ? parseInt(resMatch[0], 10) : null);
          
          executeAnalysis(resolved.gene, resolved.variant, resolved.uniprotId, activeSignal);
        } catch (err: any) {
          if (err.name === "AbortError" || activeSignal.aborted) return;
          setAnalysisState({
            isLoading: false,
            error: err.message,
            result: null
          });
        }
        return;
      }
      
      try {
        parseMutationResidues(customVariant);
      } catch (err: any) {
        setAnalysisState({
          isLoading: false,
          error: `Validation Error: ${err.message}`,
          result: null
        });
        return;
      }
      
      setAnalysisState(prev => ({ ...prev, isLoading: true, error: null }));
      setLoadingStep("Resolving gene name to UniProt and AlphaFold coordinates...");

      try {
        const resolveRes = await fetch("/api/v1/resolve-gene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gene: customGene }),
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

        setGene(customGene.toUpperCase());
        setVariant(customVariant);
        setUniprotId(resolvedUniprot);
        setCustomPdbUrl(resolvedPdbUrl);
        
        const resMatch = customVariant.match(/\d+/);
        if (resMatch) {
          setSelectedResidueIndex(parseInt(resMatch[0], 10));
        } else {
          setSelectedResidueIndex(null);
        }

        executeAnalysis(customGene.toUpperCase(), customVariant, resolvedUniprot, activeSignal);
      } catch (err: any) {
        if (err.name === "AbortError" || activeSignal.aborted) {
          console.log("handleSearchSubmit custom search aborted.");
          return;
        }
        setAnalysisState({
          isLoading: false,
          error: `Gene resolution failed: ${err.message}`,
          result: null
        });
      }
    } else {
      const text = searchVal.trim();
      if (!text) return;

      let notationToTranslate = "";
      const parts = text.split(/\s+/);
      if (isVcfOrCdnaNotation(text)) {
        notationToTranslate = text;
      } else if (parts.length >= 2 && isVcfOrCdnaNotation(parts[parts.length - 1])) {
        notationToTranslate = parts[parts.length - 1];
      } else if (parts.length === 1 && isVcfOrCdnaNotation(parts[0])) {
        notationToTranslate = parts[0];
      }

      if (notationToTranslate) {
        try {
          const resolved = await translateVariantNotation(notationToTranslate, activeSignal);
          
          setGene(resolved.gene);
          setVariant(resolved.variant);
          setUniprotId(resolved.uniprotId);
          setSearchVal(`${resolved.gene} ${resolved.variant}`);
          setCustomGene(resolved.gene);
          setCustomVariant(resolved.variant);
          setCustomUniprot(resolved.uniprotId);
          
          const resMatch = resolved.variant.match(/\d+/);
          setSelectedResidueIndex(resMatch ? parseInt(resMatch[0], 10) : null);
          
          executeAnalysis(resolved.gene, resolved.variant, resolved.uniprotId, activeSignal);
        } catch (err: any) {
          if (err.name === "AbortError" || activeSignal.aborted) return;
          setAnalysisState({
            isLoading: false,
            error: err.message,
            result: null
          });
        }
        return;
      }

      const matchedPreset = VARIANT_PRESETS.find(p => 
        text.toLowerCase().includes(p.gene.toLowerCase()) || 
        text.toLowerCase().includes(p.uniprotId.toLowerCase())
      );

      if (matchedPreset) {
        handleSelectPreset(matchedPreset);
        executeAnalysis(matchedPreset.gene, matchedPreset.variant, matchedPreset.uniprotId, activeSignal);
      } else {
        const parts = text.split(/\s+/);
        let parsedGene = gene;
        let parsedVariant = variant;

        if (parts.length >= 2) {
          parsedGene = parts[0].toUpperCase();
          parsedVariant = parts[1];
        } else if (parts.length === 1 && parts[0].includes("p.")) {
          parsedVariant = parts[0];
        }

        try {
          parseMutationResidues(parsedVariant);
        } catch (err: any) {
          setAnalysisState({
            isLoading: false,
            error: `Validation Error: ${err.message}`,
            result: null
          });
          return;
        }

        setAnalysisState(prev => ({ ...prev, isLoading: true, error: null }));
        setLoadingStep("Resolving gene name to UniProt and AlphaFold coordinates...");

        try {
          const resolveRes = await fetch("/api/v1/resolve-gene", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ gene: parsedGene }),
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

          setGene(parsedGene);
          setVariant(parsedVariant);
          setUniprotId(resolvedUniprot);
          setCustomPdbUrl(resolvedPdbUrl);

          const resMatch = parsedVariant.match(/\d+/);
          if (resMatch) {
            setSelectedResidueIndex(parseInt(resMatch[0], 10));
          } else {
            setSelectedResidueIndex(null);
          }

          executeAnalysis(parsedGene, parsedVariant, resolvedUniprot, activeSignal);
        } catch (err: any) {
          if (err.name === "AbortError" || activeSignal.aborted) {
            console.log("handleSearchSubmit simple search aborted.");
            return;
          }
          setAnalysisState({
            isLoading: false,
            error: `Gene resolution failed: ${err.message}`,
            result: null
          });
        }
      }
    }
  };

  const handleCopyReport = () => {
    if (!analysisState.result?.analysis) return;
    navigator.clipboard.writeText(analysisState.result.analysis);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Pathogenicity severity calculation
  const getPathogenicityBadge = (result: any) => {
    if (!result) return null;
    
    // 1. Try to use deterministic pathogenicity predicted by Gemini in insights (S-2)
    const geminiPathogenicity = result.insights?.pathogenicity;
    // 2. If not available, fallback to keyword matching
    const label = geminiPathogenicity || (result.analysis ? getPathogenicityBadgeFromText(result.analysis) : "VUS (Uncertain)");
    
    const labelLower = label.toLowerCase();
    if (labelLower.includes("likely pathogenic")) {
      return { label: "Likely Pathogenic", bg: isDark ? "bg-orange-500/10 border-orange-500/20 text-orange-400 hover:bg-orange-500/20" : "bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100" };
    } else if (labelLower.includes("pathogenic")) {
      return { label: "Pathogenic", bg: isDark ? "bg-rose-500/10 border-rose-500/20 text-rose-400 hover:bg-rose-500/20" : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100" };
    } else if (labelLower.includes("likely benign")) {
      return { label: "Likely Benign", bg: isDark ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450 hover:bg-emerald-500/20" : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100" };
    } else if (labelLower.includes("benign") || labelLower.includes("tolerated")) {
      return { label: "Benign / Tolerated", bg: isDark ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-450 hover:bg-emerald-500/20" : "bg-emerald-50 border-emerald-200 text-emerald-750 hover:bg-emerald-100" };
    }
    return { label: "VUS (Uncertain)", bg: isDark ? "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20" : "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100" };
  };

  const getPathogenicityBadgeFromText = (analysisText: string): string => {
    const textLower = analysisText.toLowerCase();
    if (textLower.includes("pathogenic") && !textLower.includes("likely pathogenic") && !textLower.includes("possibly pathogenic")) {
      return "Pathogenic";
    } else if (textLower.includes("likely pathogenic") || textLower.includes("highly disruptive")) {
      return "Likely Pathogenic";
    } else if (textLower.includes("benign")) {
      return "Benign";
    }
    return "VUS";
  };

  const getVariantDisruption = (v: string, designInsights?: any, designAnalysis?: string) => {
    if (!v) return null;
    const infoText = (
      (v) + " " + 
      (designInsights?.biochemicalShift || "") + " " + 
      (designInsights?.structuralImpact || "") + " " + 
      (designAnalysis || "")
    ).toLowerCase();

    const causesStericClash = infoText.includes("clash") || infoText.includes("steric") || infoText.includes("clashing") || infoText.includes("bulky") || infoText.includes("trp") || infoText.includes("tryptophan") || infoText.includes("indole") || infoText.includes("conformational collapse");
    const causesHbondLoss = infoText.includes("hydrogen bond") || infoText.includes("h-bond") || infoText.includes("salt-bridge") || infoText.includes("salt bridge") || infoText.includes("coordination") || infoText.includes("ionic") || infoText.includes("stabilizing") || infoText.includes("polar contacts") || infoText.includes("broken bonds");

    if (causesStericClash && causesHbondLoss) {
      return {
        type: "both" as const,
        title: "Steric Clash & H-Bond Loss Identified",
        description: `Variant ${v} is predicted to trigger severe steric clashing & simultaneously disrupt key h-bond/salt-bridge stabilizing links.`
      };
    } else if (causesStericClash) {
      return {
        type: "clash" as const,
        title: "Significant Steric Clash Predicted",
        description: `Variant ${v} introduces a bulky residue causing major localized steric crowding and volume-displacement conflicts.`
      };
    } else if (causesHbondLoss) {
      return {
        type: "hbond" as const,
        title: "Loss of Critical H-Bond/Salt-Bridge",
        description: `Variant ${v} removes chemical coordinates required for native hydrogen bond or ionic salt-bridge stability.`
      };
    }
    return null;
  };

  const disruptionWarningVariant1 = viewMode === "mutant" 
    ? getVariantDisruption(variant, analysisState.result?.insights, analysisState.result?.analysis)
    : null;

  const disruptionWarningVariant2 = compareMode 
    ? getVariantDisruption(compareVariant, FALLBACK_INSIGHTS[`${uniprotId}_${compareVariant}`] || {}, "")
    : null;

  const pathogenicity = analysisState.result ? getPathogenicityBadge(analysisState.result) : null;

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
      showCustomInputs,
      copied,
      customPdbUrl,
      viewMode,
      mutantPdb,
      foldedResidueIndex,
      isFolding,
      foldingError,
      foldingStatus,
      foldingDdG,
      compareMode,
      compareVariant,
      compareMutantPdb,
      compareFoldedResidueIndex,
      isFoldingCompare,
      foldingCompareError,
      compareFoldingStatus,
      compareFoldingDdG,
      comparisonLayout,
      showPolarContacts,
      settings,
      isSettingsOpen,
      isHowToInspectCollapsed,
      isLegendCollapsed,
      analysisState,
      loadingStep,
      history,
      userDirections,

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
      pathogenicity,
    },
    actions: {
      setTheme,
      toggleTheme,
      setGene,
      setVariant,
      setUniprotId,
      setSelectedResidueIndex,
      setHoveredResidueIndex,
      setSearchVal,
      setCustomGene,
      setCustomVariant,
      setCustomUniprot,
      setShowCustomInputs,
      setCopied,
      setCustomPdbUrl,
      setViewMode,
      setMutantPdb,
      setFoldedResidueIndex,
      setIsFolding,
      setFoldingError,
      setFoldingStatus,
      setFoldingDdG,
      setCompareMode,
      setCompareVariant,
      setCompareMutantPdb,
      setCompareFoldedResidueIndex,
      setIsFoldingCompare,
      setFoldingCompareError,
      setCompareFoldingStatus,
      setCompareFoldingDdG,
      setComparisonLayout,
      setShowPolarContacts,
      setSettings,
      setIsSettingsOpen,
      setIsHowToInspectCollapsed,
      setIsLegendCollapsed,
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
      fetchCompareMutantFold,
      handleSearchSubmit,
      handleCopyReport,
    }
  };
}

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { z } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, { message: "Number must be finite" });
const nullableFiniteNumber = z.number().nullable().refine(val => val === null || Number.isFinite(val), { message: "Number must be finite" });

// Zod validation schemas for server responses (MOD-6)
export const analyzeVariantResponseSchema = z.object({
  analysis: z.string().nullable().optional(),
  insights: z.object({
    biochemicalShift: z.string(),
    structuralImpact: z.string(),
    pathogenicity: z.string().optional(),
    plausibility: z.string().optional(),
    acmgCriteria: z.preprocess(
      (val) => val ?? [],
      z.array(z.object({
        code: z.string(),
        reason: z.string(),
        source: z.enum(["database_verified", "ai_suggested"]).optional()
      }))
    ),
    acmgVerdict: z.string().optional(),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  ruleBasedInsights: z.object({
    plausibility: z.string(),
    acmgVerdict: z.string(),
    acmgCriteria: z.array(z.object({
      code: z.string(),
      reason: z.string(),
      source: z.enum(["database_verified", "ai_suggested"]).optional()
    })),
    partialEvidence: z.object({
      available: z.array(z.string()),
      unavailable: z.array(z.string())
    }).optional()
  }).nullable().optional(),
  clinvar: z.object({
    classification: z.string(),
    lastEvaluated: z.string(),
    reviewStatus: z.string(),
    alleleFrequencies: z.array(z.object({
      source: z.string(),
      value: z.preprocess(
        (val) => {
          if (val === null || val === undefined) return null;
          const parsed = typeof val === "number" ? val : parseFloat(String(val));
          return isNaN(parsed) ? null : parsed;
        },
        nullableFiniteNumber
      )
    })),
    trait: z.string(),
    uid: z.string().nullable()
  }).nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: nullableFiniteNumber,
    wildType: z.string(),
    mutant: z.string(),
    pdbId: z.string().nullable().optional(),
    pdbSource: z.string().nullable().optional()
  }),
  predictorData: z.object({
    available: z.boolean(),
    amPathogenicity: nullableFiniteNumber,
    amClass: z.string().nullable(),
    caddPhred: nullableFiniteNumber,
    eveScore: nullableFiniteNumber.optional(),
    eveClass: z.string().nullable().optional(),
    proteinName: z.string().nullable().optional()
  }).nullable().optional(),
  conservationData: z.object({
    available: z.boolean(),
    revel: nullableFiniteNumber,
    gerp: nullableFiniteNumber,
    phylop: nullableFiniteNumber,
    consurf: nullableFiniteNumber
  }).nullable().optional(),
  landscapeData: z.array(z.object({
    residx: z.number(),
    revelMax: z.number().nullable(),
    amMax: z.number().nullable(),
    gerp: z.number().nullable(),
    phylop: z.number().nullable()
  })).nullable().optional(),
  stringInteractions: z.array(z.object({
    partner: z.string(),
    score: finiteNumber
  })).nullable().optional(),
  disruptionPredictor: z.object({
    level: z.enum(["high", "low"]),
    reason: z.string(),
    plddt: z.number(),
    burialStatus: z.enum(["core", "surface", "boundary"]).optional(),
    neighborCount: z.number().optional(),
    rsa: z.number().optional(),
    sasa: z.number().optional()
  }).optional(),
  uniprotFeatures: z.object({
    features: z.array(z.object({
      type: z.string(),
      description: z.string(),
      start: z.number(),
      end: z.number()
    })),
    geneName: z.string().optional()
  }).nullable().optional(),
  gnomadConstraint: z.object({
    missense_z: z.number().nullable(),
    oe_mis: z.number().nullable(),
    pli: z.number().nullable(),
    isPP2Constrained: z.boolean()
  }).nullable().optional(),
  transcriptId: z.string().optional(),
  isCanonical: z.boolean().optional(),
  transcriptWarning: z.string().optional(),
  gnomadFrequency: z.object({
    maxAF: z.number().nullable(),
    groupMaxAF: z.number().nullable().optional(),
    genomeAF: z.number().nullable(),
    exomeAF: z.number().nullable(),
    genomeAC: z.number().nullable().optional(),
    exomeAC: z.number().nullable().optional(),
    genomeAN: z.number().nullable().optional(),
    exomeAN: z.number().nullable().optional(),
    nHomozygous: z.number().nullable(),
    dataset: z.string()
  }).nullable().optional(),
  esm2: z.object({
    llr: z.number().nullable(),
    verdict: z.string().nullable()
  }).nullable().optional()
});

export const generateMutantResponseSchema = z.object({
  pdb: z.string(),
  ddG: nullableFiniteNumber,
  status: z.enum(["success", "scwrl"]),
  foldedResidueIndex: finiteNumber,
  energetics: z.object({
    foldx: nullableFiniteNumber,
    foldxMean: nullableFiniteNumber.optional(),
    foldxSd: nullableFiniteNumber.optional(),
    vdw: nullableFiniteNumber.optional(),
    electrostatics: nullableFiniteNumber.optional(),
    stericClashWarning: z.boolean().optional(),
    localSidechainRmsd: nullableFiniteNumber.optional(),
    dynamut2: nullableFiniteNumber,
    ddmut: nullableFiniteNumber.optional(),
    rasp: nullableFiniteNumber.optional(),
    ddgun: nullableFiniteNumber.optional(),
    consensusVerdict: z.string().nullable().optional()
  }).optional(),
  dynamut2JobId: z.string().nullable().optional(),
  dynamut2Status: z.string().nullable().optional(),
  ddmutJobId: z.string().nullable().optional(),
  ddmutStatus: z.string().nullable().optional()
});

export const nearestResiduesResponseSchema = z.object({
  residues: z.array(z.object({
    index: finiteNumber,
    name: z.string(),
    distance: finiteNumber,
    properties: z.string(),
    role: z.string(),
    classBadge: z.string()
  })),
  source: z.string()
});

export const pocketFinderResponseSchema = z.object({
  pocketResidues: z.array(z.object({
    index: finiteNumber,
    name: z.string(),
    distance: finiteNumber,
    score: finiteNumber,
    role: z.string(),
    type: z.string()
  })),
  pocketScore: finiteNumber,
  pocketVolume: finiteNumber,
  likelyCofactor: z.string(),
  pocketDistance: nullableFiniteNumber,
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
import { AnalysisState, VariantPreset, UserSettings, AnalysisResult, NearestResidue, PocketResult, EnergeticsData, StructuralDiffResult } from "./types";
import { useSettings } from "./context/SettingsContext";
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";
import { useSearchHistory } from "./hooks/useSearchHistory";
import { useBiophysicalModeling } from "./hooks/useBiophysicalModeling";
import { usePredictorData } from "./hooks/usePredictorData";
import { useClinicalEvidence } from "./hooks/useClinicalEvidence";
export function computeConsensusVerdict(energetics: Partial<EnergeticsData> | null): string {
  if (!energetics) return "Low-Risk (Neutral Stability)";
  const foldxMean = energetics.foldxMean ?? energetics.foldx ?? null;
  const dynamut2 = energetics.dynamut2 ?? null;
  const ddmut = energetics.ddmut ?? null;
  const rasp = energetics.rasp ?? null;
  const ddgun = energetics.ddgun ?? null;

  const foldxDestab = foldxMean !== null && foldxMean >= 1.5;
  const dynamutDestab = dynamut2 !== null && dynamut2 <= -1.0;
  const ddmutDestab = ddmut !== null && ddmut <= -1.0;
  const raspDestab = rasp !== null && rasp <= -1.0;
  const ddgunDestab = ddgun !== null && ddgun <= -1.0;

  const destabCount = [foldxDestab, dynamutDestab, ddmutDestab, raspDestab, ddgunDestab].filter(Boolean).length;
  const availableCount = [foldxMean, dynamut2, ddmut, rasp, ddgun].filter(v => v !== null).length;

  if (destabCount >= 2) {
    return "High-Risk Destabilizing (Consensus)";
  } else if (destabCount === 1 && availableCount >= 2) {
    return "Moderate-Risk Conflicting Stability";
  }
  return "Low-Risk (Neutral Stability)";
}

export function buildEnergeticsQueryString(energetics: EnergeticsData | null): string {
  if (!energetics) return "";
  const q = new URLSearchParams();
  const foldxVal = energetics.foldxMean ?? energetics.foldx;
  if (foldxVal !== null && foldxVal !== undefined) q.set("foldx", foldxVal.toString());
  if (energetics.ddgun !== null && energetics.ddgun !== undefined) q.set("ddgun", energetics.ddgun.toString());
  if (energetics.rasp !== null && energetics.rasp !== undefined) q.set("rasp", energetics.rasp.toString());
  if (energetics.ddmut !== null && energetics.ddmut !== undefined) q.set("ddmut", energetics.ddmut.toString());
  if (energetics.dynamut2 !== null && energetics.dynamut2 !== undefined) q.set("dynamut2", energetics.dynamut2.toString());
  return q.toString();
}


async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  maxRetries = 3,
  initialDelay = 1000,
  backoffFactor = 2
): Promise<Response> {
  let attempt = 0;
  
  while (true) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    
    const onSignalAbort = () => controller.abort();
    if (options.signal) {
      options.signal.addEventListener("abort", onSignalAbort);
      if (options.signal.aborted) {
        controller.abort();
      }
    }
    
    const fetchOptions = { ...options, signal: controller.signal };
    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }
      if (response.ok) {
        return response;
      }
      
      // If it's a 503 (Cold Start) and we have retries left:
      if (response.status === 503 && attempt < maxRetries) {
        // Read body to see if it's an API key missing configuration error
        try {
          const clone = response.clone();
          const text = await clone.text();
          if (text.includes("API_KEY_MISSING") || text.includes("isConfigError")) {
            return response; // Bypassing retry for missing/invalid credentials configuration (HIGH-3)
          }
        } catch (e) {
          // ignore error
        }

        attempt++;
        const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
        console.warn(`[Retry] Endpoint ${url} returned status ${response.status}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeoutIdDelay);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };
          const timeoutIdDelay = setTimeout(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", onAbort);
            }
            resolve();
          }, delay);
          if (options.signal) {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
        });
        continue;
      }
      return response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onSignalAbort);
      }
      
      if (err.name === "AbortError") {
        throw err;
      }
      if (attempt < maxRetries) {
        attempt++;
        const delay = initialDelay * Math.pow(backoffFactor, attempt - 1);
        console.warn(`[Retry] Endpoint ${url} threw error: ${err.message || err}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timeoutIdDelay);
            reject(new DOMException("The user aborted a request.", "AbortError"));
          };
          const timeoutIdDelay = setTimeout(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", onAbort);
            }
            resolve();
          }, delay);
          if (options.signal) {
            options.signal.addEventListener("abort", onAbort, { once: true });
          }
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

// Local storage key for non-sensitive public variant history cache (non-PHI)
const STORAGE_KEY = "variantHistory";

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
  if (normalized === "GBA1" || normalized === "GBA") {
    return ["p.Leu483Pro", "p.Asn409Ser", "p.Asp448His", "p.Glu365Lys"];
  }
  if (normalized === "KIF1A") {
    return ["p.Arg254Trp", "p.Val8Met", "p.Ala255Val", "p.Thr99Met"];
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
  const pendingResiduesRef = useRef<Set<string>>(new Set());

  const fetchWithAuth = useCallback(async (
    url: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    const headers = { ...(options.headers as Record<string, string> || {}) };
    if (settings.geminiSessionId) {
      headers["X-Gemini-Session-ID"] = settings.geminiSessionId;
    }
    if (settings.appApiToken) {
      headers["Authorization"] = `Bearer ${settings.appApiToken}`;
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
            response = await fetchWithRetry(url, { ...options, headers: retryHeaders });
          }
        }
      } catch (reauthErr) {
        console.error("Transparent re-authentication failed:", reauthErr);
      }
    }
    
    return response;
  }, [settings.geminiSessionId, settings.geminiApiKey, settings.appApiToken, updateSetting]);

  const abortAllPendingRequests = () => {
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
  const [showCustomInputs, setShowCustomInputs] = useState(false);

  const [copied, setCopied] = useState(false);
  const [customPdbUrl, setCustomPdbUrl] = useState<string | null>(null);
  const [userDirections, setUserDirections] = useState("");

  const [viewMode, setViewMode] = useState<"wildtype" | "mutant">("wildtype");
  const [disruptionPredictor, setDisruptionPredictor] = useState<{ level: "high" | "low"; reason: string; plddt: number } | null>(null);

  const [notifications, setNotifications] = useState<{ id: string; type: "success" | "info" | "error"; message: string }[]>([]);

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
    structuralDiff, setStructuralDiff,
    compareStructuralDiff, setCompareStructuralDiff,
    computedPocket, setComputedPocket,
    isPocketLoading, setIsPocketLoading,
    pocketError, setPocketError,
    dynamutPollIntervalRef, dynamutComparePollIntervalRef,
    ddmutPollIntervalRef, ddmutComparePollIntervalRef,
    lastFetchedFoldRef,
    clearDynaMutPoll, clearDynaMutComparePoll,
    clearDdmutPoll, clearDdmutComparePoll,
    fetchPocketInfo
  } = biophysical;

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

    setAnalysisState({ isLoading: true, error: null, result: null });
    setIsBiophysicalLoading(true);
    setIsClinicalLoading(true);
    
    // Clear structural model comparison states for fresh run
    setViewMode("wildtype");
    setDisruptionPredictor(null);
    setTriageOverride(false);
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
      // Trigger FoldX/DynaMut2 calculation early in the background
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
      const pdbWarmupPromise = fetch(`/api/v1/alphafold-pdb/${targetUniprot}${posQuery}`, {
        signal: activeSignal,
        headers: warmupHeaders
      }).catch(err => {
        console.warn("AlphaFold PDB concurrent pre-fetch request failed or aborted:", err);
      });

      let biophysicalResult: any = null;
      let biophysicalError: string | null = null;

      // Concurrently kick off the biophysical description query so it resolves quickly in parallel
      const biophysicalPromise = fetchWithAuth("/api/v1/analyze-variant-biophysical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot
        }),
        signal: activeSignal
      }).then(async (res) => {
        setIsBiophysicalLoading(false);
        if (res.ok) {
          const bpData = await res.json();
          biophysicalResult = bpData;
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
        } else {
          let errorMsg = "The biophysical analysis request failed.";
          try {
            const errData = await res.json();
            if (errData?.error?.message) {
              errorMsg = errData.error.message;
            }
          } catch (_) {}
          biophysicalError = errorMsg;
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
        }
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
                biochemicalShift: `⚠️ **Biophysical Shift Unavailable**\n\nThe request encountered a connection error: ${errorMsg}`,
                structuralImpact: `⚠️ **Structural Impact Unavailable**\n\nThe request encountered a connection error: ${errorMsg}`
              }
            }
          };
        });
      });

      let response = await fetchWithAuth("/api/v1/analyze-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gene: targetGene,
          variant: targetVariant,
          uniprotId: targetUniprot,
          userDirections: userDirections || undefined,
          acmgWeighting: settings.acmgWeighting
        }),
        signal: activeSignal
      });

      clearTimeout(timer1);
      clearTimeout(timer2);

      let resText = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(resText);
      } catch (e: any) {
        if (!response.ok) {
          throw new Error(`Genomic analysis endpoint failed (status: ${response.status}).`);
        }
        throw new Error("Failed to parse response JSON.");
      }

      if (!response.ok) {
        throw new Error(getErrorMessage(data, "Genomic analysis endpoint failed."));
      }

      const validatedData = analyzeVariantResponseSchema.parse(data);
      const predictorVal = validatedData.disruptionPredictor || { level: "low" as const, reason: "PDB structure mapping not resolved", plddt: 100 };
      setDisruptionPredictor(predictorVal);
      setTriageOverride(false);

      // Build initial insights incorporating buffered biophysical results or error messages to prevent data race drops (FE-2)
      let initialInsights: any = null;
      if (biophysicalResult) {
        initialInsights = {
          biochemicalShift: biophysicalResult.biochemicalShift,
          structuralImpact: biophysicalResult.structuralImpact,
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
            acmgVerdict: validatedData.ruleBasedInsights.acmgVerdict,
            acmgCriteria: validatedData.ruleBasedInsights.acmgCriteria,
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
            mutant: validatedData.metadata.mutant
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
          esm2: validatedData.esm2 || null
        }
      });
      addToHistory(targetGene, targetVariant, targetUniprot);

      // Trigger FoldX/DynaMut2 calculation is now done early at the start of executeAnalysis

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
              uniprotFeatures: validatedData.uniprotFeatures
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
      clearTimeout(timer1);
      clearTimeout(timer2);
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
              mutant: ""
            }
          }
        });
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

  const fetchMutantFold = async (targetGene: string, targetVariant: string, targetUniprot: string, signal?: AbortSignal) => {
    const key = `${targetGene}_${targetVariant}`;
    lastFetchedFoldRef.current = key;

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
      if (selectedResidueIndex !== null) {
        fetchNearestResidues(targetUniprot, targetVariant, selectedResidueIndex, wtPdb, activeSignal);
      }

      const mutation = mapMutationToFoldXFormat(targetVariant);
      if (import.meta.env.DEV) {
        console.log(`[Biophysical Modeling] Mapping mutation to FoldX input format: ${mutation}`);
      }

      const response = await fetchWithAuth("/api/v1/generate-mutant", {
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
      setFoldingEnergetics(validatedData.energetics || {
        foldx: validatedData.ddG,
        dynamut2: null,
        ddmut: null,
        rasp: null,
        ddgun: null
      });

      const posVal = posMatch ? parseInt(posMatch[0], 10) : 0;
      if (validatedData.pdb && wtPdb && posVal) {
        fetchStructuralDiff(wtPdb, validatedData.pdb, posVal, "A", false, activeSignal);
      }

      const returnedStatus = validatedData.dynamut2Status;
      setDynamut2Status(
        returnedStatus === "pending" || returnedStatus === "unavailable" || returnedStatus === "done"
          ? returnedStatus
          : null
      );

      const returnedDdmutStatus = validatedData.ddmutStatus;
      setDdmutStatus(
        returnedDdmutStatus === "pending" || returnedDdmutStatus === "unavailable" || returnedDdmutStatus === "done"
          ? returnedDdmutStatus
          : null
      );

      if (validatedData.dynamut2JobId) {
        clearDynaMutPoll();
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts at 10s interval = 5 minutes timeout
        const jobId = validatedData.dynamut2JobId;
        addNotification("info", `DynaMut2 calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        const poll = async () => {
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(foldingEnergetics);
            const pollRes = await fetchWithAuth(`/api/v1/dynamut2-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DynaMut2 Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setFoldingEnergetics(prev => {
                const base = prev || {
                  foldx: validatedData.ddG,
                  ddgun: validatedData.energetics?.ddgun ?? null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated = {
                  ...base,
                  dynamut2: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setDynamut2Status("done");
              clearDynaMutPoll();
              addNotification("success", `DynaMut2 prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
            } else if (pollData.status === "ERROR") {
              setDynamut2Status("unavailable");
              clearDynaMutPoll();
              addNotification("error", `DynaMut2 prediction failed for ${targetGene} ${targetVariant}.`);
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DynaMut2 Polling Error]:", pollErr);
            setDynamut2Status("unavailable");
            clearDynaMutPoll();
            addNotification("error", `DynaMut2 polling encountered an error: ${pollErr.message || pollErr}.`);
          }
          
          if (attempts >= maxAttempts) {
            setDynamut2Status("unavailable");
            clearDynaMutPoll();
            addNotification("error", `DynaMut2 prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
          }
        };

        const intervalId = setInterval(poll, 10000);
        dynamutPollIntervalRef.current = intervalId;
      }

      if (validatedData.ddmutJobId) {
        clearDdmutPoll();
        let attempts = 0;
        const maxAttempts = 30;
        const jobId = validatedData.ddmutJobId;
        addNotification("info", `DDMut calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        const poll = async () => {
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(foldingEnergetics);
            const pollRes = await fetchWithAuth(`/api/v1/ddmut-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DDMut Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setFoldingEnergetics(prev => {
                const base = prev || {
                  foldx: validatedData.ddG,
                  ddgun: validatedData.energetics?.ddgun ?? null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated = {
                  ...base,
                  ddmut: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setDdmutStatus("done");
              clearDdmutPoll();
              addNotification("success", `DDMut prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
            } else if (pollData.status === "ERROR") {
              setDdmutStatus("unavailable");
              clearDdmutPoll();
              addNotification("error", `DDMut prediction failed for ${targetGene} ${targetVariant}.`);
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DDMut Polling Error]:", pollErr);
            setDdmutStatus("unavailable");
            clearDdmutPoll();
            addNotification("error", `DDMut polling encountered an error: ${pollErr.message || pollErr}.`);
          }
          
          if (attempts >= maxAttempts) {
            setDdmutStatus("unavailable");
            clearDdmutPoll();
            addNotification("error", `DDMut prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
          }
        };

        const intervalId = setInterval(poll, 10000);
        ddmutPollIntervalRef.current = intervalId;
      }
    } catch (err: any) {
      if (activeSignal.aborted) {
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

      const mutation = mapMutationToFoldXFormat(targetVariant);
      if (import.meta.env.DEV) {
        console.log(`[Biophysical Modeling] Mapping comparison mutation to FoldX format: ${mutation}`);
      }

      const response = await fetchWithAuth("/api/v1/generate-mutant", {
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
      setCompareFoldingEnergetics(validatedData.energetics || {
        foldx: validatedData.ddG,
        dynamut2: null,
        ddmut: null,
        rasp: null,
        ddgun: null
      });

      const posVal = posMatch ? parseInt(posMatch[0], 10) : 0;
      if (validatedData.pdb && wtPdb && posVal) {
        fetchStructuralDiff(wtPdb, validatedData.pdb, posVal, "A", true, activeSignal);
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
        let attempts = 0;
        const maxAttempts = 30; // 30 attempts at 10s interval = 5 minutes timeout
        const jobId = validatedData.dynamut2JobId;
        addNotification("info", `Comparison DynaMut2 calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        const poll = async () => {
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(compareFoldingEnergetics);
            const pollRes = await fetchWithAuth(`/api/v1/dynamut2-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DynaMut2 Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setCompareFoldingEnergetics(prev => {
                const base = prev || {
                  foldx: validatedData.ddG,
                  ddgun: validatedData.energetics?.ddgun ?? null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated = {
                  ...base,
                  dynamut2: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setCompareDynamut2Status("done");
              clearDynaMutComparePoll();
              addNotification("success", `Comparison DynaMut2 prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
            } else if (pollData.status === "ERROR") {
              setCompareDynamut2Status("unavailable");
              clearDynaMutComparePoll();
              addNotification("error", `Comparison DynaMut2 prediction failed for ${targetGene} ${targetVariant}.`);
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DynaMut2 Polling Error]:", pollErr);
            setCompareDynamut2Status("unavailable");
            clearDynaMutComparePoll();
            addNotification("error", `Comparison DynaMut2 polling encountered an error: ${pollErr.message || pollErr}.`);
          }
          
          if (attempts >= maxAttempts) {
            setCompareDynamut2Status("unavailable");
            clearDynaMutComparePoll();
            addNotification("error", `Comparison DynaMut2 prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
          }
        };

        const intervalId = setInterval(poll, 10000);
        dynamutComparePollIntervalRef.current = intervalId;
      }

      if (validatedData.ddmutJobId) {
        clearDdmutComparePoll();
        let attempts = 0;
        const maxAttempts = 30;
        const jobId = validatedData.ddmutJobId;
        addNotification("info", `Comparison DDMut calculation submitted for ${targetGene} ${targetVariant}. Polling in background...`);
        
        const poll = async () => {
          attempts++;
          try {
            const queryStr = buildEnergeticsQueryString(compareFoldingEnergetics);
            const pollRes = await fetchWithAuth(`/api/v1/ddmut-job/${jobId}?${queryStr}`, {
              method: "GET",
              signal: activeSignal
            });
            if (pollRes.status === 429) {
              console.warn(`[DDMut Polling] Rate limited (429) for job ${jobId}. Will retry on next tick.`);
              return;
            }
            if (!pollRes.ok) {
              throw new Error(`Poll request failed (status: ${pollRes.status})`);
            }
            const pollData = await pollRes.json();
            if (pollData.status === "DONE" && pollData.prediction !== null) {
              setCompareFoldingEnergetics(prev => {
                const base = prev || {
                  foldx: validatedData.ddG,
                  ddgun: validatedData.energetics?.ddgun ?? null,
                  dynamut2: null,
                  ddmut: null,
                  rasp: null
                };
                const updated = {
                  ...base,
                  ddmut: pollData.prediction
                };
                updated.consensusVerdict = pollData.consensusVerdict || computeConsensusVerdict(updated);
                return updated;
              });
              setCompareDdmutStatus("done");
              clearDdmutComparePoll();
              addNotification("success", `Comparison DDMut prediction completed for ${targetGene} ${targetVariant}! (ΔΔG: ${pollData.prediction} kcal/mol)`);
            } else if (pollData.status === "ERROR") {
              setCompareDdmutStatus("unavailable");
              clearDdmutComparePoll();
              addNotification("error", `Comparison DDMut prediction failed for ${targetGene} ${targetVariant}.`);
            }
          } catch (pollErr: any) {
            if (activeSignal?.aborted) return;
            console.error("[DDMut Polling Error]:", pollErr);
            setCompareDdmutStatus("unavailable");
            clearDdmutComparePoll();
            addNotification("error", `Comparison DDMut polling encountered an error: ${pollErr.message || pollErr}.`);
          }
          
          if (attempts >= maxAttempts) {
            setCompareDdmutStatus("unavailable");
            clearDdmutComparePoll();
            addNotification("error", `Comparison DDMut prediction timed out for ${targetGene} ${targetVariant} after 5 minutes.`);
          }
        };

        const intervalId = setInterval(poll, 10000);
        ddmutComparePollIntervalRef.current = intervalId;
      }
    } catch (err: any) {
      if (activeSignal.aborted) {
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
    const key = `${gene}_${variant}`;
    const controller = new AbortController();
    if (!mutantPdb && !isFolding && gene && variant && uniprotId && lastFetchedFoldRef.current !== key) {
      fetchMutantFold(gene, variant, uniprotId, controller.signal);
    }
    return () => {
      controller.abort();
    };
  }, [mutantPdb, gene, variant, uniprotId]);
  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    abortAllPendingRequests();

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const activeSignal = controller.signal;

    const targetGene = (customGene || "").trim().toUpperCase();
    const targetVariant = (customVariant || "").trim();
    const targetUniprot = (customUniprot || "").trim().toUpperCase();

    if (!targetGene || !targetVariant) return;

    if (isVcfOrCdnaNotation(targetVariant)) {
      try {
        const resolved = await translateVariantNotation(targetVariant, activeSignal);
        
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
      executeAnalysis(targetGene, targetVariant, targetUniprot, activeSignal);
      return;
    }

    setLoadingStep("Resolving gene name to UniProt and AlphaFold coordinates...");

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

      executeAnalysis(targetGene, targetVariant, resolvedUniprot, activeSignal);
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
      showCustomInputs,
      copied,
      customPdbUrl,
      viewMode,
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
      setShowCustomInputs,
      setCopied,
      setCustomPdbUrl,
      setViewMode,
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
      fetchCompareMutantFold,
      handleSearchSubmit,
      handleCopyReport,
      fetchNearestResidues,
      resetViewerState,
    }
  };
}

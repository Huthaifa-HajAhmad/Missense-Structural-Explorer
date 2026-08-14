
import { AMINO_ACID_3_TO_1, AMINO_ACID_1_TO_3 } from "./aminoAcids";
import { z } from "zod";

const finiteNumber = z.number().refine(Number.isFinite, { message: "Number must be finite" });
const nullableFiniteNumber = z.number().nullable().refine(val => val === null || Number.isFinite(val), { message: "Number must be finite" });

// Request deduplication cache for in-flight fetch promises (F-A2)
const inFlightRequests = new Map<string, Promise<any>>();

export function getDeduplicatedPromise<T>(key: string, promiseCreator: () => Promise<T>): Promise<T> {
  let existing = inFlightRequests.get(key);
  if (!existing) {
    existing = promiseCreator().finally(() => {
      inFlightRequests.delete(key);
    });
    inFlightRequests.set(key, existing);
  }
  return existing;
}

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
    uid: z.string().nullable(),
    hasOtherPathogenicVariantSameAA: z.boolean().optional()
  }).nullable().optional(),
  metadata: z.object({
    gene: z.string(),
    variant: z.string(),
    uniprotId: z.string(),
    residueIndex: nullableFiniteNumber,
    wildType: z.string(),
    mutant: z.string(),
    pdbId: z.string().nullable().optional(),
    pdbSource: z.string().nullable().optional(),
    sequence: z.string().nullable().optional()
  }),
  predictorData: z.object({
    available: z.boolean(),
    amPathogenicity: nullableFiniteNumber,
    amClass: z.string().nullable(),
    caddPhred: nullableFiniteNumber,
    eveScore: nullableFiniteNumber.optional(),
    eveClass: z.string().nullable().optional(),
    proteinName: z.string().nullable().optional(),
    transcriptId: z.string().optional(),
    isManeSelect: z.boolean().optional(),
    isManePlusClinical: z.boolean().optional(),
    isCanonical: z.boolean().optional(),
    maneRefSeqId: z.string().optional()
  }).nullable().optional(),
  conservationData: z.object({
    available: z.boolean(),
    revel: nullableFiniteNumber,
    gerp: nullableFiniteNumber,
    phylop: nullableFiniteNumber,
    consurf: nullableFiniteNumber,
    bayesdel: nullableFiniteNumber.optional(),
    metarnn: nullableFiniteNumber.optional(),
    clinpred: nullableFiniteNumber.optional(),
    eigenPhred: nullableFiniteNumber.optional(),
    dann: nullableFiniteNumber.optional(),
    esm1b: nullableFiniteNumber.optional(),
    popeve: nullableFiniteNumber.optional(),
    spliceProximity: z.object({
      distance: z.number(),
      isNearSpliceSite: z.boolean()
    }).nullable().optional(),
    spliceai: z.object({
      ds_ag: nullableFiniteNumber,
      ds_al: nullableFiniteNumber,
      ds_dg: nullableFiniteNumber,
      ds_dl: nullableFiniteNumber,
      max_ds: nullableFiniteNumber
    }).nullable().optional()
  }).nullable().optional(),
  landscapeData: z.array(z.object({
    residx: z.number(),
    revelMean: z.number().nullable().optional(),
    revelMedian: z.number().nullable().optional(),
    revelMin: z.number().nullable().optional(),
    revelMax: z.number().nullable().optional(),
    revelCount: z.number().optional(),
    amMean: z.number().nullable().optional(),
    amMedian: z.number().nullable().optional(),
    amMin: z.number().nullable().optional(),
    amMax: z.number().nullable().optional(),
    amCount: z.number().optional(),
    gerp: z.number().nullable(),
    phylop: z.number().nullable()
  })).nullable().optional(),
  stringInteractions: z.array(z.object({
    partner: z.string(),
    score: finiteNumber
  })).nullable().optional(),
  disruptionPredictor: z.object({
    level: z.enum(["high", "low", "unknown"]),
    reason: z.string(),
    plddt: z.number().nullable(),
    burialStatus: z.enum(["core", "surface", "boundary"]).optional(),
    neighborCount: z.number().optional(),
    rsa: z.number().nullable().optional(),
    sasa: z.number().nullable().optional()
  }).optional(),
  uniprotFeatures: z.object({
    features: z.array(z.object({
      type: z.string(),
      description: z.string(),
      start: z.number(),
      end: z.number()
    })),
    geneName: z.string().optional(),
    subunitComment: z.string().nullable().optional(),
    isMultimer: z.boolean().optional()
  }).nullable().optional(),
  gnomadConstraint: z.object({
    missense_z: z.number().nullable(),
    oe_mis: z.number().nullable(),
    pli: z.number().nullable(),
    loeuf: z.number().nullable().optional(),
    isPP2Constrained: z.boolean(),
    hasRegionalData: z.boolean().optional(),
    regionalConstraint: z.object({
      isConstrained: z.boolean(),
      oeRatio: z.number().nullable(),
      pValue: z.number().nullable(),
      regionText: z.string().nullable()
    }).nullable().optional()
  }).nullable().optional(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
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
  aouFrequency: z.object({
    aouAC: z.number().nullable().optional(),
    aouAN: z.number().nullable().optional(),
    aouHet: z.number().nullable().optional(),
    aouHom: z.number().nullable().optional()
  }).nullable().optional(),
  esm2: z.object({
    llr: z.number().nullable(),
    verdict: z.string().nullable().optional()
  }).nullable().optional(),
  esm3Eval: z.union([
    z.object({
      uniprotId: z.string(),
      position: z.number(),
      wtResidue: z.string(),
      mutResidue: z.string(),
      pdbText: z.string().nullable(),
      perturbationScores: z.array(z.number()),
      maxDriftResidue: z.number(),
      structuralChangeLevel: z.enum(["none", "minor", "moderate", "major"]),
      microenvironments: z.array(z.string()),
      putativeStructuralChanges: z.array(z.string()),
      confidence: z.object({
        level: z.enum(["high", "moderate", "low"]),
        plddt: z.number().nullable().optional(),
        sequenceCoverage: z.number().nullable().optional()
      })
    }),
    z.object({
      error: z.string()
    })
  ]).nullable().optional(),
  esmcEval: z.object({
    wtProbability: z.number(),
    mutProbability: z.number(),
    llr: z.number(),
    preferences: z.array(z.object({
      aa: z.string(),
      prob: z.number()
    })),
    mutRank: z.number(),
    positionalEntropy: z.number(),
    embeddingShift: z.number(),
    localEmbeddingShift: z.number(),
    localShiftMap: z.array(z.object({
      position: z.number(),
      residue: z.string(),
      shift: z.number()
    }))
  }).nullable().optional(),
  esm2Eval: z.object({
    wtProbability: z.number(),
    mutProbability: z.number(),
    llr: z.number(),
    preferences: z.array(z.object({
      aa: z.string(),
      prob: z.number()
    })),
    mutRank: z.number(),
    positionalEntropy: z.number(),
    embeddingShift: z.number(),
    localEmbeddingShift: z.number(),
    localShiftMap: z.array(z.object({
      position: z.number(),
      residue: z.string(),
      shift: z.number()
    })),
    klDivergence: z.number().nullable().optional()
  }).nullable().optional(),
  saprotEval: z.object({
    wtProbability: z.number(),
    mutProbability: z.number(),
    llr: z.number(),
    preferences: z.array(z.object({
      aa: z.string(),
      prob: z.number()
    })),
    mutRank: z.number(),
    positionalEntropy: z.number(),
    embeddingShift: z.number(),
    localEmbeddingShift: z.number(),
    localShiftMap: z.array(z.object({
      position: z.number(),
      residue: z.string(),
      shift: z.number()
    })),
    klDivergence: z.number().nullable().optional(),
    conformationState: z.string().nullable().optional()
  }).nullable().optional()
});

export const generateMutantResponseSchema = z.object({
  pdb: z.string().nullable().optional(),
  ddG: nullableFiniteNumber,
  status: z.string(),
  error: z.string().nullable().optional(),
  foldedResidueIndex: nullableFiniteNumber.optional(),
  foldxJobId: z.string().nullable().optional(),
  energetics: z.object({
    foldx: nullableFiniteNumber,
    foldxMean: nullableFiniteNumber.optional(),
    foldxSd: nullableFiniteNumber.optional(),
    vdw: nullableFiniteNumber.optional(),
    electrostatics: nullableFiniteNumber.optional(),
    stericClashWarning: z.boolean().optional(),
    localSidechainRmsd: nullableFiniteNumber.optional(),
    foldxRepairFailed: z.boolean().optional(),
    dynamut2: nullableFiniteNumber.optional(),
    ddmut: nullableFiniteNumber.optional(),
    rasp: nullableFiniteNumber.optional(),
    thermompnn: nullableFiniteNumber.optional(),
    consensusVerdict: z.string().nullable().optional(),
    raspReason: z.string().optional(),
    evidenceComplete: z.boolean().optional(),
    pendingTools: z.array(z.string()).optional(),
    rawDdGs: z.array(z.number()).nullable().optional(),
    stabilityoracle: nullableFiniteNumber.optional(),
    consensusProbability: nullableFiniteNumber.optional(),
    consensusConfMin: nullableFiniteNumber.optional(),
    consensusConfMax: nullableFiniteNumber.optional(),
    seed: nullableFiniteNumber.optional(),
    bFactorMetadata: z.object({
      source: z.string(),
      semantic: z.string(),
      inherited: z.boolean()
    }).nullable().optional()
  }).passthrough().optional(),
  dynamut2JobId: z.string().nullable().optional(),
  dynamut2Status: z.string().nullable().optional(),
  ddmutJobId: z.string().nullable().optional(),
  ddmutStatus: z.string().nullable().optional(),
  thermompnnJobId: z.string().nullable().optional(),
  thermompnnStatus: z.string().nullable().optional(),
  thermompnnError: z.string().nullable().optional(),
  provenance: z.object({
    structureSource: z.enum(["experimental", "alphafold", "homolog", "client-provided"]).optional(),
    structurePdbId: z.string().nullable().optional(),
    structureChainId: z.string().nullable().optional(),
    structureResolution: z.number().nullable().optional(),
    structureMethod: z.string().nullable().optional(),
    structureIdentity: z.number().nullable().optional(),
    foldxVersion: z.string().optional(),
    foldxRuns: z.number().optional(),
    seed: z.number().nullable().optional(),
    raspDatasetSnapshot: z.string().optional(),
    vesmModel: z.string().optional(),
    timestamp: z.string().optional()
  }).passthrough().optional()
}).passthrough();

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
  uniprotId: z.string(),
  transcriptId: z.string().optional(),
  isManeSelect: z.boolean().optional(),
  isManePlusClinical: z.boolean().optional(),
  isCanonical: z.boolean().optional(),
  maneRefSeqId: z.string().optional(),
  transcriptWarning: z.string().optional(),
  genomicCoordinates: z.string().nullable().optional()
});
import { EnergeticsData } from "./types";

export function buildEnergeticsQueryString(energetics: EnergeticsData | null): string {
  if (!energetics) return "";
  const q = new URLSearchParams();
  const foldxVal = energetics.foldxMean ?? energetics.foldx;
  if (foldxVal !== null && foldxVal !== undefined) q.set("foldx", foldxVal.toString());
  if (energetics.rasp !== null && energetics.rasp !== undefined) q.set("rasp", energetics.rasp.toString());
  if (energetics.ddmut !== null && energetics.ddmut !== undefined) q.set("ddmut", energetics.ddmut.toString());
  if (energetics.dynamut2 !== null && energetics.dynamut2 !== undefined) q.set("dynamut2", energetics.dynamut2.toString());
  if (energetics.thermompnn !== null && energetics.thermompnn !== undefined) q.set("thermompnn", energetics.thermompnn.toString());
  if (energetics.foldxRepairFailed) q.set("foldxRepairFailed", "true");
  return q.toString();
}


export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number } = {},
  maxRetries = 3,
  initialDelay = 1000,
  backoffFactor = 2
): Promise<Response> {
  if (!navigator.onLine) {
    throw new Error("You appear to be offline. Please verify your internet connection and try again.");
  }
  let attempt = 0;
  
  while (true) {
    const controller = new AbortController();
    const timeoutVal = options.timeout ?? 300000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutVal);
    
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
      
      const shouldRetryStatus = [502, 503, 504, 429].includes(response.status);
      if (shouldRetryStatus && attempt < maxRetries) {
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
export function getErrorMessage(data: any, defaultMsg = "Request failed"): string {
  if (!data) return defaultMsg;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error.message === "string") return data.error.message;
  if (typeof data === "string") return data;
  return defaultMsg;
}

// Local storage key for non-sensitive public variant history cache (non-PHI)
export const STORAGE_KEY = "variantHistory";

// Coordinate pattern checkers for VCF and cDNA (F-3)
export function isVcfOrCdnaNotation(input: string): boolean {
  const trimmed = input.trim();
  const genomicRegex = /^(?:chr)?[0-9XYMT]+:g\.\d+[A-Z]>[A-Z]$/i;
  const cdnaRegex = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;
  const dashedGenomicRegex = /^(?:chr)?[0-9XYMT]+-\d+-[ACGTN]+-[ACGTN]+$/i;
  return genomicRegex.test(trimmed) || cdnaRegex.test(trimmed) || dashedGenomicRegex.test(trimmed);
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
  const normalize3 = (str: string) => {
    if (str.length !== 3) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  };

  // ── Step 1: Strip common non-standard prefixes ──
  let clean = variantStr.replace(/^p\./i, "").replace(/[()]/g, "").trim();

  // Strip transcript/Uniprot/protein accession prefix (e.g., "ENST00000:Ser489Cys" or "ENSP00000:p.S489C")
  clean = clean.replace(/^[A-Z0-9_]{4,20}:\s*/i, "");

  // Strip leading gene-name prefix (e.g., "CNNM2 Ser489Cys" when gene was pasted into variant field)
  clean = clean.replace(/^[A-Z]{2,10}\s+/i, "");

  // Remove underscores within the variant (Ser_489_Cys → Ser489Cys)
  clean = clean.replace(/_/g, "");

  // Remove ">" arrow notation (R>H → RH) for HGVS-style input
  clean = clean.replace(/>(?=[A-Z])/i, "");

  // ── Step 2: Try 3-letter amino acid regex ──
  const match3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
  if (match3) {
    const wt3 = normalize3(match3[1]);
    const mut3 = normalize3(match3[3]);
    const wt = aminoAcidMap[wt3];
    const mut = aminoAcidMap[mut3];
    if (!wt || !mut) {
      throw new Error(
        `Invalid HGVS missense format: Unrecognized 3-letter amino acid code '${!wt ? wt3 : mut3}'. ` +
        `Expected one of: Ala/Arg/Asn/Asp/Cys/Gln/Glu/Gly/His/Ile/Leu/Lys/Met/Phe/Pro/Ser/Thr/Trp/Tyr/Val.`
      );
    }
    return { wt, mut };
  }

  // ── Step 3: Try 1-letter amino acid regex ──
  const match1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (match1) {
    const wt = match1[1].toUpperCase();
    const mut = match1[3].toUpperCase();
    const validCodes = Object.values(aminoAcidMap);
    if (!validCodes.includes(wt) || !validCodes.includes(mut)) {
      throw new Error(
        `Invalid HGVS missense format: Unrecognized 1-letter amino acid code '${!validCodes.includes(wt) ? wt : mut}'. ` +
        `Expected single-letter codes (A/C/D/E/F/G/H/I/K/L/M/N/P/Q/R/S/T/V/W/Y).`
      );
    }
    return { wt, mut };
  }

  // ── Step 4: Provide contextual error guidance ──
  throw new Error(
    `Invalid HGVS missense format: "${variantStr}" doesn't match expected format. ` +
    `Expected: <WildType><Position><Mutant> with no extra prefixes. ` +
    `Examples: p.Arg215Trp (3-letter), p.R215W (1-letter). ` +
    `For genomic variants use the "c." notation (e.g., c.744C>T) or the "g." notation.`
  );
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

export function mapMutationToFoldXFormat(variantStr: string): string {
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
}



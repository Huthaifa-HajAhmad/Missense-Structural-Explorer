import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  VCF_GENOMIC_PATTERN,
  CDNA_PATTERN,
  MUTATION_FOLDX_PATTERN,
  filterPII,
  encryptSession,
  decryptSession,
  getApiKeyFromSession
} from "./utils.ts";

import {
  apiLimiter,
  authCheck,
  analyzeVariantLimiter
} from "./middleware.ts";

import {
  performGeminiAnalysis,
  performGeminiBiophysicalAnalysis,
  GeminiError
} from "./services/gemini.ts";

import {
  fetchClinVarData,
  resolveGeneToUniprot,
  fetchUniprotSequence,
  fetchAlphafoldPdb,
  pdbCache,
  fetchBestPdbStructure,
  fetchPdbFromRcsb,
  fetchPredictorData,
  fetchConservationData,
  fetchStringInteractions,
  submitDynaMut2Job,
  pollDynaMut2Job,
  submitDdmutJob,
  pollDdmutJob,
  fetchGnomadGeneConstraint,
  fetchGnomadVariantFrequency,
  fetchUniprotFeatures,
  fetchLandscapeData,
} from "./services/external.ts";
import { AMINO_ACID_1_TO_3, AMINO_ACID_1_TO_3_TITLE } from "../src/aminoAcids.ts";

export interface BackgroundTask {
  id: string;
  controller: AbortController;
  promise: Promise<any>;
}
export const activeBackgroundTasks: BackgroundTask[] = [];

import {
  biophysicalSemaphore,
  generateMutantPdb,
  findBindingPocket,
  parseResiduesFromPdbMaybeAsync,
  getResidueDetails,
  predictStructuralDisruption,
  computeStructuralDiff,
  runEsm2Eval,
  extractSequenceFromPdb,
  runDdgunSeq,
  runRaspLocal
} from "./services/biophysics.ts";
import { computeRuleBasedACMG, type RuleBasedInsights, type ACMGItem } from "./services/acmg.ts";
import { THRESHOLDS, computeConsensusVerdict } from "../src/shared/thresholds.ts";
import { AMINO_ACID_3_TO_1 } from "../src/aminoAcids.ts";

// ---------------------------------------------------------------------------
// SEC-1: Fail-loud production session-secret validation
// ---------------------------------------------------------------------------
(function enforceSessionSecret() {
  if (process.env.NODE_ENV !== "production") return;
  const secret = process.env.APP_SESSION_SECRET;
  const defaultValues = ["dev-secret-change-me", "change_me", "secret", ""];
  if (!secret || defaultValues.some(d => secret.toLowerCase().includes(d)) || secret.length < 32) {
    console.error(
      "[SECURITY] FATAL: APP_SESSION_SECRET is not set or retains a default/weak value in production. " +
      "Generate a 32+ byte secret (e.g.: node -e \"require('crypto').randomBytes(32).toString('hex')\" ) " +
      "and set it as APP_SESSION_SECRET in your .env. Refusing to start."
    );
    process.exit(1);
  }
})();

export const apiRouter = express.Router();

const jsonParserRegular = express.json({ limit: "1mb" });
const jsonParserPdb = express.json({ limit: "5mb" });

apiRouter.get("/health", (req, res) => {
  // foldxReady: check binary exists (no exec)
  const foldxBinEnv = process.env.FOLDX_BINARY || "";
  let foldxReady = false;
  if (foldxBinEnv) {
    foldxReady = fs.existsSync(foldxBinEnv);
  } else {
    try {
      const toolsDir = path.join(process.cwd(), "tools", "foldx");
      if (fs.existsSync(toolsDir)) {
        const files = fs.readdirSync(toolsDir);
        foldxReady = files.some(f => /^foldx.*\.exe$/i.test(f));
      }
    } catch { foldxReady = false; }
  }
  // geminiReady: key is set and not a placeholder
  const geminiKey = process.env.GEMINI_API_KEY || "";
  const placeholders = ["YOUR_GEMINI_API_KEY", "CHANGE_ME", "MY_GEMINI_API_KEY", ""];
  const geminiReady = !!(geminiKey && !placeholders.some(p => geminiKey.includes(p)) && geminiKey.trim().length >= 10);

  res.json({ status: "ok", timestamp: new Date().toISOString(), foldxReady, geminiReady });
});

apiRouter.get("/version", (req, res) => {
  res.json({ version: "1.0.0", env: process.env.NODE_ENV || "development" });
});



// Apply authCheck and apiLimiter globally to the API Router
apiRouter.use(authCheck);
apiRouter.use(apiLimiter);

apiRouter.get("/dynamut2-job/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

  if (!jobId || !/^\d{1,20}$/.test(jobId)) {
    sendError(res, 400, "BAD_REQUEST", "Invalid DynaMut2 Job ID format: must be numeric digits.");
    return;
  }

  // Parse other scores from query parameters to dynamically compute consensusVerdict
  const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
  const ddgun = req.query?.ddgun ? parseFloat(req.query.ddgun as string) : null;
  const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
  const ddmut = req.query?.ddmut ? parseFloat(req.query.ddmut as string) : null;

  try {
    const result = await pollDynaMut2Job(jobId);
    if (!result) {
      await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "ERROR" });
      res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
      return;
    }

    await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: result.status });

    const consensusVerdict = result.status === "DONE" && result.prediction !== null
      ? computeConsensusVerdict({ foldxMean: foldx, dynamut2: result.prediction, ddmut, rasp, ddgun })
      : null;

    res.json({
      jobId,
      status: result.status,
      prediction: result.prediction,
      consensusVerdict
    });
  } catch (err: any) {
    console.error(`[Route Error] DynaMut2 job polling failed for ${jobId}:`, err.message);
    await AuditLogger.log("DYNAMUT2_POLL", { reqId, jobId, status: "ERROR" });
    if (err.statusCode === 429) {
      res.status(429).json({ error: "Upstream DynaMut2 API rate limit reached." });
      return;
    }
    res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
  }
});

apiRouter.get("/ddmut-job/:jobId", async (req, res) => {
  const { jobId } = req.params;
  const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;

  if (!jobId || !/^\d{1,20}$/.test(jobId)) {
    sendError(res, 400, "BAD_REQUEST", "Invalid DDMut Job ID format: must be numeric digits.");
    return;
  }

  // Parse other scores from query parameters to dynamically compute consensusVerdict
  const foldx = req.query?.foldx ? parseFloat(req.query.foldx as string) : null;
  const ddgun = req.query?.ddgun ? parseFloat(req.query.ddgun as string) : null;
  const rasp = req.query?.rasp ? parseFloat(req.query.rasp as string) : null;
  const dynamut2 = req.query?.dynamut2 ? parseFloat(req.query.dynamut2 as string) : null;

  try {
    const result = await pollDdmutJob(jobId);
    if (!result) {
      await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "ERROR" });
      res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
      return;
    }

    await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: result.status });

    const consensusVerdict = result.status === "DONE" && result.prediction !== null
      ? computeConsensusVerdict({ foldxMean: foldx, dynamut2, ddmut: result.prediction, rasp, ddgun })
      : null;

    res.json({
      jobId,
      status: result.status,
      prediction: result.prediction,
      consensusVerdict
    });
  } catch (err: any) {
    console.error(`[Route Error] DDMut job polling failed for ${jobId}:`, err.message);
    await AuditLogger.log("DDMUT_POLL", { reqId, jobId, status: "ERROR" });
    if (err.statusCode === 429) {
      res.status(429).json({ error: "Upstream DDMut API rate limit reached." });
      return;
    }
    res.json({ jobId, status: "ERROR", prediction: null, consensusVerdict: null });
  }
});

const geminiCache = new Map<string, any>();
const CACHE_DIR = path.join(process.cwd(), "logs", "gemini_cache");
const GEMINI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCacheFilename(cacheKey: string): string {
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

function getFromCache(cacheKey: string): any | null {
  const now = Date.now();
  if (geminiCache.has(cacheKey)) {
    const entry = geminiCache.get(cacheKey);
    if (entry && typeof entry === "object" && "timestamp" in entry) {
      if (now - entry.timestamp < GEMINI_CACHE_TTL_MS) {
        return entry.data;
      }
      geminiCache.delete(cacheKey);
    }
  }
  try {
    const filename = getCacheFilename(cacheKey);
    if (fs.existsSync(filename)) {
      const raw = fs.readFileSync(filename, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "timestamp" in parsed) {
        if (now - parsed.timestamp < GEMINI_CACHE_TTL_MS) {
          geminiCache.set(cacheKey, parsed);
          return parsed.data;
        }
      }
      // Stale or legacy cache format: unlink it
      try {
        fs.unlinkSync(filename);
      } catch (err) {
        // ignore unlink error
      }
    }
  } catch (err) {
    console.error("Error reading disk cache:", err);
  }
  return null;
}

function writeToCache(cacheKey: string, data: any) {
  try {
    const entry = { data, timestamp: Date.now() };
    geminiCache.set(cacheKey, entry);
    if (geminiCache.size > 200) {
      const firstKey = geminiCache.keys().next().value;
      if (firstKey) {
        geminiCache.delete(firstKey);
      }
    }
    const filename = getCacheFilename(cacheKey);
    const cacheDir = path.dirname(filename);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(filename, JSON.stringify(entry), "utf-8");

    // Bounded disk cache eviction (older than 7 days) - async execution in background so it never blocks the event loop
    fs.promises.readdir(cacheDir)
      .then(files => {
        const now = Date.now();
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
        return Promise.all(files.map(async file => {
          const filePath = path.join(cacheDir, file);
          try {
            const stats = await fs.promises.stat(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
              await fs.promises.unlink(filePath);
            }
          } catch (_) {}
        }));
      })
      .catch(err => {
        console.error("[Cache Eviction Error]", err.message);
      });
  } catch (err) {
    console.error("Error writing disk cache:", err);
  }
}

function generateAltVariants(sequence: string): string[] {
  // We want to generate 4 valid, non-overlapping mutations
  // Pick positions at 15%, 35%, 55%, 75% of length
  const fractions = [0.15, 0.35, 0.55, 0.75];
  const alts: string[] = [];
  
  for (const frac of fractions) {
    const pos = Math.max(1, Math.min(sequence.length, Math.round(sequence.length * frac)));
    const wtLetter = sequence[pos - 1]; // 1-letter wildtype
    const wt3 = AMINO_ACID_1_TO_3_TITLE[wtLetter]; // 3-letter wt (TitleCase)
    
    if (wt3) {
      // Pick a mutant residue that is different from wtLetter (distributed to avoid alanine bias)
      const possibleMutants = ["V", "L", "I", "S", "T", "P", "G", "R", "K", "D", "E", "N", "Q", "F", "Y", "W", "H", "C", "M", "A"];
      const filteredMutants = possibleMutants.filter(m => m !== wtLetter);
      const selIndex = Math.floor(pos) % filteredMutants.length;
      const mutLetter = filteredMutants[selIndex] || "A";
      const mut3 = AMINO_ACID_1_TO_3_TITLE[mutLetter] || "Ala"; // 3-letter mut (TitleCase)
      
      // format: p.Val8Met -> e.g. p.Ala40Val
      alts.push(`p.${wt3}${pos}${mut3}`);
    }
  }
  
  return alts;
}

apiRouter.post("/analyze-variant", analyzeVariantLimiter, jsonParserRegular, async (req, res) => {
  try {
    let gene: string, variant: string, uniprotId: string;
    let userDirections: string | undefined;
    let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

    let originalNotation: string | undefined;

    try {
      gene = validateGene(req.body.gene);
      variant = validateVariant(req.body.variant);
      uniprotId = validateUniProt(req.body.uniprotId);
      originalNotation = req.body.originalNotation ? String(req.body.originalNotation) : undefined;
      
      if (req.body.userDirections !== undefined) {
        if (typeof req.body.userDirections !== "string") {
          throw new Error("userDirections must be a string");
        }
        userDirections = filterPII(req.body.userDirections.slice(0, 2000));
      }

      if (req.body.acmgWeighting !== undefined) {
        if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
          acmgWeighting = req.body.acmgWeighting;
        } else {
          throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
        }
      }
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    await AuditLogger.log("ANALYZE_VARIANT", {
      gene,
      variant,
      uniprotId,
      hasDirections: !!userDirections,
      acmgWeighting
    });

    // Parse wild-type and mutant residues if possible (e.g. p.Arg215Trp or Arg215Trp)
    const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
    let residueIndex = "";
    let wildType = "";
    let mutant = "";
    if (mutMatch) {
      wildType = mutMatch[1];
      residueIndex = mutMatch[2];
      mutant = mutMatch[3];

      // Normalize 3-letter codes to TitleCase (e.g. ser -> Ser) for case-insensitive match (BIO-15)
      if (wildType.length === 3) {
        wildType = wildType.charAt(0).toUpperCase() + wildType.slice(1).toLowerCase();
      }
      if (mutant.length === 3) {
        mutant = mutant.charAt(0).toUpperCase() + mutant.slice(1).toLowerCase();
      }
    }

    // 1. Fetch UniProt sequence and validate residue presence & identity (M-1)
    let sequence: string;
    try {
      sequence = await fetchUniprotSequence(uniprotId);
    } catch (seqErr: any) {
      sendError(res, 424, "SEQUENCE_UNAVAILABLE", `Failed to retrieve protein sequence from UniProt: ${seqErr.message}`);
      return;
    }

    const pos = parseInt(residueIndex, 10);
    if (isNaN(pos) || pos < 1 || pos > sequence.length) {
      sendError(
        res,
        422,
        "UNPROCESSABLE_ENTITY",
        `Mutation residue index ${residueIndex} is out of bounds for protein ${uniprotId} (sequence length: ${sequence.length}).`
      );
      return;
    }

    const wtUpper = wildType.toUpperCase();
    const wt1Letter = AMINO_ACID_3_TO_1[wildType] || (wildType.length === 1 ? wtUpper : null);
    if (!wt1Letter) {
      sendError(res, 400, "BAD_REQUEST", `Invalid wild-type residue notation: ${wildType}`);
      return;
    }

    const mutUpper = mutant.toUpperCase();
    const mut1Letter = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutUpper : null);
    if (!mut1Letter) {
      sendError(res, 400, "BAD_REQUEST", `Invalid mutant residue notation: ${mutant}`);
      return;
    }

    const actualWt = sequence[pos - 1];
    if (actualWt !== wt1Letter) {
      sendError(
        res,
        422,
        "UNPROCESSABLE_ENTITY",
        `Wild-type residue mismatch at position ${pos} for ${uniprotId}. Expected ${actualWt}, but query specified ${wt1Letter} (${wildType}).`
      );
      return;
    }

    let clinvar = null;
    let predictorData = null;
    let conservationData = null;
    let stringInteractions = null;
    let gnomadFrequency = null;
    let disruptionPredictor = { level: "low", reason: "Fallback: PDB structure mapping not resolved", plddt: 100 };
    let esm2 = null;
    let landscapeData = null;

    let resolvedPdbId: string | null = null;
    let resolvedPdbSource: string = "AlphaFold";
    let pdbMapping: { pdbId: string; chainId: string; shift: number } | null = null;

    try {
      // Fetch PredictorData first to resolve chromosomal positions (gnomadVariantId)
      predictorData = await fetchPredictorData(gene, variant);

      try {
        pdbMapping = await fetchBestPdbStructure(uniprotId, pos);
        if (pdbMapping && pdbMapping.pdbId) {
          resolvedPdbId = pdbMapping.pdbId.toUpperCase();
          resolvedPdbSource = "RCSB PDB";
        }
      } catch (err) {
        console.warn("[PDB Selection Error] Failed to query best PDB structure:", err);
      }

      const startPos = Math.max(1, pos - 15);
      const endPos = Math.min(sequence.length, pos + 15);

      const results = await Promise.all([
        fetchClinVarData(gene, variant, originalNotation),
        fetchConservationData(gene, variant, pdbMapping?.pdbId, pdbMapping?.chainId, pos),
        fetchStringInteractions(gene),
        fetchGnomadVariantFrequency(predictorData?.gnomadVariantId || null),
        (async () => {
          try {
            let wtPdbText: string | null = null;
            let chainId: string | undefined;
            if (pdbMapping && pdbMapping.pdbId) {
              wtPdbText = await fetchPdbFromRcsb(pdbMapping.pdbId, pdbMapping.chainId, pdbMapping.shift);
              chainId = pdbMapping.chainId;
            } else {
              wtPdbText = await fetchAlphafoldPdb(uniprotId);
              chainId = "A"; // AlphaFold model files are always chain A
            }

            if (wtPdbText) {
              return predictStructuralDisruption(wtPdbText, wt1Letter, pos, mut1Letter, chainId);
            }
          } catch (err) {
            console.warn("[Triage Parallel Run Warning] Failed to predict structural disruption:", err);
          }
          return { level: "low", reason: "Fallback: PDB structure mapping not resolved", plddt: 100 };
        })(),
        runEsm2Eval(sequence, pos, wt1Letter, mut1Letter).catch(err => {
          console.warn("[ESM2 Parallel Run Warning] Failed to run ESM2 evaluation:", err);
          return null;
        }),
        fetchLandscapeData(gene, startPos, endPos).catch(err => {
          console.warn("[Landscape Parallel Run Warning] Failed to fetch landscape data:", err);
          return null;
        })
      ]);
      clinvar = results[0];
      conservationData = results[1];
      stringInteractions = results[2];
      gnomadFrequency = results[3];
      disruptionPredictor = results[4] as any;
      esm2 = results[5];
      landscapeData = results[6];
    } catch (err: any) {
      console.error("[Parallel Fetch Error]:", err);
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        sendError(res, 504, "TIMEOUT", "Variant database upstream query timed out. Please try again.");
        return;
      }
      sendError(res, 502, "BAD_GATEWAY", `Variant database upstream query error: ${err.message}`);
      return;
    }

    // ACMG-6 / UniProt: Fetch live gnomAD gene constraint and UniProt curated features.
    // These are non-critical — failures are silently absorbed so the main response is not blocked.
    const [gnomadConstraint, uniprotFeatures] = await Promise.allSettled([
      fetchGnomadGeneConstraint(gene),
      fetchUniprotFeatures(uniprotId),
    ]).then(results => [
      results[0].status === "fulfilled" ? results[0].value : null,
      results[1].status === "fulfilled" ? results[1].value : null,
    ]);

    // ACMG-6: Inject live gnomAD constraint into PP2 logic.
    // If the gene is constrained per gnomAD mis_z / oe_mis, PP2 evidence is injected.
    const gnomadConstraintData = gnomadConstraint as any;

    const ruleBasedInsights = computeRuleBasedACMG(
      gene, variant, clinvar, predictorData, conservationData, gnomadConstraintData, gnomadFrequency, acmgWeighting, esm2, uniprotFeatures, sequence
    );

    const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
    let customApiKey: string | undefined;
    if (customSessionId) {
      customApiKey = getApiKeyFromSession(customSessionId);
      if (!customApiKey) {
        sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
        return;
      }
    }

    // Asynchronously pre-compute FoldX modeling in the background to warm the cache (bypass during tests)
    if (process.env.NODE_ENV !== "test") {
      const prewarmTaskId = crypto.randomUUID();
      const prewarmController = new AbortController();
      
      const prewarmPromise = (async () => {
        let createdJobDir = "";
        try {
          if (pdbMapping && pdbMapping.pdbId) {
            const wtPdbText = await fetchPdbFromRcsb(pdbMapping.pdbId, pdbMapping.chainId, pdbMapping.shift);
            if (wtPdbText) {
              const wt1 = wt1Letter.toUpperCase();
              const chain = pdbMapping.chainId.toUpperCase();
              const mut1 = AMINO_ACID_3_TO_1[mutant] || (mutant.length === 1 ? mutant.toUpperCase() : mutant[0].toUpperCase());
              
              const mutation = `${wt1}${chain}${pos}${mut1}`;
              const prewarmJobId = crypto.randomUUID();
              const prewarmJobDir = path.join(process.cwd(), "temp_jobs", prewarmJobId);
              createdJobDir = prewarmJobDir;
              
              console.log(`[Pre-warm Cache] Silently launching FoldX mutant simulation in background for ${gene} ${variant}`);
              await generateMutantPdb(wtPdbText, mutation, uniprotId, prewarmJobDir, prewarmController.signal);
              console.log(`[Pre-warm Cache] FoldX simulation completed and cached for ${gene} ${variant}`);
            }
          }
        } catch (prewarmErr: any) {
          if (prewarmController.signal.aborted) {
            console.log(`[Pre-warm Cache] Background FoldX pre-warm aborted for ${gene} ${variant}`);
          } else {
            console.warn(`[Pre-warm Cache Warning] Background FoldX pre-warm failed:`, prewarmErr.message);
          }
          if (createdJobDir) {
            try {
              if (fs.existsSync(createdJobDir)) {
                await fs.promises.rm(createdJobDir, { recursive: true, force: true });
              }
            } catch (_) {}
          }
        } finally {
          const idx = activeBackgroundTasks.findIndex(t => t.id === prewarmTaskId);
          if (idx !== -1) {
            activeBackgroundTasks.splice(idx, 1);
          }
        }
      })();
      activeBackgroundTasks.push({ id: prewarmTaskId, controller: prewarmController, promise: prewarmPromise });
    }

    res.json({
      analysis: null,
      insights: null,
      ruleBasedInsights,
      disclaimer: "This analysis is automatically generated by an artificial intelligence model for research purposes only. It does not constitute a clinical diagnosis or validated medical recommendation.",
      clinvar,
      predictorData,
      conservationData,
      landscapeData,
      stringInteractions,
      disruptionPredictor,
      gnomadConstraint: gnomadConstraint ?? null,
      uniprotFeatures: uniprotFeatures ?? null,
      gnomadFrequency: gnomadFrequency ?? null,
      esm2: esm2 ?? null,
      metadata: {
        gene,
        variant,
        uniprotId,
        residueIndex: residueIndex ? parseInt(residueIndex, 10) : null,
        wildType,
        mutant,
        pdbId: resolvedPdbId,
        pdbSource: resolvedPdbSource,
        alternativeVariants: generateAltVariants(sequence)
      }
    });
  } catch (error: any) {
    console.error("Endpoint analysis failure:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "An error occurred during variant analysis.");
  }
});
apiRouter.post("/analyze-variant-biophysical", jsonParserRegular, async (req, res) => {
  try {
    let gene: string, variant: string, uniprotId: string;
    try {
      gene = validateGene(req.body.gene);
      variant = validateVariant(req.body.variant);
      uniprotId = validateUniProt(req.body.uniprotId);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    const cacheKey = `biophysical_${uniprotId}_${variant}`;
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[Cache Hit] Serving cached biophysical Gemini insights for ${cacheKey}`);
      res.json(cached);
      return;
    }

    // Cache miss: invoke rate limiter programmatically (bypass during tests)
    const runHandler = async () => {
      try {
        const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
        if (!mutMatch) {
          sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
          return;
        }
        const wildType = mutMatch[1];
        const residueIndex = mutMatch[2];
        const mutant = mutMatch[3];

        const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
        let customApiKey: string | undefined;
        if (customSessionId) {
          customApiKey = getApiKeyFromSession(customSessionId);
          if (!customApiKey) {
            sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
            return;
          }
        }

        const timeoutSignal = AbortSignal.timeout(60000);
        let result;
        try {
          result = await performGeminiBiophysicalAnalysis(
            gene,
            variant,
            uniprotId,
            residueIndex,
            wildType,
            mutant,
            customApiKey,
            timeoutSignal
          );
          writeToCache(cacheKey, result);
        } catch (err: any) {
          console.warn("[Graceful Fallback] Biophysical Gemini narrative execution failed:", err.message);
          result = {
            biochemicalShift: "Biochemical shift details unavailable (Gemini service limit or timeout).",
            structuralImpact: `structural impact details unavailable. (${err.message || "Failed to connect to Gemini API"}).`
          };
        }
        res.json(result);
      } catch (innerError: any) {
        console.error("Biophysical inner execution failure:", innerError);
        sendError(res, 500, "INTERNAL_ERROR", innerError.message || "Failed to process biophysical request.");
      }
    };

    if (process.env.NODE_ENV === "test") {
      await runHandler();
    } else {
      analyzeVariantLimiter(req, res, runHandler);
    }
  } catch (error: any) {
    console.error("Biophysical endpoint failure:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "Failed to process biophysical request.");
  }
});

apiRouter.post("/structural-diff", jsonParserPdb, async (req, res) => {
  try {
    const { wtPdb, mutPdb, pos, chain } = req.body;
    if (!wtPdb || !mutPdb || pos === undefined || !chain) {
      sendError(res, 400, "BAD_REQUEST", "Missing required fields: wtPdb, mutPdb, pos, chain");
      return;
    }
    const posVal = parseInt(pos, 10);
    if (isNaN(posVal)) {
      sendError(res, 400, "BAD_REQUEST", "Position (pos) must be a number");
      return;
    }
    const diff = computeStructuralDiff(wtPdb, mutPdb, posVal, chain);
    res.json(diff);
  } catch (error: any) {
    console.error("Structural diff endpoint failure:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "Failed to compute structural difference.");
  }
});

function handleNarrativeResponse(
  res: express.Response,
  analysisResult: any,
  gene: string,
  variant: string,
  clinvar: any,
  predictorData: any,
  conservationData: any,
  gnomadConstraint: any,
  gnomadFrequency: any,
  acmgWeighting: "standard" | "conservative" | "strict-structural",
  esm2?: { llr: number | null; verdict: string } | null,
  uniprotFeatures?: any | null,
  sequence?: string | null
) {
  if (analysisResult.insights) {
    (analysisResult.insights as any).source = "ai_inference";
    (analysisResult.insights as any).model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  // ACMG-1: Reconciliation layer — merge AI-suggested ACMG criteria with rule-based criteria.
  // Rule-based items (database-evidenced) take precedence for overlapping codes.
  const aiCriteria: ACMGItem[] = (analysisResult.insights?.acmgCriteria ?? []) as ACMGItem[];
  const ruleInsights = computeRuleBasedACMG(
    gene, variant, clinvar, predictorData, conservationData, gnomadConstraint, gnomadFrequency, acmgWeighting, esm2, uniprotFeatures, sequence
  );
  const ruleCodesSet = new Set(ruleInsights.acmgCriteria.map((c: ACMGItem) => c.code));

  // Only include AI suggestions that don't duplicate a rule-based code
  const uniqueAiCriteria = aiCriteria
    .filter((c: ACMGItem) => !ruleCodesSet.has(c.code))
    .map((c: ACMGItem) => ({ ...c, source: "ai_suggested" as const }));

  const mergedCriteria: (ACMGItem & { source?: string })[] = [
    ...ruleInsights.acmgCriteria.map((c: ACMGItem) => ({ ...c, source: "database_verified" as const })),
    ...uniqueAiCriteria,
  ];

  res.json({
    analysis: analysisResult.analysis,
    insights: {
      ...analysisResult.insights,
      acmgCriteria: mergedCriteria,
      acmgVerdict: ruleInsights.acmgVerdict,
      partialEvidence: ruleInsights.partialEvidence,
    },
  });
}

apiRouter.post("/analyze-variant-narrative", jsonParserRegular, async (req, res) => {
  try {
    let gene: string, variant: string, uniprotId: string;
    let userDirections: string | undefined;
    let acmgWeighting: "standard" | "conservative" | "strict-structural" = "standard";

    try {
      gene = validateGene(req.body.gene);
      variant = validateVariant(req.body.variant);
      uniprotId = validateUniProt(req.body.uniprotId);
      userDirections = req.body.userDirections ? String(req.body.userDirections) : undefined;
      
      if (req.body.acmgWeighting !== undefined) {
        if (req.body.acmgWeighting === "standard" || req.body.acmgWeighting === "conservative" || req.body.acmgWeighting === "strict-structural") {
          acmgWeighting = req.body.acmgWeighting;
        } else {
          throw new Error("acmgWeighting must be one of: standard, conservative, strict-structural");
        }
      }
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    const { clinvar, predictorData, conservationData, stringInteractions, gnomadConstraint, gnomadFrequency, uniprotFeatures, sequence } = req.body;

    const mutMatch = variant.match(/([a-zA-Z]{3}|\w)\s*(\d+)\s*([a-zA-Z]{3}|\w)/);
    if (!mutMatch) {
      sendError(res, 400, "BAD_REQUEST", `Invalid protein variant format: ${variant}`);
      return;
    }
    const wildType = mutMatch[1];
    const residueIndex = mutMatch[2];
    const mutant = mutMatch[3];

    const cacheKey = `clinical_${uniprotId}_${variant}_${acmgWeighting}_${userDirections || ""}`;
    const cached = getFromCache(cacheKey);

    if (cached) {
      console.log(`[Cache Hit] Serving cached clinical Gemini narrative for ${cacheKey}`);
      return handleNarrativeResponse(
        res,
        cached,
        gene,
        variant,
        clinvar,
        predictorData,
        conservationData,
        gnomadConstraint,
        gnomadFrequency,
        acmgWeighting,
        null,
        uniprotFeatures,
        sequence
      );
    }

    // Cache miss: invoke rate limiter programmatically (bypass during tests)
    const runHandler = async () => {
      try {
        const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
        let customApiKey: string | undefined;
        if (customSessionId) {
          customApiKey = getApiKeyFromSession(customSessionId);
          if (!customApiKey) {
            sendError(res, 401, "SESSION_EXPIRED", "Gemini API key session has expired. Please re-authenticate in Settings.");
            return;
          }
        }

        const timeoutSignal = AbortSignal.timeout(120000);
        const reqId = req.headers["x-request-id"] as string;

        let analysisResult;
        try {
          analysisResult = await performGeminiAnalysis(
            gene,
            variant,
            uniprotId,
            residueIndex,
            wildType,
            mutant,
            userDirections,
            clinvar,
            acmgWeighting,
            customApiKey,
            timeoutSignal,
            predictorData,
            conservationData,
            stringInteractions
          );
          writeToCache(cacheKey, analysisResult);
        } catch (err: any) {
          console.warn("[Graceful Fallback] Gemini narrative execution failed:", err.message);
          await AuditLogger.log("ANALYZE_VARIANT_FAILED", {
            reqId,
            code: err instanceof GeminiError ? err.code : "INTERNAL_ERROR",
            message: err.message
          });
          analysisResult = {
            analysis: `⚠️ **AI Narrative Explanation Unavailable**\n\nThe Gemini AI explanation service is currently experiencing service limits or could not be reached (${err.message}). Standard database metrics, predictions, and sequence conservation details have been loaded and are fully functional in the dashboard below.`,
            insights: {
              biochemicalShift: "Unavailable (AI Service Offline)",
              structuralImpact: "Unavailable (AI Service Offline)",
              acmgCriteria: []
            }
          };
        }

        handleNarrativeResponse(
          res,
          analysisResult,
          gene,
          variant,
          clinvar,
          predictorData,
          conservationData,
          gnomadConstraint,
          gnomadFrequency,
          acmgWeighting,
          null,
          uniprotFeatures,
          sequence
        );
      } catch (innerError: any) {
        console.error("Narrative inner execution failure:", innerError);
        sendError(res, 500, "INTERNAL_ERROR", innerError.message || "Failed to process narrative request.");
      }
    };

    if (process.env.NODE_ENV === "test") {
      await runHandler();
    } else {
      analyzeVariantLimiter(req, res, runHandler);
    }
  } catch (error: any) {
    console.error("Narrative endpoint failure:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "Failed to process narrative request.");
  }
});

apiRouter.post("/generate-mutant", jsonParserPdb, async (req, res) => {
  try {
    const { wtPdb, mutation, uniprotId } = req.body;

    if (!wtPdb || typeof wtPdb !== "string" || (!wtPdb.includes("ATOM") && !wtPdb.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (wtPdb.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }
    if (!mutation || typeof mutation !== "string" || !MUTATION_FOLDX_PATTERN.test(mutation.trim())) {
      sendError(res, 400, "BAD_REQUEST", "Invalid mutation code: must match FoldX format (e.g., RA215W).");
      return;
    }

    const mutTrimmed = mutation.trim();
    const wtLetter = mutTrimmed[0].toUpperCase();
    const mutLetter = mutTrimmed[mutTrimmed.length - 1].toUpperCase();
    if (wtLetter === mutLetter) {
      sendError(res, 400, "BAD_REQUEST", "Synonymous mutation detected: WT and mutant residues are identical.");
      return;
    }

    // Resolve chain and residue index from the WT PDB structure first
    const mutMatch = mutTrimmed.match(/^([a-zA-Z])([a-zA-Z])(\d+)([a-zA-Z])$/);
    if (!mutMatch) {
      sendError(res, 400, "BAD_REQUEST", "Invalid mutation code format.");
      return;
    }
    const chainParam = mutMatch[2].toUpperCase();
    const posNum = parseInt(mutMatch[3], 10);

    let resolvedChain = chainParam;
    let pdbResidues: any[] | null = null;
    try {
      pdbResidues = await parseResiduesFromPdbMaybeAsync(wtPdb);
      const targetRes = pdbResidues.find(r => r.resSeq === posNum && (chainParam === "" || r.chain === chainParam));
      if (targetRes) {
        resolvedChain = targetRes.chain;
      } else {
        const fallbackRes = pdbResidues.find(r => r.resSeq === posNum);
        if (fallbackRes) {
          resolvedChain = fallbackRes.chain;
        }
      }
    } catch (pdbErr) {
      console.warn("[PDB Parse Warning] Failed to parse residues for chain resolution:", pdbErr);
    }
    const resolvedChainUpper = resolvedChain.toUpperCase() || "A";

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

    async function cleanupFiles() {
      try {
        if (fs.existsSync(jobDir)) {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
          console.log(`[Cleanup] Deleted temporary job directory: ${jobDir}`);
        }
      } catch (cleanupErr: any) {
        console.error(`[Cleanup Error] Job directory cleanup failed:`, cleanupErr.message);
      }
    }

    try {
      let foldxResult: { pdb: string; ddG: number | null; status: string; foldedResidueIndex: number; resolvedChain?: string; energetics?: any } | null = null;
      let foldxError: any = null;

      let dynamut2JobId: string | null = null;
      let dynamut2Status: "pending" | "unavailable" = "unavailable";

      let ddmutJobId: string | null = null;
      let ddmutStatus: "pending" | "unavailable" = "unavailable";

      let ddgun: number | null = null;
      let rasp: number | null = null;
      let isRaspSurrogate = false;

      const runFoldX = async () => {
        let acquired = false;
        try {
          await biophysicalSemaphore.acquire();
          acquired = true;

          await AuditLogger.log("GENERATE_MUTANT", {
            mutation: mutTrimmed
          });

          if (process.env.NODE_ENV !== "production") {
            console.log(`[Biophysical Modeling] Generating mutant structure for mutation configuration: ${mutTrimmed}`);
          } else {
            console.log("[Biophysical Modeling] Generating mutant structure...");
          }

          // Create job directory
          await fs.promises.mkdir(jobDir, { recursive: true });
          foldxResult = await generateMutantPdb(wtPdb, mutTrimmed, uniprotId, jobDir);
        } catch (err: any) {
          foldxError = err;
        } finally {
          if (acquired) {
            biophysicalSemaphore.release();
          }
        }
      };

      const runDynaMut = async () => {
        try {
          dynamut2JobId = await submitDynaMut2Job(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter);
          if (dynamut2JobId) {
            dynamut2Status = "pending";
          }
        } catch (submitErr: any) {
          console.warn(`[DynaMut2 Submission Fail] Failed to submit job:`, submitErr.message);
        }
      };

      const runDdmut = async () => {
        try {
          ddmutJobId = await submitDdmutJob(wtPdb, resolvedChainUpper, posNum, wtLetter, mutLetter);
          if (ddmutJobId) {
            ddmutStatus = "pending";
          }
        } catch (submitErr: any) {
          console.warn(`[DDMut Submission Fail] Failed to submit job:`, submitErr.message);
        }
      };

      const runDDGun = async () => {
        try {
          let seq = "";
          let minPos = 1;
          if (pdbResidues) {
            const seqInfo = extractSequenceFromPdb(wtPdb, resolvedChainUpper);
            seq = seqInfo.sequence;
            minPos = seqInfo.minPos;
          }
          const seqPos = posNum - minPos + 1;
          ddgun = await runDdgunSeq(wtLetter, mutLetter, seq, seqPos);
        } catch (err: any) {
          console.warn("[DDGun-Seq Warning] Failed to run:", err.message);
        }
      };

      // Run FoldX, DynaMut2, DDGun-Seq, and DDMut in parallel
      await Promise.all([
        runFoldX(),
        runDynaMut(),
        runDDGun(),
        runDdmut()
      ]);

      // Handle FoldX-phase errors that should abort the request (input errors / residue mismatch)
      if (foldxError) {
        console.warn(`[Biophysical Server Route] FoldX execution error:`, foldxError.message);
        const reqId = req.headers["x-request-id"] as string;
        await AuditLogger.log("GENERATE_MUTANT_FAILED", {
          reqId,
          message: foldxError.message
        });

        if (foldxError.message.includes("not found in PDB") || foldxError.message.includes("mismatch")) {
          sendError(res, 422, "UNPROCESSABLE_ENTITY", foldxError.message);
          return;
        }

        // If it's a modeling engine unavailable or invalid foldx file, we degrade gracefully instead of 503/500 crash.
        console.log(`[Biophysical Server Route] Gracefully degrading FoldX failure to WT PDB fallback.`);
      }

      const reqId = (req.headers["x-request-id"] || crypto.randomUUID()) as string;
      await AuditLogger.log("DYNAMUT2_SUBMIT", {
        reqId,
        dynamut2JobId,
        status: dynamut2Status
      });

      await AuditLogger.log("DDMUT_SUBMIT", {
        reqId,
        ddmutJobId,
        status: ddmutStatus
      });

      // Run RaSP sequentially after FoldX (requires mutant PDB text from foldxResult)
      const foldxResForRasp = foldxResult as any;
      if (foldxResForRasp?.pdb) {
        try {
          const wtPdbPath = path.join(jobDir, "wt_for_rasp.pdb");
          const mutPdbPath = path.join(jobDir, "mut_for_rasp.pdb");
          await fs.promises.mkdir(jobDir, { recursive: true });
          await fs.promises.writeFile(wtPdbPath, wtPdb, "utf8");
          await fs.promises.writeFile(mutPdbPath, foldxResForRasp.pdb, "utf8");
          const raspRes = await runRaspLocal(wtPdbPath, mutPdbPath, resolvedChainUpper, posNum, wtLetter, mutLetter, uniprotId);
          if (raspRes !== null) {
            rasp = raspRes.score;
            isRaspSurrogate = raspRes.isSurrogate;
            console.log(`[RaSP] ΔΔG prediction: ${rasp} kcal/mol (surrogate: ${isRaspSurrogate})`);
          }
          // Clean up temp files
          await Promise.allSettled([
            fs.promises.unlink(wtPdbPath),
            fs.promises.unlink(mutPdbPath)
          ]);
        } catch (raspErr: any) {
          console.warn(`[RaSP] Failed to compute prediction:`, raspErr.message);
        }
      }

      // If FoldX succeeded, use its outputs; otherwise, fallback to WT structures and nulls
      const foldxRes = foldxResult as any;
      const finalPdb = foldxRes ? foldxRes.pdb : wtPdb;
      const finalDdG = foldxRes ? foldxRes.ddG : null;
      const finalStatus = foldxRes ? foldxRes.status : "failed";

      const foldxMean = foldxRes?.energetics?.foldxMean ?? finalDdG;
      const foldxSd = foldxRes?.energetics?.foldxSd ?? null;
      const vdw = foldxRes?.energetics?.vdw ?? null;
      const electrostatics = foldxRes?.energetics?.electrostatics ?? null;
      const stericClashWarning = foldxRes?.energetics?.stericClashWarning ?? false;
      const localSidechainRmsd = foldxRes?.energetics?.localSidechainRmsd ?? null;

      const consensusVerdict = computeConsensusVerdict({ foldxMean, rasp, ddgun });

      res.json({
        pdb: finalPdb,
        ddG: finalDdG,
        status: finalStatus,
        foldedResidueIndex: posNum,
        resolvedChain: resolvedChainUpper,
        dynamut2JobId,
        dynamut2Status,
        ddmutJobId,
        ddmutStatus,
        energetics: {
          foldx: finalDdG,
          foldxMean,
          foldxSd,
          vdw,
          electrostatics,
          stericClashWarning,
          localSidechainRmsd,
          dynamut2: null,
          ddmut: null,
          rasp,
          isRaspSurrogate,
          ddgun,
          consensusVerdict
        }
      });
    } finally {
      await cleanupFiles();
    }
  } catch (outerErr: any) {
    sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
  }
});

const ensemblResponseSchema = z.array(
  z.object({
    transcript_consequences: z.array(
      z.object({
        transcript_id: z.string().optional(),
        canonical: z.union([z.number(), z.boolean()]).optional(),
        mane_select: z.string().optional(),
        hgvsp: z.string().optional(),
        gene_symbol: z.string().optional(),
        swissprot: z.array(z.string()).optional()
      })
    ).optional()
  })
);

apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
  try {
    const { variant } = req.body;
    if (!variant || typeof variant !== "string") {
      sendError(res, 400, "BAD_REQUEST", "Missing or invalid variant parameter.");
      return;
    }

    const trimmed = variant.trim();
    if (!VCF_GENOMIC_PATTERN.test(trimmed) && !CDNA_PATTERN.test(trimmed)) {
      sendError(res, 400, "BAD_REQUEST", `Invalid notation format: "${trimmed}". Must be genomic VCF (e.g., chr7:g.140753336A>T) or transcript cDNA (e.g., NM_004333.6:c.1799T>A).`);
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      console.log(`[VEP Translator] Translating notation: "${trimmed}" via Ensembl REST API...`);
    } else {
      console.log("[VEP Translator] Translating notation via Ensembl REST API...");
    }

    // Log translation request (SEC-6)
    await AuditLogger.log("TRANSLATE_VARIANT", {
      variant: trimmed
    });

    const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(trimmed)}?content-type=application/json&hgvs=1&canonical=1&uniprot=1&mane=1`;
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      const text = await response.text();
      sendError(res, response.status === 400 ? 400 : 502, "TRANSLATION_FAILED", `Ensembl VEP API returned status ${response.status}: ${text.slice(0, 300)}`);
      return;
    }

    const rawData = await response.json();
    const parseResult = ensemblResponseSchema.safeParse(rawData);
    if (!parseResult.success) {
      sendError(res, 502, "BAD_GATEWAY", "Ensembl VEP API returned an invalid response structure.");
      return;
    }
    const data = parseResult.data;
    if (data.length === 0 || !data[0].transcript_consequences) {
      sendError(res, 404, "NOT_FOUND", "No transcript consequences found for the provided variant.");
      return;
    }

    const consequences = data[0].transcript_consequences;
    // Find MANE Select first, then canonical, then fallback to first with hgvsp
    let selectedTc = consequences.find((t) => t.mane_select && !!t.hgvsp);
    if (!selectedTc) {
      selectedTc = consequences.find((t) => (t.canonical === 1 || t.canonical === true) && !!t.hgvsp);
    }
    if (!selectedTc) {
      selectedTc = consequences.find((t) => !!t.hgvsp);
    }

    if (!selectedTc || !selectedTc.hgvsp) {
      sendError(res, 404, "NOT_FOUND", "Could not find a transcript mapping to a protein variant (HGVSp).");
      return;
    }

    // Validate the values before echoing them
    let geneSymbol: string;
    let proteinPart: string;
    let uniprotId = "";

    try {
      geneSymbol = validateGene(selectedTc.gene_symbol || "");
      proteinPart = validateVariant(selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp);
      if (selectedTc.swissprot && selectedTc.swissprot.length > 0) {
        uniprotId = validateUniProt(selectedTc.swissprot[0].split(".")[0]);
      }
    } catch (valErr: any) {
      sendError(res, 422, "UNPROCESSABLE_ENTITY", `Resolved variant values are invalid: ${valErr.message}`);
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[VEP Translator] Resolved VCF/cDNA to: Gene: ${geneSymbol}, Protein Variant: ${proteinPart}, UniProt: ${uniprotId}`);
    } else {
      console.log("[VEP Translator] Resolved VCF/cDNA successfully.");
    }

    // TRANSCRIPT-DISC: Return transcript metadata alongside protein coordinates.
    const transcriptId: string = selectedTc.transcript_id || "";
    const isCanonical: boolean = !!(selectedTc.canonical === 1 || selectedTc.canonical === true);
    const transcriptWarning: string | undefined = !isCanonical
      ? "Non-canonical transcript used — disease isoform may differ. Verify transcript against MANE Select or RefSeq clinical."
      : undefined;

    res.json({
      gene: geneSymbol,
      variant: proteinPart,
      uniprotId,
      transcriptId,
      isCanonical,
      ...(transcriptWarning ? { transcriptWarning } : {}),
    });
  } catch (err: any) {
    console.error(`[VEP Translator Crash]:`, err);
    if (err.name === "AbortError" || err.message.includes("timeout")) {
      sendError(res, 504, "TIMEOUT", "Ensembl VEP query timed out. Please try again.");
      return;
    }
    sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during coordinate translation.");
  }
});

apiRouter.get("/sequence/:uniprotId", async (req, res) => {
  let validatedUniprot: string;
  try {
    validatedUniprot = validateUniProt(req.params.uniprotId);
  } catch (err: any) {
    sendError(res, 400, "BAD_REQUEST", err.message);
    return;
  }
  try {
    const sequence = await fetchUniprotSequence(validatedUniprot);
    res.json({ sequence });
  } catch (err: any) {
    console.warn(`[Sequence] Could not fetch UniProt sequence for ${validatedUniprot}: ${err.message}.`);
    const reqId = req.headers["x-request-id"] as string;
    await AuditLogger.log("SEQUENCE_FETCH_FAILED", {
      reqId,
      uniprotId: validatedUniprot,
      message: err.message
    });
    sendError(res, 424, "SEQUENCE_UNAVAILABLE", `Could not retrieve UniProt sequence for accession: ${validatedUniprot}. The UniProt REST API may be temporarily unavailable — please retry.`);
  }
});

apiRouter.post("/pocket-finder", jsonParserPdb, async (req, res) => {
  try {
    const { pdbText, targetIndex } = req.body;

    if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (pdbText.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }

    const mutIndex = targetIndex !== undefined && targetIndex !== null ? Number(targetIndex) : null;
    if (mutIndex === null || isNaN(mutIndex) || mutIndex <= 0 || mutIndex > 99999) {
      sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a positive integer.");
      return;
    }

    try {
      const parsedResidues = await parseResiduesFromPdbMaybeAsync(pdbText);
      if (!parsedResidues || parsedResidues.length === 0) {
        throw new Error("PDB structure contains no parseable residues.");
      }
      const targetRes = parsedResidues.find(r => r.resSeq === mutIndex);
      if (!targetRes) {
        sendError(res, 400, "BAD_REQUEST", `Target residue index #${mutIndex} was not found in the PDB structure.`);
        return;
      }
    } catch (parseErr: any) {
      sendError(res, 400, "BAD_REQUEST", `Malformed PDB structure: ${parseErr.message}`);
      return;
    }

    let acquired = false;
    try {
      await biophysicalSemaphore.acquire();
      acquired = true;
    } catch (semErr: any) {
      sendError(res, 503, "CONCURRENCY_LIMIT", "Biophysical server is busy. Please try again later.");
      return;
    }

    const jobId = crypto.randomUUID();
    const jobDir = path.join(process.cwd(), "temp_jobs", jobId);

    async function cleanupPocketFiles() {
      try {
        if (fs.existsSync(jobDir)) {
          await fs.promises.rm(jobDir, { recursive: true, force: true });
          console.log(`[Cleanup] Deleted temporary pocket job directory: ${jobDir}`);
        }
      } catch (cleanupErr: any) {
        console.error("[Pocket Cleanup Error] Cleanup failed:", cleanupErr.message);
      }
    }

    try {
      const result = await findBindingPocket(pdbText, mutIndex, jobDir);
      res.json(result);

    } catch (err: any) {
      console.error("Pocket finder route failure:", err);
      const reqId = req.headers["x-request-id"] as string;
      await AuditLogger.log("POCKET_FINDER_FAILED", {
        reqId,
        message: err.message
      });
      if (err.message.includes("out of range") || err.message.includes("not found")) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", err.message);
      } else {
        sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred during pocket finding.");
      }
    } finally {
      await cleanupPocketFiles();
      if (acquired) {
        biophysicalSemaphore.release();
      }
    }
  } catch (outerErr: any) {
    sendError(res, 500, "INTERNAL_ERROR", outerErr.message || "An unexpected error occurred.");
  }
});

apiRouter.post("/nearest-residues", jsonParserPdb, async (req, res) => {
  try {
    const { pdbText, targetIndex } = req.body;
    let n = req.body.n !== undefined ? Number(req.body.n) : 5;

    if (!pdbText || typeof pdbText !== "string" || (!pdbText.includes("ATOM") && !pdbText.includes("HETATM"))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid PDB content: missing ATOM/HETATM records.");
      return;
    }
    if (pdbText.length > 5 * 1024 * 1024) {
      sendError(res, 400, "BAD_REQUEST", "PDB file exceeds maximum size of 5MB.");
      return;
    }
    if (targetIndex === undefined || targetIndex === null || isNaN(Number(targetIndex))) {
      sendError(res, 400, "BAD_REQUEST", "Invalid targetIndex: must be a number.");
      return;
    }
    const targetIndexNum = Number(targetIndex);

    if (isNaN(n) || n <= 0) {
      n = 5;
    }
    if (n > 20) {
      n = 20;
    }

    const residues = await parseResiduesFromPdbMaybeAsync(pdbText);
      const targetRes = residues.find(r => r.resSeq === targetIndexNum);
      if (!targetRes) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Target residue position ${targetIndexNum} is not found in the PDB structure.`);
        return;
      }

      if (targetRes.x === undefined || targetRes.y === undefined || targetRes.z === undefined) {
        sendError(res, 422, "UNPROCESSABLE_ENTITY", `Coordinates for target residue position ${targetIndexNum} could not be extracted.`);
        return;
      }

      const computedNeighbors: any[] = [];
      for (const r of residues) {
        if (r.resSeq === targetIndexNum) continue;
        if (r.x === undefined || r.y === undefined || r.z === undefined) continue;

        const dx = r.x - targetRes.x;
        const dy = r.y - targetRes.y;
        const dz = r.z - targetRes.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const details = getResidueDetails(r.resName3);
        computedNeighbors.push({
          index: r.resSeq,
          name: r.resName3,
          distance: parseFloat(dist.toFixed(2)),
          properties: details.properties,
          role: details.role,
          classBadge: details.classBadge
        });
      }

      computedNeighbors.sort((a, b) => a.distance - b.distance);
      const sliced = computedNeighbors.slice(0, n);

      res.json({
        residues: sliced,
        source: "computed"
      });
    } catch (err: any) {
    console.error("Nearest residues calculation failure:", err);
    sendError(res, 500, "INTERNAL_ERROR", err.message || "An error occurred while computing nearest residues.");
  }
});

apiRouter.post("/session/keys", jsonParserRegular, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== "string") {
      sendError(res, 400, "BAD_REQUEST", "API key parameter is required.");
      return;
    }
    const cleanKey = apiKey.trim();
    if (cleanKey.length < 10 || cleanKey.length > 200 || !/^[a-zA-Z0-9_\-\.\+\=\/]+$/.test(cleanKey)) {
      sendError(res, 400, "BAD_REQUEST", "Invalid API key format or length.");
      return;
    }
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour session
    const secret = process.env.APP_SESSION_SECRET;
    if (!secret) {
      throw new Error("APP_SESSION_SECRET is not configured in the environment.");
    }
    const sessionId = encryptSession({ apiKey, expiresAt }, secret);
    
    res.json({ sessionId, expiresAt });
  } catch (err: any) {
    sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to create session.");
  }
});

apiRouter.post("/resolve-gene", jsonParserRegular, async (req, res) => {
  try {
    const { gene } = req.body;
    let validatedGeneSymbol: string;
    try {
      validatedGeneSymbol = validateGene(gene);
    } catch (err: any) {
      sendError(res, 400, "BAD_REQUEST", err.message);
      return;
    }

    const uniprotId = await resolveGeneToUniprot(validatedGeneSymbol);
    if (!uniprotId) {
      sendError(res, 404, "NOT_FOUND", `Gene '${validatedGeneSymbol}' could not be mapped to a canonical UniProt accession. Please check the spelling or provide a different gene symbol.`);
      return;
    }

    const hasPdb = await fetchAlphafoldPdb(uniprotId);
    res.json({
      gene: validatedGeneSymbol,
      uniprotId,
      pdbUrl: hasPdb ? `/api/v1/alphafold-pdb/${uniprotId}` : null
    });

  } catch (err: any) {
    console.error("Resolve gene route failure:", err);
    sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed to resolve gene to AlphaFold structure.");
  }
});

apiRouter.get("/alphafold-pdb/:uniprotId", async (req, res) => {
  let validatedUniprot: string;
  try {
    validatedUniprot = validateUniProt(req.params.uniprotId);
  } catch (err: any) {
    sendError(res, 400, "BAD_REQUEST", err.message);
    return;
  }
  
  // Parse optional query parameter `pos` for position coverage matching
  let pos: number | undefined;
  if (req.query.pos) {
    const parsedPos = parseInt(req.query.pos as string, 10);
    if (!isNaN(parsedPos)) {
      pos = parsedPos;
    }
  }

  // 1. Try experimental structures mapping first (PDB Prioritization)
  try {
    const pdbMapping = await fetchBestPdbStructure(validatedUniprot, pos);
    if (pdbMapping) {
      const { pdbId, chainId } = pdbMapping;
      const cacheKey = `pdb_rcsb_${pdbId}_chain_${chainId}`;
      
      if (pdbCache.has(cacheKey)) {
        if (process.env.NODE_ENV !== "production") {
          console.log(`[Cache Hit] Serving RCSB PDB for ${pdbId} chain ${chainId} from memory cache.`);
        }
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("X-Template-Source", "experimental");
        res.send(pdbCache.get(cacheKey));
        return;
      }
      
      const pdbData = await fetchPdbFromRcsb(pdbId, chainId);
      if (pdbData) {
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("X-Template-Source", "experimental");
        res.send(pdbData);
        return;
      }
    }
  } catch (pdbErr: any) {
    console.warn(`[PDB Prioritization] Failed to resolve best PDB structure for ${validatedUniprot}:`, pdbErr.message || pdbErr);
  }

  // 2. Fallback to AlphaFold DB
  if (pdbCache.has(validatedUniprot)) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[Cache Hit] Serving AlphaFold PDB for ${validatedUniprot} from memory cache.`);
    }
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("X-Template-Source", "alphafold");
    res.send(pdbCache.get(validatedUniprot));
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`PDB proxy requesting AlphaFold structure for UniProt ID: ${validatedUniprot}`);
  } else {
    console.log("PDB proxy requesting structure.");
  }
  
  try {
    const pdbData = await fetchAlphafoldPdb(validatedUniprot);
    if (pdbData) {
      pdbCache.set(validatedUniprot, pdbData);
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("X-Template-Source", "alphafold");
      res.send(pdbData);
    } else {
      sendError(res, 502, "BAD_GATEWAY", `Could not load AlphaFold PDB for accession: ${validatedUniprot}. EBI server returned failure.`);
    }
  } catch (err: any) {
    console.error(`PDB Proxy error:`, err);
    sendError(res, 500, "INTERNAL_ERROR", err.message || "Failed proxying PDB structure.");
  }
});

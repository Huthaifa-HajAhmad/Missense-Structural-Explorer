/**
 * shared.ts — Shared helpers for route modules.
 * Contains: gemini response cache, job registry, narrative response handler,
 * alt-variant generator. These utilities are consumed by multiple route files.
 */
import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { type AnalysisResult } from "../../src/types.ts";
import { computeRuleBasedACMG } from "../services/acmg.ts";
import {
  type ClinVarData,
  type PredictorData,
  type ConservationData,
  type GnomadGeneConstraint,
  type GnomadVariantFrequency,
  type UniprotFeaturesResult,
} from "../services/external.ts";
import { type RuleBasedInsights, type ACMGItem } from "../services/acmg.ts";
import { AMINO_ACID_1_TO_3_TITLE } from "../../src/aminoAcids.ts";
import { AuditLogger } from "../utils.ts";
import { GeminiError, getConfiguredGeminiModels } from "../services/gemini.ts";
import { computeCalibratedConsensus } from "../../src/shared/thresholds.ts";

// ---------------------------------------------------------------------------
// Gemini response cache (in-memory + disk)
// ---------------------------------------------------------------------------
export const geminiCache = new Map<string, any>();
export const CACHE_DIR = path.join(process.cwd(), "logs", "gemini_cache");
export const GEMINI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export function getCacheFilename(cacheKey: string): string {
  const hash = crypto.createHash("sha256").update(cacheKey).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

export function getFromCache(cacheKey: string): any | null {
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

export function writeToCache(cacheKey: string, data: any) {
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

    fs.promises.mkdir(cacheDir, { recursive: true })
      .then(() => fs.promises.writeFile(filename, JSON.stringify(entry), "utf-8"))
      .catch(err => {
        console.error("[Cache Write Error]", err.message);
      });
  } catch (err) {
    console.error("Error writing disk cache:", err);
  }
}

// ---------------------------------------------------------------------------
// Alt variant generator
// ---------------------------------------------------------------------------
export function generateAltVariants(sequence: string): string[] {
  // NOTE (C-6): These alternative comparison variants are generated at arbitrary, evenly-spaced fractional
  // positions (15%, 35%, 55%, 75% of sequence length) for comparative baseline visualization in the UI.
  // They do not represent biologically informed functional domain or hot-spot recommendations.
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

// ---------------------------------------------------------------------------
// Job registry
// ---------------------------------------------------------------------------
export interface RegistryJob {
  jobId: string;
  type: "dynamut2" | "ddmut" | "thermompnn";
  mutation: string;
  timestamp: string;
}

export const REGISTRY_PATH = path.join(process.cwd(), "temp_jobs", "job_registry.json");

export async function recordJobInRegistry(jobId: string, type: "dynamut2" | "ddmut" | "thermompnn", mutation: string) {
  try {
    let registry: RegistryJob[] = [];
    if (fs.existsSync(REGISTRY_PATH)) {
      try {
        const content = await fs.promises.readFile(REGISTRY_PATH, "utf-8");
        registry = JSON.parse(content) as RegistryJob[];
      } catch {}
    }
    registry.push({
      jobId,
      type,
      mutation,
      timestamp: new Date().toISOString()
    });
    if (registry.length > 1000) {
      registry = registry.slice(-1000);
    }
    await fs.promises.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
    const tmpPath = `${REGISTRY_PATH}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    try {
      await fs.promises.rename(tmpPath, REGISTRY_PATH);
    } catch (renameErr) {
      await fs.promises.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf-8");
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath).catch(() => {});
      }
    }
  } catch (err: any) {
    console.warn("[Job Registry Warning] Failed to write job to registry:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Narrative response handler
// ---------------------------------------------------------------------------
export function handleNarrativeResponse(
  res: express.Response,
  analysisResult: AnalysisResult,
  gene: string,
  variant: string,
  clinvar: ClinVarData | null,
  predictorData: PredictorData | null,
  conservationData: ConservationData | null,
  gnomadConstraint: GnomadGeneConstraint | null,
  gnomadFrequency: GnomadVariantFrequency | null,
  acmgWeighting: "standard" | "conservative" | "strict-structural",
  esm2?: { llr: number | null; verdict: string } | null,
  uniprotFeatures?: UniprotFeaturesResult | null,
  sequence?: string | null
) {
  if (analysisResult.insights) {
    (analysisResult.insights as any).source = "ai_inference";
    (analysisResult.insights as any).model = getConfiguredGeminiModels()[0];
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

export function enrichBiophysicalResult(
  foldxRawResult: any,
  remoteJobs: {
    dynamut2JobId: string | null;
    dynamut2Status: string | null;
    ddmutJobId: string | null;
    ddmutStatus: string | null;
    thermompnnJobId: string | null;
    thermompnnStatus: string | null;
    thermompnnError: string | null;
    thermompnnVal: number | null;
    stabilityoracleVal: number | null;
  },
  structureProvenance: any,
  posNum: number
) {
  const finalPdb = foldxRawResult.pdb;
  const finalDdG = foldxRawResult.ddG;
  const finalStatus = foldxRawResult.status;

  const foldxMean = foldxRawResult.energetics?.foldxMean ?? finalDdG;
  const foldxSd = foldxRawResult.energetics?.foldxSd ?? null;
  const vdw = foldxRawResult.energetics?.vdw ?? null;
  const electrostatics = foldxRawResult.energetics?.electrostatics ?? null;
  const stericClashWarning = foldxRawResult.energetics?.stericClashWarning ?? false;
  const localSidechainRmsd = foldxRawResult.energetics?.localSidechainRmsd ?? null;
  const foldxRawDdGs = foldxRawResult.energetics?.rawDdGs ?? null;
  const foldxSeed = foldxRawResult.energetics?.seed ?? null;
  const rasp = foldxRawResult.energetics?.rasp ?? null;
  const raspReason = foldxRawResult.energetics?.raspReason ?? undefined;

  const pendingTools: string[] = [];
  if (remoteJobs.dynamut2Status === "pending") pendingTools.push("DynaMut2");
  if (remoteJobs.ddmutStatus === "pending") pendingTools.push("DDMut");
  if (remoteJobs.thermompnnStatus === "pending") pendingTools.push("ThermoMPNN");

  const evidenceComplete = pendingTools.length === 0;
  const foldxRepairFailed = foldxRawResult.energetics?.foldxRepairFailed ?? false;
  const calResult = computeCalibratedConsensus({
    foldxMean,
    rasp,
    thermompnn: remoteJobs.thermompnnVal,
    stabilityoracle: remoteJobs.stabilityoracleVal,
    foldxRepairFailed
  });
  const rawConsensusVerdict = calResult.consensusVerdict;
  const consensusVerdict = (!evidenceComplete && rawConsensusVerdict)
    ? `${rawConsensusVerdict} (Preliminary - pending: ${pendingTools.join(", ")})`
    : rawConsensusVerdict;

  return {
    pdb: finalPdb,
    ddG: finalDdG,
    foldxDdG: foldxMean,
    thermompnnDdG: remoteJobs.thermompnnVal,
    status: finalStatus,
    foldedResidueIndex: posNum,
    dynamut2JobId: remoteJobs.dynamut2JobId,
    dynamut2Status: remoteJobs.dynamut2Status,
    ddmutJobId: remoteJobs.ddmutJobId,
    ddmutStatus: remoteJobs.ddmutStatus,
    thermompnnJobId: remoteJobs.thermompnnJobId,
    thermompnnStatus: remoteJobs.thermompnnStatus,
    thermompnnError: remoteJobs.thermompnnError,
    energetics: {
      foldx: foldxMean,
      vdw,
      electrostatics,
      stericClashWarning,
      localSidechainRmsd,
      rawDdGs: foldxRawDdGs,
      foldxRepairFailed,
      dynamut2: null,
      ddmut: null,
      rasp,
      raspReason,
      thermompnn: remoteJobs.thermompnnVal,
      stabilityoracle: remoteJobs.stabilityoracleVal,
      consensusProbability: calResult.consensusProbability,
      consensusConfMin: calResult.consensusConfMin,
      consensusConfMax: calResult.consensusConfMax,
      consensusVerdict,
      evidenceComplete,
      pendingTools
    },
    provenance: structureProvenance
  };
}

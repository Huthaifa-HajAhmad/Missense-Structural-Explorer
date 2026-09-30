/**
 * shared.ts — Shared helpers for route modules.
 * Contains: gemini response cache, job registry, narrative response handler,
 * alt-variant generator. These utilities are consumed by multiple route files.
 */
import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { type AnalysisResult } from "../../src/shared/contracts.ts";
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
import { AMINO_ACID_1_TO_3_TITLE } from "../../src/shared/aminoAcids.ts";
import { isEngineOwnedCode } from "../../src/shared/acmgCriteriaView.ts";
import { AuditLogger } from "../utils.ts";
import { GeminiError } from "../services/gemini.ts";
import { narrativeCache } from "../services/cache.ts";

// ---------------------------------------------------------------------------
// Gemini response cache (LRU in-memory + L2 AnalysisDatabase SQLite)
// ---------------------------------------------------------------------------
export const geminiCache = narrativeCache;
export const GEMINI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getFromCache(cacheKey: string): any | null {
  return narrativeCache.get(cacheKey) || null;
}

export function writeToCache(cacheKey: string, data: any): void {
  narrativeCache.set(cacheKey, data);
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
  foldxCacheKey?: string;
}

/**
 * Live background-job registry path.
 *
 * Resolved per call rather than frozen at import so tests can redirect it; a module-scope
 * constant meant `biophysics.test.ts` deleted the developer's real registry on every run.
 */
export const REGISTRY_PATH_ENV = "JOB_REGISTRY_PATH";
export function getRegistryPath(): string {
  return process.env[REGISTRY_PATH_ENV] ?? path.join(process.cwd(), "temp_jobs", "job_registry.json");
}
/** @deprecated Prefer {@link getRegistryPath}; a frozen path cannot be redirected under test. */
export const REGISTRY_PATH = path.join(process.cwd(), "temp_jobs", "job_registry.json");

export async function recordJobInRegistry(
  jobId: string,
  type: "dynamut2" | "ddmut" | "thermompnn",
  mutation: string,
  foldxCacheKey?: string
) {
  try {
    const registryPath = getRegistryPath();
    let registry: RegistryJob[] = [];
    if (fs.existsSync(registryPath)) {
      try {
        const content = await fs.promises.readFile(registryPath, "utf-8");
        registry = JSON.parse(content) as RegistryJob[];
      } catch {}
    }
    registry.push({
      jobId,
      type,
      mutation,
      foldxCacheKey,
      timestamp: new Date().toISOString()
    });
    if (registry.length > 1000) {
      registry = registry.slice(-1000);
    }
    await fs.promises.mkdir(path.dirname(registryPath), { recursive: true });
    const tmpPath = `${registryPath}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
    try {
      await fs.promises.rename(tmpPath, registryPath);
    } catch (renameErr) {
      await fs.promises.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
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
    /**
     * Provenance is a fact about this run, so it is stamped by the route rather than by the model.
     *
     * This used to write `source = "ai_inference"` and `model = getConfiguredGeminiModels()[0]`
     * unconditionally, INCLUDING for the degraded rule-based report the route itself assembles when
     * synthesis fails. A fallback therefore travelled to the client claiming AI inference by a model
     * that never answered — and it named the HEAD of the fallback ladder, not the model that
     * answered on a healthy run either. `model` now comes from the engine (`performGeminiAnalysis`
     * reports the attempt that returned text) and is absent for a fallback, where nothing did.
     */
    const isFallback = Boolean(analysisResult.isFallback);
    (analysisResult.insights as any).source = isFallback ? "rule_based" : "ai_inference";
    if (isFallback) {
      delete (analysisResult.insights as any).model;
    }
  }

  // ACMG-1: Reconciliation layer — merge AI-suggested ACMG criteria with rule-based criteria.
  // Rule-based items (database-evidenced) take precedence for overlapping codes.
  const aiCriteria: ACMGItem[] = (analysisResult.insights?.acmgCriteria ?? []) as ACMGItem[];
  const ruleInsights = computeRuleBasedACMG({
    gene,
    variant,
    clinvar,
    predictorData,
    conservationData,
    gnomadConstraint,
    gnomadFrequency,
    acmgWeighting,
    esm2,
    uniprotFeatures,
    sequence
  });
  const ruleCodesSet = new Set(ruleInsights.acmgCriteria.map((c: ACMGItem) => c.code));

  // Only include AI suggestions that don't duplicate a rule-based code
  // and none for a code the engine owns: it ruled on those from data the model was never shown, so a
  // proposal there can only contradict "not met" or "withheld" (see `ENGINE_OWNED_CODES`).
  const uniqueAiCriteria = aiCriteria
    .filter((c: ACMGItem) => !ruleCodesSet.has(c.code) && !isEngineOwnedCode(c.code))
    .map((c: ACMGItem) => ({ ...c, source: "ai_suggested" as const }));

  const mergedCriteria: (ACMGItem & { source?: string })[] = [
    ...ruleInsights.acmgCriteria.map((c: ACMGItem) => ({ ...c, source: "database_verified" as const })),
    ...uniqueAiCriteria,
  ];

  res.json({
    analysis: analysisResult.analysis,
    isFallback: Boolean(analysisResult.isFallback),
    fallbackReason: analysisResult.fallbackReason || undefined,
    fallbackMessage: analysisResult.fallbackMessage || undefined,
    fallbackRetryable: analysisResult.fallbackRetryable,
    // Diagnostics travel beside the report, never inside its prose.
    providerDetail: analysisResult.providerDetail || undefined,
    attemptedModels: analysisResult.attemptedModels,
    insights: {
      ...analysisResult.insights,
      acmgCriteria: mergedCriteria,
      acmgVerdict: ruleInsights.acmgVerdict,
      partialEvidence: ruleInsights.partialEvidence,
    },
  });
}

export { enrichBiophysicalResult } from "../services/biophysics.ts";

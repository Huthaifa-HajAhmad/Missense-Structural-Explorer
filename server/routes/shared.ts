/**
 * shared.ts — Shared helpers for route modules.
 * Contains: gemini response cache, narrative response handler,
 * alt-variant generator. These utilities are consumed by multiple route files.
 */
import express from "express";
import type { CuratedInheritance } from "../../src/shared/inheritanceBasis.ts";
import type { CuratedLofMechanism } from "../../src/shared/lofMechanismBasis.ts";
import crypto from "crypto";

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
  uniprotFeatures?: UniprotFeaturesResult | null,
  sequence?: string | null,
  curatedInheritance?: CuratedInheritance | null,
  curatedLofMechanism?: CuratedLofMechanism | null
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
    curatedInheritance: curatedInheritance ?? null,
    curatedLofMechanism: curatedLofMechanism ?? null,
    acmgWeighting,
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

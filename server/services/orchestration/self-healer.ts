import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { computeRuleBasedACMG } from "../prediction/acmg.ts";
import { parseGenomicCoordinateString } from "../../../src/shared/contracts.ts";
import type { ClinVarData } from "../external-api/clinvar.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { persistVariantAnalysisPayload } from "./payload-assembler.ts";
import {
  buildClinvarKey,
  buildGenosKey,
  buildGnomadConstraintKey,
  buildGnomadFreqKey,
  buildPredictorsKey,
  buildUniprotFeaturesKey
} from "../infra/cache-keys.ts";

/**
 * Self-healing on read: Checks if cached analysis has timed-out fields or missing SpliceAI
 * that have since settled into the SQLite external_cache, heals them, and updates variant_analyses.
 */
export function healCachedAnalysisIfPossible(
  payload: any,
  context: ParsedVariantContext
): any {
  if (!payload) return payload;

  /*
   * Backfill the wild-type sequence into a payload persisted before the builders carried it.
   *
   * Rows live for 30 days and replay verbatim, so without this every already-analysed variant
   * keeps sending `sequence: null` to the narrative route, and the report's rule-based criteria
   * keep being computed without the sequence the pipeline's own run used (PVS1's C-terminal
   * demotion and the PM4/BP3 repeat test both key on it). The context is in hand here, and this
   * runs before the "nothing else to heal" early return below on purpose: the field is missing
   * on every row written before the builders changed, whether or not that row has timeouts.
   *
   * In-memory only. Persisting it would rewrite rows on every read, and the next full analysis
   * writes it anyway.
   */
  if (payload.metadata) {
    payload.metadata.sequence ??= context.sequence ?? null;
  }

  const status = payload.serviceStatus || {};
  const hasTimeouts = Object.values(status).includes("timeout");
  const missingSplice = !payload.conservationData?.spliceai;

  if (!hasTimeouts && !missingSplice) {
    return payload;
  }

  const db = AnalysisDatabase.getInstance();
  const gnomadVarId = payload.predictorData?.gnomadVariantId || "";
  const genosCache = db.getExternalCache<any>(
    buildGenosKey(context.gene, context.variant, gnomadVarId || undefined)
  );
  const clinvarCache = db.getExternalCache<ClinVarData>(
    buildClinvarKey(context.gene, context.variant, context.originalNotation)
  );

  let didHeal = false;

  // 1. Genos & Conservation healing
  if (genosCache?.data) {
    const g = genosCache.data;
    payload.conservationData = {
      ...payload.conservationData,
      revel: g.revel ?? payload.conservationData?.revel ?? null,
      gerp: g.gerp ?? payload.conservationData?.gerp ?? null,
      phylop: g.phylop ?? payload.conservationData?.phylop ?? null,
      bayesdel: g.bayesdel ?? payload.conservationData?.bayesdel ?? null,
      metarnn: g.metarnn ?? payload.conservationData?.metarnn ?? null,
      clinpred: g.clinpred ?? payload.conservationData?.clinpred ?? null,
      eigenPhred: g.eigenPhred ?? payload.conservationData?.eigenPhred ?? null,
      dann: g.dann ?? payload.conservationData?.dann ?? null,
      esm1b: g.esm1b ?? payload.conservationData?.esm1b ?? null,
      popeve: g.popeve ?? payload.conservationData?.popeve ?? null,
      spliceai: g.spliceai ?? payload.conservationData?.spliceai ?? null,
      dbscsnv: g.dbscsnv ?? payload.conservationData?.dbscsnv ?? null,
      aouFrequency: (g.aou_ac !== null && g.aou_ac !== undefined) ? {
        aouAC: g.aou_ac,
        aouAN: g.aou_an ?? null,
        aouHet: g.aou_het ?? null,
        aouHom: g.aou_hom ?? null
      } : payload.conservationData?.aouFrequency ?? null
    };
    if (payload.serviceStatus) payload.serviceStatus.conservationData = "ok";
    didHeal = true;
  }

  // 2. ClinVar healing
  if (clinvarCache?.data && (status.clinvar === "timeout" || status.clinvar === "error")) {
    payload.clinvar = clinvarCache.data;
    if (payload.serviceStatus) payload.serviceStatus.clinvar = "ok";
    didHeal = true;
  }

  // 3. gnomAD Frequency healing
  if (gnomadVarId && (status.gnomadFrequency === "timeout" || status.gnomadFrequency === "error")) {
    const gnomadFreqCache = db.getExternalCache<any>(buildGnomadFreqKey(gnomadVarId));
    if (gnomadFreqCache?.data) {
      payload.gnomadFrequency = gnomadFreqCache.data;
      if (payload.serviceStatus) payload.serviceStatus.gnomadFrequency = "ok";
      didHeal = true;
    }
  }

  // 4. gnomAD Constraint healing
  if (status.gnomadConstraint === "timeout" || status.gnomadConstraint === "error") {
    const gnomadConstraintCache = db.getExternalCache<any>(buildGnomadConstraintKey(context.gene));
    if (gnomadConstraintCache?.data) {
      payload.gnomadConstraint = gnomadConstraintCache.data;
      if (payload.serviceStatus) payload.serviceStatus.gnomadConstraint = "ok";
      didHeal = true;
    }
  }

  // 5. UniProt Features healing
  if (context.uniprotId && (status.uniprotFeatures === "timeout" || status.uniprotFeatures === "error")) {
    const uniprotCache = db.getExternalCache<any>(buildUniprotFeaturesKey(context.uniprotId));
    if (uniprotCache?.data) {
      payload.uniprotFeatures = uniprotCache.data;
      if (payload.serviceStatus) payload.serviceStatus.uniprotFeatures = "ok";
      didHeal = true;
    }
  }

  // 6. Predictors healing
  if (status.predictorData === "timeout" || status.predictorData === "error") {
    const predictorCache = db.getExternalCache<any>(
      // The predictor cache key carries the coordinate dimension now (review H2); the healer
      // reconstructs it from the same request context the original run used, so a coordinate-
      // first entry is found only by a request that forwarded the same coordinate. A coordinate
      // that fails to parse maps to "no coordinate" — the same shape the producer computes.
      buildPredictorsKey(context.gene, context.variant, context.uniprotId,
        (() => {
          const parsed = context.genomicCoordinates ? parseGenomicCoordinateString(context.genomicCoordinates) : null;
          return parsed ? { ...parsed, assembly: context.assembly ?? null } : null;
        })())
    );
    if (predictorCache?.data) {
      payload.predictorData = predictorCache.data;
      if (payload.serviceStatus) payload.serviceStatus.predictorData = "ok";
      didHeal = true;
    }
  }

  if (didHeal) {
    if (payload.metadata?.serviceStatus) {
      payload.metadata.serviceStatus = payload.serviceStatus;
    }
    const updatedInsights = computeRuleBasedACMG({
      gene: context.gene,
      variant: context.variant,
      clinvar: payload.clinvar,
      predictorData: payload.predictorData,
      conservationData: payload.conservationData,
      gnomadConstraint: payload.gnomadConstraint,
      gnomadFrequency: payload.gnomadFrequency,
      acmgWeighting: context.acmgWeighting,
      esm2: payload.esm2,
      uniprotFeatures: payload.uniprotFeatures,
      sequence: context.sequence,
      serviceStatus: payload.serviceStatus
    });
    payload.ruleBasedInsights = updatedInsights;

    try {
      persistVariantAnalysisPayload(context, payload, updatedInsights?.acmgVerdict || null);
      console.log(`[Self-Healing] Successfully healed and re-saved analysis for ${context.gene} ${context.variant}`);
    } catch (err: any) {
      console.warn(`[Self-Healing Warning] Failed to persist healed analysis: ${err.message}`);
    }
  }

  return payload;
}

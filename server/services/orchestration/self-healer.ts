import { AnalysisDatabase } from "../infra/analysis-db.ts";
import { computeRuleBasedACMG } from "../prediction/acmg.ts";
import { predictorCoordinateFromContext } from "../../../src/shared/contracts.ts";
import { isUsablePredictorResult } from "../prediction/predictors/vep-orchestrator.ts";
import { verifiedPopulationCoordinate } from "../prediction/predictors/allele-identity.ts";
import { isIntrinsicallyAmbiguousProteinChange } from "../../../src/shared/proteinAlleleIdentity.ts";
import type { ClinVarData } from "../external-api/clinvar.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";
import { persistVariantAnalysisPayload } from "./payload-assembler.ts";
import {
  buildClinvarKey,
  buildGenosKey,
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
  const requestedCoordinate = predictorCoordinateFromContext(context);
  const intrinsicallyAmbiguous = !requestedCoordinate &&
    isIntrinsicallyAmbiguousProteinChange(context.variant, context.gene);
  const verifiedCoordinate = intrinsicallyAmbiguous ? null : verifiedPopulationCoordinate(payload.predictorData);
  let didHeal = false;

  // Healing is another producer, not an exception to allele binding. Remove unbound population
  // values before an early return or recomputation; never infer an allele from a protein cache key.
  if (!verifiedCoordinate) {
    if (payload.gnomadFrequency != null || payload.aouFrequency != null || payload.conservationData?.aouFrequency != null) {
      payload.gnomadFrequency = null;
      payload.aouFrequency = null;
      payload.aouLookup = null;
      if (payload.conservationData) payload.conservationData.aouFrequency = null;
      didHeal = true;
    }
  }
  const hasTimeouts = Object.values(status).includes("timeout");
  const missingSplice = !payload.conservationData?.spliceai;

  if (!hasTimeouts && !missingSplice && !didHeal) {
    return payload;
  }

  const db = AnalysisDatabase.getInstance();
  const gnomadVarId = verifiedCoordinate ? payload.predictorData.gnomadVariantId : "";
  const genosCache = db.getExternalCache<any>(
    buildGenosKey(context.gene, context.variant, gnomadVarId || undefined)
  );
  const clinvarCache = db.getExternalCache<ClinVarData>(
    buildClinvarKey(context.gene, context.variant, context.originalNotation)
  );

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
      // Genos records carry no verified nucleotide identity, even when a cache key contains one.
      // Keep existing exact-local AoU evidence only; never heal counts from this protein row.
      aouFrequency: payload.conservationData?.aouFrequency ?? null
    };
    /**
     * Heal the LIFECYCLE with the values. A salvaged composite carries `modelStatus`; the Genos row
     * answers the dbNSFP ensemble, PopEVE and SpliceAI only, so those entries settle when the row
     * supplied them and every other model keeps its `timeout`. The composite is "ok" only when no
     * model is still unanswered — otherwise values would sit beside a lifecycle that contradicts them
     * and the ACMG engine could not tell the ensemble is still incomplete.
     */
    const healedStatus = payload.conservationData?.modelStatus as Record<string, string> | undefined;
    if (healedStatus) {
      healedStatus.base = "settled";
      if (g.popeve != null) healedStatus.popeve = "settled";
      if (g.spliceai) healedStatus.spliceai = "settled";
      if (Object.values(healedStatus).every(state => state === "settled")) delete payload.conservationData.modelStatus;
    }
    if (payload.serviceStatus && !payload.conservationData?.modelStatus) payload.serviceStatus.conservationData = "ok";
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

  // Constraint is served by the pinned local snapshot. A gene-only cached object cannot heal
  // a transcript/coordinate-specific regional result; retry the analysis instead.

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
      /**
       * The predictor cache key carries the coordinate dimension (review H2), and the coordinate it
       * carries is the one the PRODUCER used — which, for a verified lift, is the canonical pair,
       * not the submitted one. This assembled `{...parsed(submitted), assembly: context.assembly}`
       * by hand, so a lifted request healed against a key nobody had written: the panel stayed blank
       * while the cache held the data. Worse, a stale entry under the submitted-pair key (written by
       * an older client) could heal a canonical-trail payload with GRCh37-tagged predictor data —
       * the two-build contradiction the whole assembly gate exists to prevent.
       *
       * `predictorCoordinateFromContext` is the one place that pairs a coordinate with its build,
       * so the healer now agrees with the producer by construction rather than by imitation.
       */
      buildPredictorsKey(context.gene, context.variant, context.uniprotId,
        predictorCoordinateFromContext(context))
    );
    if (predictorCache?.data && isUsablePredictorResult(predictorCache.data, context.variant, requestedCoordinate, context.gene)) {
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

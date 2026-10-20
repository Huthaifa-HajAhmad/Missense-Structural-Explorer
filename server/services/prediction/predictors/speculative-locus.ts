/**
 * speculative-locus.ts — start the locus-dependent sources before Ensembl VEP answers, without ever
 * changing what they return.
 *
 * WHY
 * ---
 * gnomAD constraint, the local population lookup, gnomAD frequency and the conservation enrichment
 * wait for `predictorData` only to learn the LOCUS: the transcript, the verified GRCh38 coordinate and
 * how that coordinate was established. On a verified-coordinate input the platform asks Ensembl VEP's
 * region endpoint for it (median 1.2 s, p95 8 s, measured), so `predictorData → conservationData` was
 * the critical path of 58 % of analyses.
 *
 * The local dbNSFP store already knows that locus. Measured on the 21-variant panel, its MANE row
 * names the same transcript as VEP's chosen consequence in 21/21 and the same coordinate by
 * construction; its CADD matched 21/21. Its AlphaMissense did NOT always match VEP's plugin (5/21
 * differ, TTN has none), so the store is NOT used for scores here: `predictorData` itself still
 * comes from VEP, unchanged.
 *
 * HOW IT STAYS EQUIVALENT
 * -----------------------
 * The dependents run on {@link speculativeCoordinateLocus} as soon as it resolves. When VEP's answer
 * arrives, {@link locusInputs} of the two are compared — every field a dependent reads, including the
 * gates derived from them. Equal: the early result IS the result the dependent would have computed.
 * Different (VEP failed, chose another transcript, a fallback answered...): the dependent is run again
 * on VEP's answer and the early result is discarded. So a payload never mixes two loci.
 *
 * MODE (`PREDICTOR_SPECULATIVE_LOCUS`)
 *   shadow (default)  the locus is computed (one indexed store read, ~5 ms) and compared with VEP's
 *                     answer, and the outcome is recorded (`would-keep` / `would-discard` in the
 *                     CORE_DATA_FETCH_COMPLETED event), but every dependent still waits for VEP.
 *   on                the dependents start on the speculative locus (equivalence as above).
 *   off               nothing is computed.
 * Why `shadow` is the default: in the measured A/B (2026-10-19, fan-out replay, 132 units) a VEP failure
 * discards the speculation and re-runs every dependent, doubling their remote calls exactly when
 * Ensembl is struggling, and with speculation on Ensembl timeouts leaned toward the new build (13 vs 6;
 * 9 vs 9 without it; p ≈ 0.08). The production keep-rate and failure rate decide whether to turn it on.
 */
import type { PredictorData } from "../../../../src/shared/contracts.ts";
import type { AssemblyTaggedCoordinate } from "../../../../src/shared/assembly.ts";
import { LOCUS_POLICY_VERSION, locusFailureKind, locusRecoveryAction } from "../../../../src/shared/locusResolution.ts";
import { queryLocalDbnsfpCoordinateReading } from "../dbnsfp_local.ts";
import { liftCoordinateToCanonical } from "../../translation/liftover.ts";
import { getTranscriptsForProtein } from "./transcript-resolver.ts";
import { normalizeGeneSymbol } from "../../infra/http-client.ts";
import { toSingleAa } from "./normalizer.ts";
import { verifiedPopulationCoordinate } from "./allele-identity.ts";

export type SpeculativeLocusMode = "off" | "shadow" | "on";

export function speculativeLocusMode(): SpeculativeLocusMode {
  const flag = process.env.PREDICTOR_SPECULATIVE_LOCUS?.trim().toLowerCase();
  if (flag === "off" || flag === "false" || flag === "0") return "off";
  if (flag === "on" || flag === "true" || flag === "1") return "on";
  return "shadow";
}

/**
 * The locus `fetchPredictorData` would report on a successful coordinate-first VEP answer, read from
 * the local store. Null unless every condition for that equivalence holds: a GRCh38 coordinate that
 * lifts, a store row for the exact allele that is the gene's MANE-numbered reading, and the requested
 * gene, substitution and residue.
 *
 * Only the locus fields are set. The object is never surfaced: it feeds the dependents and is
 * superseded by VEP's answer (see the module note). The caller decides whether the store is usable
 * (it already asks once per run) and calls this only when it is.
 */
export async function speculativeCoordinateLocus(
  gene: string,
  variant: string,
  uniprotId: string | undefined,
  coord: AssemblyTaggedCoordinate | null | undefined
): Promise<PredictorData | null> {
  if (speculativeLocusMode() === "off" || !coord || coord.assembly !== "GRCh38") return null;
  const aa = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
  if (!aa) return null;
  const want = { gene: normalizeGeneSymbol(gene).trim().toUpperCase(), wt: toSingleAa(aa[1]), mut: toSingleAa(aa[3]), pos: parseInt(aa[2], 10) };
  if (!want.wt || !want.mut) return null;

  const lifted = await liftCoordinateToCanonical(coord).catch(() => null);
  if (!lifted) return null;
  const reading = await queryLocalDbnsfpCoordinateReading(lifted.chrom, lifted.pos, lifted.ref, lifted.alt, want.gene).catch(() => null);
  if (!reading || reading.basis !== "mane") return null;
  const row = reading.record as typeof reading.record & { aaref?: string | null; aaalt?: string | null; transcript?: string | null };
  if (!row.transcript || String(row.gene).trim().toUpperCase() !== want.gene) return null;
  if (row.aaref?.toUpperCase() !== want.wt.toUpperCase() || row.aaalt?.toUpperCase() !== want.mut.toUpperCase() || row.pos !== want.pos) return null;

  // The same lookup, and the same field, fetchPredictorData uses for canonicalEnsemblId.
  let canonicalEnsemblId: string | null = null;
  if (uniprotId) {
    try {
      canonicalEnsemblId = (await getTranscriptsForProtein(uniprotId)).canonicalEnsemblId ?? null;
    } catch {
      canonicalEnsemblId = null;
    }
  }
  const chrom = lifted.chrom.replace(/^chr/i, "");
  return {
    available: true,
    amPathogenicity: null,
    amClass: null,
    caddPhred: null,
    gnomadVariantId: `${chrom}-${lifted.pos}-${lifted.ref}-${lifted.alt}`,
    gnomadVariantAssembly: "GRCh38",
    transcriptId: row.transcript,
    canonicalEnsemblId,
    isManeSelect: true,
    isManePlusClinical: false,
    isCanonical: false,
    source: "speculative locus (local store; superseded by Ensembl VEP)",
    locusResolution: {
      route: "vep-coordinate",
      canonicalBy: "vep",
      retryable: false,
      policyVersion: LOCUS_POLICY_VERSION,
      steps: [],
    },
  } as PredictorData;
}

/**
 * Everything a locus-dependent source reads from `predictorData`, and the gates derived from it.
 * Two answers with equal inputs make every dependent compute the same thing.
 */
export function locusInputs(pred: PredictorData | null | undefined): string {
  const trail = pred?.locusResolution;
  return JSON.stringify({
    transcriptId: pred?.transcriptId ?? null,
    canonicalEnsemblId: pred?.canonicalEnsemblId ?? null,
    gnomadVariantId: pred?.gnomadVariantId ?? null,
    gnomadVariantAssembly: pred?.gnomadVariantAssembly ?? null,
    populationCoordinate: verifiedPopulationCoordinate(pred),
    sourceIsFallback: /Fallback|MyVariant|dbNSFP/i.test(pred?.source ?? ""),
    route: trail?.route ?? null,
    canonicalBy: trail?.canonicalBy ?? null,
    retryable: trail?.retryable ?? null,
    failureKind: trail?.failureKind ?? null,
    policyVersion: trail?.policyVersion ?? null,
    locusFailureKind: locusFailureKind({ predictorData: pred ?? undefined } as any),
    locusRecoveryAction: locusRecoveryAction({ predictorData: pred ?? undefined } as any),
  });
}

export type LocusSpeculation = "none" | "kept" | "discarded" | "would-keep" | "would-discard";

/**
 * Runs `run` on the speculative locus when there is one, keeps its result only when VEP's answer has the
 * same {@link locusInputs}, and otherwise runs it again on VEP's answer.
 *
 * `run` receives a PROMISE of the locus, so work inside it that does not need the locus (conservation's
 * protein-keyed sources) still starts at once. Without a speculative locus that promise IS
 * `predictorPromise`, exactly as before.
 */
export function makeLocusRunner(
  speculative: Promise<PredictorData | null>,
  predictorPromise: Promise<PredictorData | null>,
  /** false = shadow: compare and record, but every dependent runs on `predictorPromise` as before. */
  apply = true
) {
  const locus = apply ? speculative.then(spec => spec ?? predictorPromise) : predictorPromise;
  let outcome: LocusSpeculation = "none";
  const decided = speculative.then(async spec => {
    if (!spec) return { spec: null, same: false };
    const real = await predictorPromise.catch(() => null);
    const same = locusInputs(spec) === locusInputs(real);
    outcome = apply ? (same ? "kept" : "discarded") : (same ? "would-keep" : "would-discard");
    return { spec, same };
  });
  return {
    run<R>(fn: (locus: Promise<PredictorData | null>) => Promise<R>): Promise<R> {
      if (!apply) return fn(predictorPromise);
      const early = fn(locus);
      return decided.then(({ spec, same }) => {
        if (!spec || same) return early;
        early.catch(() => {});
        return fn(predictorPromise);
      });
    },
    outcome: () => outcome,
    decided: () => decided.then(() => outcome),
  };
}

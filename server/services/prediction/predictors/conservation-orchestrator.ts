import { conservationCache, getCachedOrFetch } from "../../infra/cache.ts";
import { resolveSpliceProximity } from "../splice_resolver.ts";
import { buildConservationKey } from "../../infra/cache-keys.ts";
import { firstDbnsfpAnswer } from "./dbnsfp-sources.ts";
import { NO_DBNSFP_SCORES } from "./dbnsfp-scores.ts";
import { fetchProtVarConservation } from "../../external-api/protvar-conservation.ts";
import { fetchPopEVEScore, fetchPopEVEScoreOnline } from "./popeve-resolver.ts";
import { fetchAlphaGenome } from "../../external-api/alphagenome-bridge.ts";
import { fetchSpliceAiBroadOutcome, SPLICEAI_DEFAULT_DISTANCE, type SpliceAiOutcome } from "../../external-api/spliceai_broad.ts";
import { sourceSupportsAssembly, describeAssemblyRefusal, ASSEMBLY_REFUSAL_SOURCES } from "../../../../src/shared/assembly.ts";
import { fallbackLocusSentence, locusFailureKind, locusRecoveryAction } from "../../../../src/shared/locusResolution.ts";
import type { GenomeAssembly } from "../../../../src/shared/variantNotation.ts";
import { type ConservationData, type AlphaGenomeAviData, parseGenomicCoordinateString } from "../../../../src/shared/contracts.ts";

/**
 * Overlays a live Broad SpliceAI score onto whatever the dbNSFP path produced.
 *
 * The precomputed `SpliceAI_pred_*` columns were generated against GENCODE v24 with a
 * 50 bp reporting window, so a variant absent from those tables yields null and the UI
 * reports "no score" for a variant SpliceAI does in fact score. A live result is
 * therefore preferred, and the frozen value is kept only when the live call misses.
 *
 * `provenance` is always stamped, so a reader can tell which window and annotation the
 * number came from — the two sources legitimately disagree on borderline variants.
 */
/**
 * The payload fields a live SpliceAI outcome contributes: the score with its provenance, or the
 * reason there is none. Shared by the analysis and by the splicing tab's own re-score, so a score
 * re-fetched under another window is shaped exactly like the one the analysis would have carried.
 */
export function liveSpliceAiFields(outcome: SpliceAiOutcome | null): Pick<ConservationData, "spliceai" | "spliceaiFailure"> | null {
  const live = outcome?.record ?? null;
  if (!live) return outcome?.failure ? { spliceaiFailure: outcome.failure } : null;
  return {
    spliceai: {
      ds_ag: live.ds_ag,
      ds_al: live.ds_al,
      ds_dg: live.ds_dg,
      ds_dl: live.ds_dl,
      max_ds: live.max_ds,
      dp: live.dp,
      provenance: {
        source: "broad-lookup",
        distanceBp: live.distance,
        masked: live.mask,
        computedLive: live.computedLive,
        annotationSet: live.isManeSelect ? "MANE Select" : null,
        // The service's own transcript record: the displayed geometry transcript and the
        // annotation the predictions were scored against can legitimately differ.
        transcriptId: live.transcriptId,
      },
    },
    spliceaiFailure: null,
  };
}

function applyLiveSpliceAi<T extends ConservationData>(
  data: T,
  outcome: SpliceAiOutcome | null
): T {
  // With no live score the frozen value stays, and the failure (if any) says why the live request missed.
  const fields = liveSpliceAiFields(outcome);
  return fields ? { ...data, ...fields } : data;
}

/**
 * Fetches a live SpliceAI score for resolved genomic coordinates. Never throws: an
 * unreachable academic endpoint degrades to the existing precomputed sources rather than
 * failing the analysis.
 */
/**
 * ProtVar's residue conservation (ScoreCons, 0 to 1) for the composite. A failed request is logged
 * and shown as no score; it never fails the rest of the conservation data.
 */
function fetchScoreCons(uniprotId: string, position: number): Promise<number | null> {
  return fetchProtVarConservation(uniprotId, position).catch((err: Error) => {
    console.warn(`[ProtVar Conservation] ${uniprotId} ${position}: ${err.message}`);
    return null;
  });
}

export async function fetchLiveSpliceAiIfPossible(
  chrom: string,
  pos: number,
  ref: string,
  alt: string,
  /**
   * Build of the COORDINATE being sent, or null when unknown. Null refuses: an untagged
   * coordinate cannot be routed, because a wrong-build request is not merely a miss — the
   * service validates REF, and when the other build's base at that numeric position coincides
   * it returns plausible scores for a different locus.
   */
  coordinateAssembly: GenomeAssembly | null,
  distance: number = SPLICEAI_DEFAULT_DISTANCE
): Promise<SpliceAiOutcome | null> {
  // SpliceAI Lookup runs a separate service per build, so a known build is routed rather
  // than rejected — GRCh37 coordinates legitimately go to the spliceai-37 service.
  if (coordinateAssembly === null) return null;
  if (!sourceSupportsAssembly("spliceai-lookup", coordinateAssembly)) return null;
  return fetchSpliceAiBroadOutcome(chrom, pos, ref, alt, {
    distance,
    assembly: coordinateAssembly,
  });
}

export { myVariantResponseSchema } from "./myvariant-dbnsfp.ts";

export async function fetchConservationData(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  uniprotId?: string | null,
  transcriptId?: string | null,
  genomicPos?: number | null,
  /**
   * Build that `gnomadVariantId`'s coordinates belong to, when known.
   *
   * Participates in the cache key because this payload folds in single-build sources
   * (local dbNSFP, dbnsfp.org, PopEVE, gnomAD r4), so a payload built from one build's
   * coordinate is not a valid answer for another's. Absent means "unknown", which is a distinct
   * key rather than a default.
   */
  assembly?: string | null,
  options?: {
    /**
     * The caller fetches the coordinate-keyed enrichment itself (PopEVE tabix, AlphaGenome)
     * and overlays it — `fetchConservationDataProgressive` does, with the reader's own AlphaGenome
     * key. Skipping it here stops the same remote, quota-bound calls being made twice per run, the
     * second time without that key.
     */
    coordinateEnrichmentByCaller?: boolean;
  }
): Promise<ConservationData> {
  const cacheKey = buildConservationKey(gene, variant, pdbId, chainId, pos, gnomadVariantId, assembly);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Predictor Ensemble",
    l1Cache: conservationCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    shouldCache: (res) => res.available === true,
    fetcher: async () => {
      const resolvedPos = pos ?? (variant.match(/\d+/) ? parseInt(variant.match(/\d+/)![0], 10) : null);
      const usableBy = (source: Parameters<typeof sourceSupportsAssembly>[0]) =>
        assembly !== null && assembly !== undefined && sourceSupportsAssembly(source, assembly as GenomeAssembly);
      const coordinate = parseGenomicCoordinateString(gnomadVariantId);
      const spliceProximity = await directSpliceProximity(transcriptId, genomicPos, coordinate, usableBy);

      /**
       * NOTE: live SpliceAI is deliberately NOT fetched here. It is fetched once in
       * `fetchConservationDataProgressive` — which has the parsed coordinate and its build — and
       * overlaid on the merged result there, so every provider path benefits from one request.
       */
      const enrich = !options?.coordinateEnrichmentByCaller;
      const [answer, enrichment] = await Promise.all([
        firstDbnsfpAnswer({
          gene,
          variant,
          resolvedPos,
          // dbnsfp.org and the local store index GRCh38 only: another build keeps the protein query.
          grch38AlleleId: coordinate && assembly === "GRCh38" ? gnomadVariantId! : null,
        }),
        enrich ? directEnrichment(coordinate, uniprotId ?? null, resolvedPos, usableBy) : null,
      ]);

      // AlphaGenome is quota-bound, so it is asked only for a variant some dbNSFP source knows.
      const alphagenome = enrich && answer && coordinate && usableBy("alphagenome")
        ? await fetchAlphaGenome(coordinate.chrom, coordinate.pos, coordinate.ref, coordinate.alt, {
            // The build reaches the cache key, as on the progressive path.
            assembly: assembly ?? undefined
          }).catch(() => null) as AlphaGenomeAviData | null
        : null;

      let popeve = answer?.scores.popeve ?? enrichment?.popEVEFromCoordinate ?? null;
      if (popeve === null && enrich) {
        const online = fetchPopEVEScoreOnline(uniprotId || gene, variant);
        popeve = await Promise.race([online, new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))]);
      }
      const scores = answer?.scores ?? NO_DBNSFP_SCORES;
      return {
        available: answer !== null,
        ...scores,
        revelProvenance: answer && scores.revel !== null ? answer.revelProvenance : undefined,
        scorecons: enrichment?.scorecons ?? null,
        popeve,
        spliceProximity,
        alphagenome,
        ...(answer ? { source: answer.source } : {}),
      };
    }
  });
}

type UsableBy = (source: Parameters<typeof sourceSupportsAssembly>[0]) => boolean;
type ParsedCoordinate = ReturnType<typeof parseGenomicCoordinateString>;

/**
 * Splice-site distance for a direct call. The exon model is GRCh38 (rest.ensembl.org lookup), so a
 * position from another build is never measured against it, and the position must BE the tagged
 * id's locus: an unrelated `genomicPos` beside a tagged id gets no geometry.
 */
async function directSpliceProximity(
  transcriptId: string | null | undefined,
  genomicPos: number | null | undefined,
  coordinate: ParsedCoordinate,
  usableBy: UsableBy
): Promise<ConservationData["spliceProximity"]> {
  if (!transcriptId || genomicPos == null || !usableBy("splice-proximity")) return null;
  if (coordinate === null || coordinate.pos !== genomicPos) return null;
  return resolveSpliceProximity(transcriptId, genomicPos, coordinate.chrom);
}

/**
 * What a direct call fetches itself, since no progressive caller does it: ProtVar residue
 * conservation (keyed on the protein) and the GRCh38-only PopEVE score.
 */
async function directEnrichment(
  coordinate: ParsedCoordinate,
  uniprotId: string | null,
  resolvedPos: number | null,
  usableBy: UsableBy
) {
  const [scorecons, popEVEFromCoordinate] = await Promise.all([
    uniprotId && resolvedPos !== null ? fetchScoreCons(uniprotId, resolvedPos) : null,
    coordinate && usableBy("popEVE")
      ? fetchPopEVEScore(coordinate.chrom, coordinate.pos, coordinate.ref, coordinate.alt).catch(() => null)
      : null,
  ]);
  return { scorecons, popEVEFromCoordinate };
}

export interface ProgressiveConservationContext {
  gene: string;
  variant: string;
  pos?: number | null;
  uniprotId?: string | null;
  /**
   * Build the caller's notation was expressed in. Every coordinate-consuming source in
   * this pipeline is single-build (local dbNSFP, dbnsfp.org, gnomAD r4
   * ids) or has a service per build (SpliceAI Lookup), so this decides routing — a
   * GRCh37 coordinate handed to a GRCh38 index either misses or, worse, resolves to a
   * different locus. Defaults to GRCh38, which is what every source here is pinned to.
   */
  assembly?: GenomeAssembly;
  predictorPromise?: Promise<any>;
  alphagenomeApiKey?: string | null;
  alphagenomeApiUrl?: string | null;
  /** SpliceAI reporting window (-D); defaults to `SPLICEAI_DEFAULT_DISTANCE`. */
  spliceaiDistance?: number | null;
  /**
   * Called with a cumulative snapshot each time one model inside the composite settles, so a fast
   * SpliceAI or AlphaGenome answer is not held back behind dbNSFP or ProtVar. Each snapshot
   * carries `modelStatus`; a model that has not settled contributes NO value (not even a fallback
   * that its own answer might replace), so a snapshot never shows a number the final payload
   * contradicts. Not called for the final value, which is the function's return.
   */
  onPartial?: (snapshot: ConservationData) => void;
}


type ConservationModelStatus = NonNullable<ConservationData["modelStatus"]>;

/** What the predictor's locus decided: the coordinate, its build gate and the recorded refusals. */
interface ConservationLocus {
  pred: any;
  parsedCoord: ReturnType<typeof parseGenomicCoordinateString>;
  coordinateAssembly: GenomeAssembly | null;
  usableBy: (source: Parameters<typeof sourceSupportsAssembly>[0]) => boolean;
  assemblyRefusals: NonNullable<ConservationData["assemblyRefusals"]>;
}

/**
 * The composite's models as they have settled so far. A key that is ABSENT has not settled; a key
 * holding null settled with nothing. That distinction is the whole point of the snapshots.
 */
export interface ConservationParts {
  base?: ConservationData;
  scorecons?: number | null;
  locus?: ConservationLocus | null;
  popeve?: number | null;
  alphagenome?: AlphaGenomeAviData | null;
  liveSpliceAi?: SpliceAiOutcome | null;
  spliceProximity?: any;
}

const settledPart = (parts: ConservationParts, key: keyof ConservationParts) =>
  Object.prototype.hasOwnProperty.call(parts, key);

/** Base fields while dbNSFP / MyVariant has not answered: not assessed, so all null. */
const UNSETTLED_BASE: ConservationData = {
  available: false,
  revel: null,
  gerp: null,
  phylop: null,
  scorecons: null,
  bayesdel: null,
  esm1b: null,
  esm1bPred: null,
  popeve: null,
  aouFrequency: null,
  spliceProximity: null,
  spliceai: null,
  alphagenome: null
};

/**
 * Which models have settled ENOUGH that their displayed value is final.
 *
 * Each field is "primary ?? fallback". It is final once the primary answered with a value, or once
 * both answered. Until then a snapshot shows nothing for it, even when the fallback is already in
 * hand, because the primary's later answer would replace that number — a frozen dbNSFP SpliceAI
 * score swapping to a different live one is a contradiction, not progress.
 */
function conservationModelStatus(parts: ConservationParts): ConservationModelStatus {
  const has = (k: keyof ConservationParts) => settledPart(parts, k);
  const base = has("base");
  const state = (done: boolean): "pending" | "settled" => (done ? "settled" : "pending");
  return {
    base: state(base),
    /**
     * ProtVar conservation, splice geometry and AlphaGenome have no base fallback on this path: the
     * base fetch is called without a transcript and with `coordinateEnrichmentByCaller`, so its
     * values for these three are always null. Each is final the moment its own request settles.
     */
    scorecons: state(has("scorecons")),
    spliceProximity: state(has("spliceProximity")),
    alphagenome: state(has("alphagenome")),
    // A returned protein-file score can be shown before the base lookup finishes.
    // An absent score still waits for the base before it is called settled.
    popeve: state(parts.popeve != null || (base && (parts.base!.popeve != null || has("popeve")))),
    spliceai: state(has("liveSpliceAi") && (Boolean(parts.liveSpliceAi?.record) || base))
  };
}

/** The merged payload from whatever has settled. With every part settled this IS the final value. */
function mergeConservationParts(parts: ConservationParts): ConservationData {
  const baseConservation = parts.base ?? UNSETTLED_BASE;
  const assemblyRefusals = parts.locus?.assemblyRefusals ?? null;

  return applyLiveSpliceAi({
    ...baseConservation,
    scorecons: parts.scorecons ?? baseConservation.scorecons ?? null,
    popeve: baseConservation.popeve ?? parts.popeve ?? null,
    spliceProximity: parts.spliceProximity ?? baseConservation.spliceProximity,
    assemblyRefusals: assemblyRefusals && assemblyRefusals.length > 0
      ? assemblyRefusals
      : baseConservation.assemblyRefusals ?? null,
    alphagenome: parts.alphagenome ?? baseConservation.alphagenome ?? null
  }, parts.liveSpliceAi ?? null);
}

/**
 * A snapshot of the composite as of now: settled models carry their final value, unsettled ones
 * carry none, and `modelStatus` says which is which. A snapshot kept after a budget expiry is
 * relabelled by `expireConservationSnapshot`.
 */
export function conservationSnapshot(parts: ConservationParts): ConservationData {
  const merged: ConservationData = { ...mergeConservationParts(parts) };
  const status = conservationModelStatus(parts);
  if (status.scorecons !== "settled") merged.scorecons = null;
  if (status.popeve !== "settled") merged.popeve = null;
  if (status.spliceProximity !== "settled") merged.spliceProximity = null;
  if (status.alphagenome !== "settled") merged.alphagenome = null;
  if (status.spliceai !== "settled") {
    merged.spliceai = null;
    merged.spliceaiFailure = null;
  }
  if (!settledPart(parts, "locus")) merged.assemblyRefusals = null;
  return { ...merged, modelStatus: status };
}

/** True when a snapshot has no unsettled model, i.e. it would equal the final value. */
export function conservationFullySettled(snapshot: ConservationData | null | undefined): boolean {
  const status = snapshot?.modelStatus;
  return !status || Object.values(status).every(v => v === "settled");
}

/** Re-labels a streamed snapshot's unsettled models as timed out, for a composite whose budget expired. */
export function expireConservationSnapshot(snapshot: ConservationData): ConservationData {
  const status = snapshot.modelStatus ?? {};
  return {
    ...snapshot,
    modelStatus: Object.fromEntries(
      Object.entries(status).map(([k, v]) => [k, v === "pending" ? "timeout" : v])
    ) as ConservationModelStatus
  };
}

export async function fetchConservationDataProgressive(
  context: ProgressiveConservationContext
): Promise<ConservationData> {
  const {
    gene,
    variant,
    pos,
    uniprotId,
    predictorPromise,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    spliceaiDistance,
    onPartial
  } = context;

  /**
   * NOTE: the build decision does NOT come from `context.assembly`.
   *
   * `context.assembly` is the build the user's *notation* declared, which is not the build of the
   * coordinate actually sent: the coordinate comes from predictor metadata whose producers
   * disagree (Ensembl VEP queries the GRCh38 host; the MyVariant `_id` is hg19). The gate below
   * therefore keys on the coordinate's own build (`pred.gnomadVariantAssembly`). The request field
   * is retained for other consumers; do not reintroduce it as the gate's input.
   */

  const resolvedPos = (pos !== undefined && pos !== null)
    ? pos
    : (() => {
        const match = variant.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
      })();

  /**
   * Every model below settles on its own and is recorded the moment it does. They used to be joined
   * by one `Promise.all` (and the coordinate models by a second), so a SpliceAI answer in 2 s waited
   * for the slowest of dbNSFP, ProtVar and AlphaGenome before anyone saw it.
   */
  const parts: ConservationParts = {};
  let finished = false;
  const settle = <K extends keyof ConservationParts>(key: K, value: ConservationParts[K]) => {
    parts[key] = value;
    if (finished || !onPartial) return;
    const snapshot = conservationSnapshot(parts);
    // The fully settled value is the return, not a preview of it.
    if (conservationFullySettled(snapshot)) return;
    try { onPartial(snapshot); } catch { /* a progress listener must not fail the composite */ }
  };
  const track = <K extends keyof ConservationParts, V extends ConservationParts[K]>(key: K, task: Promise<V>): Promise<V> =>
    task.then(value => { settle(key, value); return value; });

  // 1. ProtVar residue conservation, at once: it needs only the accession and the residue.
  const scoreconsTask = track("scorecons", uniprotId && resolvedPos !== null
    ? fetchScoreCons(uniprotId, resolvedPos)
    : Promise.resolve(null));

  // 2. The coordinate, its build gate and the recorded refusals, once the predictor resolves.
  const predictorTask: Promise<any> = (predictorPromise || Promise.resolve(null)).catch(() => null);
  const locusTask: Promise<ConservationLocus | null> = track("locus", predictorTask.then((pred): ConservationLocus => {
    const assemblyRefusals: NonNullable<ConservationData["assemblyRefusals"]> = [];
    const parsedCoord = parseGenomicCoordinateString(pred?.gnomadVariantId) || parseGenomicCoordinateString(variant);
    /**
     * Build gate — keyed on the COORDINATE's build, not the request's.
     *
     * An earlier version of this gate compared `assembly` (the build the user's *notation*
     * declared) against each source's support. That answers the wrong question: the
     * coordinate comes from the predictor metadata, whose producers disagree — the Ensembl
     * VEP path queries the GRCh38 host, while the MyVariant.info fallback parses an hg19
     * `_id`. A GRCh37-annotated request therefore routed a GRCh38 coordinate to the GRCh37
     * service, and an unannotated request handed an hg19 coordinate to GRCh38-only sources.
     *
     * `coordinateAssembly` is the build the coordinate itself was derived under, carried by
     * the producer. It is null when unknown, and null REFUSES: an inferred build is
     * indistinguishable from a verified one, which is precisely how a wrong-locus score
     * slipped through before. Skipping a source reads as "not assessed", which is true.
     */
    const coordinateAssembly: GenomeAssembly | null = pred?.gnomadVariantAssembly ?? null;
    const usableBy = (source: Parameters<typeof sourceSupportsAssembly>[0]) =>
      coordinateAssembly !== null && sourceSupportsAssembly(source, coordinateAssembly);

    /**
     * Record WHY each skipped source was skipped (unmapping defect F-13).
     *
     * The refusal is correct; the silence was not. Without a reason on the payload, every
     * surface that renders a blank invents one — "Awaiting API key", "Outside Consensus
     * Zone", "Transcript coordinates mapped" — and the panel contradicts itself. The reasons
     * travel as data; no fabricated status objects, so "never asked" stays distinguishable
     * from "asked and unavailable".
     *
     * A refusal is recorded only for a source that was actually reachable-but-for-the-build
     * (review L-9): claiming "not scored because GRCh37" for splice-proximity when no
     * transcript exists, or for AlphaGenome when none is configured, states a sufficient
     * cause that is not the operative one and misdirects whoever reads it.
     *
     * A FALLBACK locus (the GRCh38 lookup failed on this run) is not the user's build choice, and
     * must not be worded or classified as one: the refusal says the lookup failed and carries
     * `retryable`, so surfaces offer a re-run instead of "Not covered — nothing anyone can do".
     */
    const trail = pred?.locusResolution ?? null;
    const fallbackLocus = trail?.route === "fallback" && trail.canonicalBy === null;
    const failureKind = locusFailureKind({ predictorData: pred });
    const recoveryAction = locusRecoveryAction({ predictorData: pred });

    for (const src of parsedCoord || fallbackLocus ? ASSEMBLY_REFUSAL_SOURCES : []) {
      const reachable = src === "splice-proximity"
        ? Boolean(pred?.canonicalEnsemblId || pred?.transcriptId)
        : src === "alphagenome"
        ? Boolean(alphagenomeApiKey || alphagenomeApiUrl)
        : true;
      if (!reachable) continue;
      if (fallbackLocus && (coordinateAssembly === null || !sourceSupportsAssembly(src, coordinateAssembly))) {
        assemblyRefusals.push({
          source: src,
          reason: fallbackLocusSentence(src, coordinateAssembly, {
            retryable: recoveryAction === "retry",
            failureKind,
          }),
          retryable: recoveryAction === "retry",
          failureKind: failureKind ?? undefined,
          inputRequired: recoveryAction === "provide-allele",
        });
      } else if (coordinateAssembly === null) {
        assemblyRefusals.push({
          source: src,
          reason: `${src} was not scored: the coordinate's genome build was not declared.`
        });
      } else if (!sourceSupportsAssembly(src, coordinateAssembly)) {
        assemblyRefusals.push({ source: src, reason: describeAssemblyRefusal(src, coordinateAssembly) });
      }
    }
    return { pred, parsedCoord, coordinateAssembly, usableBy, assemblyRefusals };
  }).catch(() => null));

  type CoordinateLocus = ConservationLocus & { parsedCoord: NonNullable<ConservationLocus["parsedCoord"]> };
  /** One coordinate-keyed model: null without a coordinate, and never a rejection. */
  const coordinateModel = <T,>(fn: (locus: CoordinateLocus) => Promise<T | null> | null): Promise<T | null> =>
    locusTask
      .then(locus => (locus?.parsedCoord ? fn(locus as CoordinateLocus) : null))
      .then(value => value ?? null)
      .catch(() => null);

  // 3. The coordinate models, each published as it answers.
  // PopEVE matches chrom/pos/ref/alt against a GRCh38-only index (`popeve_grch38.vcf.gz`).
  // The protein file needs no genomic lookup. Start it now so a slow predictor cannot
  // use the analysis time budget before popEVE is even requested (GATA4 S159C).
  const popeveTask = track("popeve", fetchPopEVEScoreOnline(uniprotId || gene, variant)
    .then(score => score ?? coordinateModel(({ parsedCoord: c, usableBy }) =>
      usableBy("popEVE") ? fetchPopEVEScore(c.chrom, c.pos, c.ref, c.alt) : null))
    .catch(() => null));
  // AlphaGenome is GRCh38-only: the Atlas holds GRCh38 SNVs and the model is GRCh38.
  const alphagenomeTask = track("alphagenome", coordinateModel(({ parsedCoord: c, usableBy, coordinateAssembly }) =>
    usableBy("alphagenome")
      ? fetchAlphaGenome(c.chrom, c.pos, c.ref, c.alt, {
          apiKey: alphagenomeApiKey,
          apiUrl: alphagenomeApiUrl,
          // The build reaches the cache key so a GRCh38 entry is never served for another
          // build's coordinate at the same numeric position.
          assembly: coordinateAssembly
        })
      : null));
  // Live SpliceAI runs a service per build, so it routes on the COORDINATE's build rather than the
  // request's. A caller abort makes the client throw; catching it per model keeps that abort from
  // nulling PopEVE and AlphaGenome.
  const liveSpliceAiTask = track("liveSpliceAi", coordinateModel(({ parsedCoord: c, coordinateAssembly }) =>
    fetchLiveSpliceAiIfPossible(
      c.chrom, c.pos, c.ref, c.alt, coordinateAssembly,
      spliceaiDistance ?? SPLICEAI_DEFAULT_DISTANCE
    )));
  /**
   * Splice-junction geometry is resolved against GRCh38 Ensembl exon boundaries.
   *
   * The transcript ids in this pipeline come from Ensembl's GRCh38 host, so the exon model
   * is GRCh38 and comparing a GRCh37 position against it yields a wrong distance, a wrong
   * region type and a wrong canonical-junction verdict — all rendered as measured geometry
   * ("N bp from junction", "Exon 3 of 12"). `splice-proximity` was declared GRCh38-only but
   * nothing enforced it, so this was reachable with an hg19 coordinate.
   *
   * The geometry model is the CANONICAL transcript when the producer named one (F-16): the
   * platform numbers the variant on the canonical isoform, so "Exon N of M" must describe
   * the canonical exon structure, not the MANE model's. And the contig travels with the
   * position (F-6): a coordinate on another chromosome is refused by the resolver, not
   * measured against unrelated exons.
   */
  const spliceProximityTask = track("spliceProximity", coordinateModel(async ({ parsedCoord: c, usableBy, pred }) => {
    if (!(pred?.canonicalEnsemblId || pred?.transcriptId) || !usableBy("splice-proximity")) return null;
    const geometryTranscript = (pred.canonicalEnsemblId || pred.transcriptId)!;
    let proximity = await resolveSpliceProximity(geometryTranscript, c.pos, c.chrom).catch(() => null);
    if (!proximity && pred.canonicalEnsemblId && pred.transcriptId && pred.canonicalEnsemblId !== pred.transcriptId) {
      proximity = await resolveSpliceProximity(pred.transcriptId, c.pos, c.chrom).catch(() => null);
    }
    return proximity;
  }));

  // 4. Base conservation (local dbNSFP / dbnsfp.org / MyVariant).
  const baseTask = track("base", (async () => {
    /**
     * The base payload's cache key includes the coordinate's build.
     *
     * This payload folds in single-build sources (local dbNSFP, dbnsfp.org), so a result
     * assembled from one build's coordinates is not a valid answer for another's. The build lives
     * on the predictor metadata, so it is awaited here — the promise has already been started by
     * the caller, so this does not add a round trip, and the coordinate models above consume the
     * same promise rather than a second copy.
     *
     * A rejection is not fatal: a missing predictor means "no coordinate", and the base payload is
     * still assembled without one.
     */
    const predictorLocus = await predictorTask.then(pred => ({
      assembly: (pred?.gnomadVariantAssembly ?? null) as string | null,
      id: (pred?.gnomadVariantId ?? null) as string | null,
    }));
    const coordinateAssembly = predictorLocus.assembly;

    /**
     * The ALLELE the scores must belong to, when there is one these sources can read.
     *
     * REVEL, BayesDel and CADD are per nucleotide change, and a
     * protein change can be encoded by more than one (Q867H: CAA→CAC or CAT). Queried as
     * `GENE:p.…`, query.dbnsfp.org answers with whichever matching row comes first, so the
     * scores could describe a different allele from the one analysed. It and the local store are
     * GRCh38-only, so the coordinate is passed only when it IS GRCh38; any other build keeps the
     * protein query.
     */
    const alleleId =
      coordinateAssembly === "GRCh38" && parseGenomicCoordinateString(predictorLocus.id)
        ? predictorLocus.id
        : null;

    return fetchConservationData(
      gene,
      variant,
      null,
      null,
      pos,
      alleleId,
      uniprotId,
      null,
      null,
      coordinateAssembly,
      { coordinateEnrichmentByCaller: true }
    );
  })());

  try {
    // A base failure still fails the composite, as before; every coordinate model degrades to null.
    await Promise.all([baseTask, scoreconsTask, locusTask, popeveTask, alphagenomeTask, liveSpliceAiTask, spliceProximityTask]);
  } finally {
    finished = true;
  }
  return mergeConservationParts(parts);
}

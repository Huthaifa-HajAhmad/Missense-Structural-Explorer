import { z } from "zod";
import { conservationCache, getCachedOrFetch } from "../../infra/cache.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "../../infra/http-client.ts";
import { isLocalDbnsfpAvailable, queryLocalDbnsfpVariant } from "../dbnsfp_local.ts";
import { queryGenosWebservice } from "../../external-api/genos_web.ts";
import { resolveSpliceProximity } from "../splice_resolver.ts";
import { buildConservationKey } from "../../infra/cache-keys.ts";
import { fetchGpnStarScore, fetchGpnStarByCoordinate, type ModelInferenceResult as EvolutionaryScaleResult } from "../../external-api/gpn.ts";
import { safeParseFloat, safeParseInt, toSingleAa, getFirstOrVal } from "./normalizer.ts";
import { queryDbnsfpOrg } from "./dbnsfp-query.ts";
import { fetchRealConsurfData } from "./consurf-resolver.ts";
import { fetchPopEVEScore, fetchPopEVEScoreOnline } from "./popeve-resolver.ts";
import { fetchAlphaGenome } from "../../external-api/alphagenome-bridge.ts";
import { fetchSpliceAiBroad, SPLICEAI_DEFAULT_DISTANCE, type SpliceAiScoreRecord } from "../../external-api/spliceai_broad.ts";
import { CANONICAL_ASSEMBLY, sourceSupportsAssembly, describeAssemblyRefusal, ASSEMBLY_REFUSAL_SOURCES } from "../../../../src/shared/assembly.ts";
import type { GenomeAssembly } from "../../../../src/shared/variantNotation.ts";
import { type ConservationData, type AlphaGenomeAviData, parseGenomicCoordinateString } from "../../../../src/shared/contracts.ts";

/**
 * Overlays a live Broad SpliceAI score onto whatever the dbNSFP/Genos path produced.
 *
 * The precomputed `SpliceAI_pred_*` columns were generated against GENCODE v24 with a
 * 50 bp reporting window, so a variant absent from those tables yields null and the UI
 * reports "no score" for a variant SpliceAI does in fact score. A live result is
 * therefore preferred, and the frozen value is kept only when the live call misses.
 *
 * `provenance` is always stamped, so a reader can tell which window and annotation the
 * number came from — the two sources legitimately disagree on borderline variants.
 */
function applyLiveSpliceAi<T extends ConservationData>(
  data: T,
  live: SpliceAiScoreRecord | null
): T {
  if (!live) return data;
  return {
    ...data,
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
      },
    },
  };
}

/**
 * Fetches a live SpliceAI score for resolved genomic coordinates. Never throws: an
 * unreachable academic endpoint degrades to the existing precomputed sources rather than
 * failing the analysis.
 */
async function fetchLiveSpliceAiIfPossible(
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
  coordinateAssembly: GenomeAssembly | null
): Promise<SpliceAiScoreRecord | null> {
  // SpliceAI Lookup runs a separate service per build, so a known build is routed rather
  // than rejected — GRCh37 coordinates legitimately go to the spliceai-37 service.
  if (coordinateAssembly === null) return null;
  if (!sourceSupportsAssembly("spliceai-lookup", coordinateAssembly)) return null;
  return fetchSpliceAiBroad(chrom, pos, ref, alt, {
    distance: SPLICEAI_DEFAULT_DISTANCE,
    assembly: coordinateAssembly,
  });
}

export const myVariantResponseSchema = z.object({
  hits: z.array(z.object({
    dbnsfp: z.object({
      revel: z.any().optional(),
      gerp: z.any().optional(),
      "gerp++": z.any().optional(),
      phylop: z.any().optional(),
      bayesdel_noaf_score: z.any().optional(),
      bayesdel: z.any().optional(),
      hgvsp: z.any().optional(),
      metarnn: z.any().optional(),
      clinpred: z.any().optional(),
      eigen: z.any().optional(),
      dann: z.any().optional(),
      esm1b: z.any().optional(),
      eve: z.any().optional(),
      aou_ac: z.any().optional(),
      aou_an: z.any().optional(),
      aou_het: z.any().optional(),
      aou_hom: z.any().optional(),
      spliceai: z.any().optional(),
      SpliceAI_pred_DS_AG: z.any().optional(),
      SpliceAI_pred_DS_AL: z.any().optional(),
      SpliceAI_pred_DS_DG: z.any().optional(),
      SpliceAI_pred_DS_DL: z.any().optional(),
      dbscsnv: z.any().optional(),
      dbscsnv_ada_score: z.any().optional(),
      dbscsnv_rf_score: z.any().optional(),
      dbscSNV_ADA_SCORE: z.any().optional(),
      dbscSNV_RF_SCORE: z.any().optional(),
      gpn_star: z.any().optional(),
      gpn: z.any().optional(),
      gpn_msa: z.any().optional(),
      gpnstar: z.any().optional()
    }).optional()
  })).optional()
});

export function resolveGpnStarScore(
  rawRecord: any,
  _wtAa?: string,
  _mutAa?: string,
  _phylop?: number | null,
  _gerp?: number | null
): number | null {
  const raw = rawRecord?.gpn_star ?? rawRecord?.gpn ?? rawRecord?.gpn_msa ?? rawRecord?.gpnStar;
  const direct = safeParseFloat(Array.isArray(raw) ? raw[0] : raw);
  if (direct !== null) return direct;
  return null;
}

export async function fetchConservationData(
  gene: string,
  variant: string,
  pdbId?: string | null,
  chainId?: string | null,
  pos?: number | null,
  gnomadVariantId?: string | null,
  genosRec?: any | null,
  uniprotId?: string | null,
  transcriptId?: string | null,
  genomicPos?: number | null,
  /**
   * Build that `gnomadVariantId`'s coordinates belong to, when known.
   *
   * Participates in the cache key because this payload folds in single-build sources (GPN-Star,
   * local dbNSFP, Genos, dbnsfp.org, PopEVE, gnomAD r4), so a payload built from one build's
   * coordinate is not a valid answer for another's. Absent means "unknown", which is a distinct
   * key rather than a default.
   */
  assembly?: string | null
): Promise<ConservationData> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const cacheKey = buildConservationKey(gene, variant, pdbId, chainId, pos, gnomadVariantId, assembly);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Predictor Ensemble",
    l1Cache: conservationCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    shouldCache: (res) => res.available === true,
    fetcher: async () => {
      const resolvedPos = (pos !== undefined && pos !== null) 
        ? pos 
        : (() => {
            const match = variant.match(/\d+/);
            return match ? parseInt(match[0], 10) : null;
          })();

      const parsedIdCoord = gnomadVariantId ? parseGenomicCoordinateString(gnomadVariantId) : null;
      const spliceProximity = (transcriptId && genomicPos !== undefined && genomicPos !== null
        // Build gate, same rule as the progressive path below: the exon model is GRCh38
        // (rest.ensembl.org lookup), so a GRCh37 position must never be measured against it.
        // This call site was the ungated landmine (unmapping defect F-5) — reachable the moment
        // any caller passed a coordinate, and free to render wrong-locus geometry as measured.
        && assembly !== null && assembly !== undefined
        && sourceSupportsAssembly("splice-proximity", assembly as GenomeAssembly)
        // The position must also BE the tagged id's locus: `assembly` is documented as the build
        // `gnomadVariantId` belongs to, and nothing else ties `genomicPos` to it (review M5).
        // An unrelated genomicPos beside a tagged id gets no geometry.
        && parsedIdCoord !== null && parsedIdCoord.pos === genomicPos)
        ? await resolveSpliceProximity(transcriptId, genomicPos, parsedIdCoord?.chrom ?? null)
        : null;

      /**
       * NOTE: live SpliceAI is deliberately NOT fetched here. This function is reached with
       * `gnomadVariantId = null` (the progressive caller passes null) and `variant` is already
       * protein notation, so no genomic coordinate is resolvable at this depth. The live score is
       * fetched in `fetchConservationDataProgressive` — which has the parsed coordinate — and
       * overlaid on the merged result there, so every provider path benefits from one request.
       */
      const aaMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
      const wtAa = aaMatch ? toSingleAa(aaMatch[1]) : "";
      const mutAa = aaMatch ? toSingleAa(aaMatch[3]) : "";

      const defaultRes: ConservationData = {
        available: false,
        revel: null,
        gerp: null,
        phylop: null,
        consurf: null,
        bayesdel: null,
        metarnn: null,
        metarnnPred: null,
        clinpred: null,
        clinpredPred: null,
        eigenPhred: null,
        eigenRaw: null,
        dann: null,
        esm1b: null,
        esm1bPred: null,
        popeve: null,
        gpnStar: null,
        gpnStarStatus: "unavailable",
        aouFrequency: null,
        spliceProximity,
        spliceai: null,
        dbscsnv: null,
        alphagenome: null
      };

      // 1. Try local SQLite dbNSFP if present
      if (isLocalDbnsfpAvailable() && resolvedPos !== null) {
        try {
          const rec = await queryLocalDbnsfpVariant(gene, resolvedPos, null, null, variant);
          if (rec) {
            const parsedGnomad = parseGenomicCoordinateString(gnomadVariantId);
            /**
             * Same build gate as the progressive path, applied here too.
             *
             * This resolver is reachable with a coordinate (`gnomadVariantId` is a parameter), and
             * PopEVE and GPN-Star match chrom/pos/ref/alt against GRCh38-only indexes. Gating only
             * the progressive call site would leave this one free to score the wrong locus the
             * moment anyone passes a coordinate in.
             */
            const usableBy = (source: Parameters<typeof sourceSupportsAssembly>[0]) =>
              assembly !== null && assembly !== undefined && sourceSupportsAssembly(source, assembly as GenomeAssembly);

            const coordinateUsable = parsedGnomad !== null && usableBy("gpn-star");
            const popEVEPromise = coordinateUsable
              ? fetchPopEVEScore(parsedGnomad!.chrom, parsedGnomad!.pos, parsedGnomad!.ref, parsedGnomad!.alt).catch(() => null)
              : Promise.resolve(null);

            const consurfPromise = (pdbId && chainId && resolvedPos !== null)
              ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
              : Promise.resolve(null);

            const gpnTabixPromise = coordinateUsable
              ? fetchGpnStarByCoordinate(parsedGnomad!.chrom, parsedGnomad!.pos, parsedGnomad!.ref, parsedGnomad!.alt).catch(() => null)
              : Promise.resolve(null);

            // AlphaGenome is GRCh38-only — the same gate as its progressive-path sibling and
            // the PopEVE/GPN calls in this very block. Gating only the progressive call site
            // left this one free to score an hg19 position against the GRCh38 model (review M-4).
            const alphaPromise = (parsedGnomad && usableBy("alphagenome"))
              ? fetchAlphaGenome(parsedGnomad.chrom, parsedGnomad.pos, parsedGnomad.ref, parsedGnomad.alt, {
                  // The build reaches the cache key, as on the progressive path: a GRCh38
                  // entry must never be served for another build's numeric position.
                  assembly: assembly ?? undefined
                }).catch(() => null)
              : Promise.resolve(null);

            const [popEVEScore, consurfVal, gpnTabixRes, alphaRes] = await Promise.all([popEVEPromise, consurfPromise, gpnTabixPromise, alphaPromise]);

            let popEVEVal = rec.popeve ?? popEVEScore;
            if (popEVEVal === null) {
              const onlinePromise = fetchPopEVEScoreOnline(uniprotId || gene, variant);
              const fastTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000));
              popEVEVal = await Promise.race([onlinePromise, fastTimeout]);
            }

            const recGpn = resolveGpnStarScore(rec, wtAa, mutAa, rec.phylop, rec.gerp);
            const finalGpn = recGpn ?? gpnTabixRes?.score ?? null;

            const resVal: ConservationData = {
              available: true,
              revel: rec.revel,
              gerp: rec.gerp,
              phylop: rec.phylop,
              consurf: consurfVal,
              bayesdel: rec.bayesdel,
              metarnn: rec.metarnn,
              metarnnPred: null,
              clinpred: rec.clinpred,
              clinpredPred: null,
              eigenPhred: rec.eigen,
              eigenRaw: null,
              dann: rec.dann,
              esm1b: rec.esm1b,
              esm1bPred: null,
              popeve: popEVEVal,
              gpnStar: finalGpn,
              gpnStarStatus: finalGpn !== null ? "live" : (gpnTabixRes?.status ?? "unavailable"),
              gpnStarMessage: gpnTabixRes?.message ?? null,
              aouFrequency: {
                aouAC: rec.aou_ac,
                aouAN: rec.aou_an ?? null,
                aouHet: rec.aou_het ?? null,
                aouHom: rec.aou_hom ?? null
              },
              spliceProximity,
              spliceai: (rec as any).SpliceAI_pred_DS_AG !== undefined || (rec as any).spliceai_ds_ag !== undefined ? (() => {
                const ag = safeParseFloat((rec as any).SpliceAI_pred_DS_AG ?? (rec as any).spliceai_ds_ag);
                const al = safeParseFloat((rec as any).SpliceAI_pred_DS_AL ?? (rec as any).spliceai_ds_al);
                const dg = safeParseFloat((rec as any).SpliceAI_pred_DS_DG ?? (rec as any).spliceai_ds_dg);
                const dl = safeParseFloat((rec as any).SpliceAI_pred_DS_DL ?? (rec as any).spliceai_ds_dl);
                const hasAny = ag !== null || al !== null || dg !== null || dl !== null;
                return {
                  ds_ag: ag,
                  ds_al: al,
                  ds_dg: dg,
                  ds_dl: dl,
                  max_ds: hasAny ? Math.max(ag ?? 0, al ?? 0, dg ?? 0, dl ?? 0) : null
                };
              })() : null,
              dbscsnv: ((rec as any).dbscSNV_ADA_SCORE !== undefined || (rec as any).dbscsnv_ada_score !== undefined || (rec as any).dbscSNV_RF_SCORE !== undefined || (rec as any).dbscsnv_rf_score !== undefined) ? {
                ada_score: safeParseFloat((rec as any).dbscSNV_ADA_SCORE ?? (rec as any).dbscsnv_ada_score),
                rf_score: safeParseFloat((rec as any).dbscSNV_RF_SCORE ?? (rec as any).dbscsnv_rf_score)
              } : null,
              alphagenome: alphaRes ?? null,
              source: "local dbNSFP"
            };
            return resVal;
          }
        } catch (err: any) {
          console.warn(`[Local dbNSFP Query Error] Fallback to remote: ${err.message}`);
        }
      }

      // 2. Try Genos Web Query service (Academic Tier 2 for SpliceAI, popEVE, BayesDel, ClinPred)
      try {
        const activeGenosRec = genosRec !== undefined && genosRec !== null ? genosRec : await queryGenosWebservice(gene, variant, gnomadVariantId);
        if (activeGenosRec) {
          const consurfPromise = (pdbId && chainId && resolvedPos !== null)
            ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
            : Promise.resolve(null);
          const consurfVal = await consurfPromise;

          let popEVEVal = activeGenosRec.popeve;
          if (popEVEVal === null) {
            popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          const resVal: ConservationData = {
            available: true,
            revel: activeGenosRec.revel,
            gerp: activeGenosRec.gerp,
            phylop: activeGenosRec.phylop,
            consurf: consurfVal,
            bayesdel: activeGenosRec.bayesdel,
            metarnn: activeGenosRec.metarnn,
            metarnnPred: null,
            clinpred: activeGenosRec.clinpred,
            clinpredPred: null,
            eigenPhred: activeGenosRec.eigenPhred,
            eigenRaw: null,
            dann: activeGenosRec.dann,
            esm1b: activeGenosRec.esm1b,
            esm1bPred: null,
            popeve: popEVEVal,
            gpnStar: resolveGpnStarScore(activeGenosRec, wtAa, mutAa, activeGenosRec.phylop, activeGenosRec.gerp),
            gpnStarStatus: resolveGpnStarScore(activeGenosRec, wtAa, mutAa, activeGenosRec.phylop, activeGenosRec.gerp) !== null ? "live" : "unavailable",
            aouFrequency: (activeGenosRec.aou_ac !== null && activeGenosRec.aou_ac !== undefined) ? {
              aouAC: activeGenosRec.aou_ac,
              aouAN: activeGenosRec.aou_an ?? null,
              aouHet: activeGenosRec.aou_het ?? null,
              aouHom: activeGenosRec.aou_hom ?? null
            } : null,
            spliceProximity,
            spliceai: activeGenosRec.spliceai ? {
              ds_ag: activeGenosRec.spliceai.ds_ag,
              ds_al: activeGenosRec.spliceai.ds_al,
              ds_dg: activeGenosRec.spliceai.ds_dg,
              ds_dl: activeGenosRec.spliceai.ds_dl,
              max_ds: (activeGenosRec.spliceai.ds_ag !== null || activeGenosRec.spliceai.ds_al !== null || activeGenosRec.spliceai.ds_dg !== null || activeGenosRec.spliceai.ds_dl !== null) ? Math.max(
                activeGenosRec.spliceai.ds_ag || 0,
                activeGenosRec.spliceai.ds_al || 0,
                activeGenosRec.spliceai.ds_dg || 0,
                activeGenosRec.spliceai.ds_dl || 0
              ) : null
            } : null,
            dbscsnv: activeGenosRec.dbscsnv ? {
              ada_score: activeGenosRec.dbscsnv.ada_score,
              rf_score: activeGenosRec.dbscsnv.rf_score
            } : null,
            source: "Genos Web Query"
          };
          return resVal;
        }
      } catch (err: any) {
        console.warn(`[Genos Web Query Fallback Error] ${err.message}`);
      }

      // 3. Fast Tier 1 Baseline via Public query.dbnsfp.org (~900ms)
      try {
        const pubDbnsfp = await queryDbnsfpOrg(gene, variant, gnomadVariantId);
        if (pubDbnsfp && (pubDbnsfp.revel !== null || pubDbnsfp.gerp !== null || pubDbnsfp.phylop !== null)) {
          const consurfPromise = (pdbId && chainId && resolvedPos !== null)
            ? fetchRealConsurfData(pdbId, chainId, resolvedPos)
            : Promise.resolve(null);
          const consurfVal = await consurfPromise;

          let popEVEVal = pubDbnsfp.popeve ?? null;
          if (popEVEVal === null) {
            popEVEVal = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
          }

          const resVal: ConservationData = {
            available: true,
            revel: pubDbnsfp.revel ?? null,
            gerp: pubDbnsfp.gerp ?? null,
            phylop: pubDbnsfp.phylop ?? null,
            consurf: consurfVal,
            bayesdel: pubDbnsfp.bayesdel ?? null,
            metarnn: pubDbnsfp.metarnn ?? null,
            metarnnPred: null,
            clinpred: pubDbnsfp.clinpred ?? null,
            clinpredPred: null,
            eigenPhred: pubDbnsfp.eigenPhred ?? null,
            eigenRaw: pubDbnsfp.eigenRaw ?? null,
            dann: pubDbnsfp.dann ?? null,
            esm1b: pubDbnsfp.esm1b ?? null,
            esm1bPred: null,
            popeve: popEVEVal,
            gpnStar: resolveGpnStarScore(pubDbnsfp, wtAa, mutAa, pubDbnsfp.phylop ?? null, pubDbnsfp.gerp ?? null),
            gpnStarStatus: resolveGpnStarScore(pubDbnsfp, wtAa, mutAa, pubDbnsfp.phylop ?? null, pubDbnsfp.gerp ?? null) !== null ? "live" : "unavailable",
            aouFrequency: null,
            spliceProximity,
            spliceai: null,
            dbscsnv: null,
            source: "Public dbNSFP (dbnsfp.org)"
          };
          return resVal;
        }
      } catch (pubErr: any) {
        console.warn(`[Public dbNSFP Query Error] ${pubErr.message}`);
      }

      // 4. Fallback to MyVariant.info with optimized field projection
      const queryStr = (resolvedPos !== null)
        ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:${resolvedPos}`
        : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
      // NOTE `dbnsfp.dbscsnv`: the parser below reads dbscSNV ADA/RF from the hit, but the query
      // used to omit the field from the projection, so MyVariant never returned it — dbscSNV was
      // unfetchable by construction on this path (unmapping defect F-7).
      const targetFields = "dbnsfp.revel,dbnsfp.gerp,dbnsfp.gerp++,dbnsfp.phylop,dbnsfp.hgvsp,dbnsfp.aa.pos,dbnsfp.aapos,dbnsfp.genename,dbnsfp.alphamissense,dbnsfp.spliceai,dbnsfp.dbscsnv,dbnsfp.metarnn,dbnsfp.clinpred,dbnsfp.eigen,dbnsfp.bayesdel,dbnsfp.dann,dbnsfp.esm1b";
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=${targetFields}&limit=100`;
  
      try {
        const myVariantPromise = fetchWithRetry(url, {
          headers: { "Accept": "application/json" },
          timeout: 15000
        });

        const consurfPromise = (pdbId && chainId && pos)
          ? fetchRealConsurfData(pdbId, chainId, pos)
          : Promise.resolve(null);

        const popEVEPromise = gnomadVariantId
          ? (async () => {
              const parsed = parseGenomicCoordinateString(gnomadVariantId);
              if (parsed) {
                return fetchPopEVEScore(parsed.chrom, parsed.pos, parsed.ref, parsed.alt);
              }
              return null;
            })()
          : Promise.resolve(null);

        const [res, consurfVal, popEVEScore] = await Promise.all([
          myVariantPromise,
          consurfPromise,
          popEVEPromise
        ]);

        if (res.ok) {
          const data = await res.json() as any;
          const parsedData = myVariantResponseSchema.parse(data);
          if (parsedData.hits && parsedData.hits.length > 0) {
            const matchTerm3 = `p.${cleanVar}`.toLowerCase();
            const mutMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
            let matchTerm1 = "";
            if (mutMatch) {
              matchTerm1 = `p.${toSingleAa(mutMatch[1])}${mutMatch[2]}${toSingleAa(mutMatch[3])}`.toLowerCase();
            }

            const matchedHit = parsedData.hits.find(h => {
              const hgvspField = h.dbnsfp?.hgvsp;
              if (!hgvspField) return false;
              const hgvspArray = Array.isArray(hgvspField) ? hgvspField : [hgvspField];
              return hgvspArray.some(hVal => {
                if (typeof hVal !== "string") return false;
                const hLower = hVal.toLowerCase();
                return hLower.includes(matchTerm3) || (matchTerm1 && hLower.includes(matchTerm1));
              });
            });
            const hit = matchedHit || parsedData.hits[0];
            const isExactMatch = Boolean(matchedHit);

            if (!hit) {
              conservationCache.set(cacheKey, defaultRes, { ttl: 5 * 60 * 1000 });
              return defaultRes;
            }

            const dbnsfp = hit.dbnsfp;
            if (dbnsfp) {
              let revel: any = null;
              if (isExactMatch && dbnsfp.revel) {
                let rVal = dbnsfp.revel.score !== undefined ? dbnsfp.revel.score : dbnsfp.revel;
                if (Array.isArray(rVal)) rVal = rVal[0];
                revel = safeParseFloat(rVal);
              }

              // gerp/phylop are gated on the exact substitution like every other value: the query
              // is `aa.pos`-based, so without a matched hgvsp the record is an ARBITRARY variant
              // at the same protein position, and its conservation numbers would be attributed to
              // this variant (unmapping defect F-8).
              let gerp: any = null;
              if (isExactMatch) {
                const gerpObj = dbnsfp["gerp++"] || dbnsfp.gerp || {};
                let gerpVal = gerpObj.rs !== undefined ? gerpObj.rs : (gerpObj.elements || gerpObj["gerp++_rs"] || null);
                if (Array.isArray(gerpVal)) gerpVal = gerpVal[0];
                gerp = safeParseFloat(gerpVal);
              }

              let phylop: any = null;
              if (isExactMatch && dbnsfp.phylop) {
                let phylopVal = dbnsfp.phylop["100way_vertebrate"]?.score !== undefined 
                  ? dbnsfp.phylop["100way_vertebrate"].score 
                  : (dbnsfp.phylop.vertebrate || dbnsfp.phylop["phylop100way_vertebrate"] || null);
                if (Array.isArray(phylopVal)) phylopVal = phylopVal[0];
                phylop = safeParseFloat(phylopVal);
              }

              let bayesdel: number | null = null;
              if (isExactMatch) {
                if (dbnsfp.bayesdel?.no_af?.score !== undefined && dbnsfp.bayesdel?.no_af?.score !== null) {
                  let bVal = dbnsfp.bayesdel.no_af.score;
                  if (Array.isArray(bVal)) bVal = bVal[0];
                  bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? safeParseFloat(bVal) : null;
                } else if (dbnsfp.bayesdel_noaf_score !== undefined && dbnsfp.bayesdel_noaf_score !== null) {
                  let bVal = dbnsfp.bayesdel_noaf_score;
                  if (Array.isArray(bVal)) bVal = bVal[0];
                  bayesdel = bVal !== undefined && bVal !== null && bVal !== "" ? safeParseFloat(bVal) : null;
                }
              }

              let metarnn: number | null = null;
              let metarnnPred: string | null = null;
              if (isExactMatch && dbnsfp.metarnn) {
                let v = dbnsfp.metarnn.score;
                if (Array.isArray(v)) v = v[0];
                metarnn = v != null ? safeParseFloat(v) : null;
                let p = dbnsfp.metarnn.pred;
                if (Array.isArray(p)) p = p[0];
                metarnnPred = typeof p === "string" ? p : null;
              }

              let clinpred: number | null = null;
              let clinpredPred: string | null = null;
              if (isExactMatch && dbnsfp.clinpred) {
                clinpred = dbnsfp.clinpred.score != null ? safeParseFloat(dbnsfp.clinpred.score) : null;
                clinpredPred = typeof dbnsfp.clinpred.pred === "string" ? dbnsfp.clinpred.pred : null;
              }

              let eigenPhred: number | null = null;
              let eigenRaw: number | null = null;
              if (isExactMatch && dbnsfp.eigen) {
                eigenPhred = dbnsfp.eigen.phred_coding != null ? safeParseFloat(dbnsfp.eigen.phred_coding) : null;
                eigenRaw = dbnsfp.eigen.raw_coding != null ? safeParseFloat(dbnsfp.eigen.raw_coding) : null;
              }

              let dann: number | null = null;
              if (isExactMatch && dbnsfp.dann) {
                let d = dbnsfp.dann.score;
                if (Array.isArray(d)) d = d[0];
                dann = d != null ? safeParseFloat(d) : null;
              }

              let esm1b: number | null = null;
              let esm1bPred: string | null = null;
              if (isExactMatch && dbnsfp.esm1b) {
                let s = dbnsfp.esm1b.score;
                if (Array.isArray(s)) s = s[0];
                esm1b = s != null ? safeParseFloat(s) : null;
                let ep = dbnsfp.esm1b.pred;
                if (Array.isArray(ep)) ep = ep[0];
                esm1bPred = typeof ep === "string" ? ep : null;
              }

              let finalPopEVE = popEVEScore;
              if (isExactMatch && finalPopEVE === null && dbnsfp.eve?.score !== undefined) {
                let eVal = dbnsfp.eve.score;
                if (Array.isArray(eVal)) eVal = eVal[0];
                const parsed = safeParseFloat(eVal);
                if (parsed !== null) finalPopEVE = parsed;
              }
              if (finalPopEVE === null) {
                finalPopEVE = await fetchPopEVEScoreOnline(uniprotId || gene, variant);
              }

              let aouAC: number | null = null;
              let aouAN: number | null = null;
              let aouHet: number | null = null;
              let aouHom: number | null = null;

              if (isExactMatch && dbnsfp.aou_ac !== undefined) {
                let val = Array.isArray(dbnsfp.aou_ac) ? dbnsfp.aou_ac[0] : dbnsfp.aou_ac;
                aouAC = safeParseInt(val);
              }
              if (isExactMatch && dbnsfp.aou_an !== undefined) {
                let val = Array.isArray(dbnsfp.aou_an) ? dbnsfp.aou_an[0] : dbnsfp.aou_an;
                aouAN = safeParseInt(val);
              }
              if (isExactMatch && dbnsfp.aou_het !== undefined) {
                let val = Array.isArray(dbnsfp.aou_het) ? dbnsfp.aou_het[0] : dbnsfp.aou_het;
                aouHet = safeParseInt(val);
              }
              if (isExactMatch && dbnsfp.aou_hom !== undefined) {
                let val = Array.isArray(dbnsfp.aou_hom) ? dbnsfp.aou_hom[0] : dbnsfp.aou_hom;
                aouHom = safeParseInt(val);
              }

              const hasAou = aouAC !== null || aouAN !== null || aouHet !== null || aouHom !== null;

              const db = dbnsfp as any;
              const rawAda = isExactMatch ? getFirstOrVal(db.dbscsnv?.ada_score ?? db.dbscsnv_ada_score ?? db.dbscSNV_ADA_SCORE ?? (db.dbscsnv && db.dbscsnv['ada_score'])) : undefined;
              const rawRf = isExactMatch ? getFirstOrVal(db.dbscsnv?.rf_score ?? db.dbscsnv_rf_score ?? db.dbscSNV_RF_SCORE ?? (db.dbscsnv && db.dbscsnv['rf_score'])) : undefined;
              const hasDbscsnv = rawAda !== undefined || rawRf !== undefined;

              const ag = isExactMatch ? safeParseFloat(getFirstOrVal(db.spliceai?.ds_ag ?? db.spliceai_pred_ds_ag ?? db.SpliceAI_pred_DS_AG ?? db.spliceai_ds_ag ?? (db.spliceai && db.spliceai['ds_ag']))) : null;
              const al = isExactMatch ? safeParseFloat(getFirstOrVal(db.spliceai?.ds_al ?? db.spliceai_pred_ds_al ?? db.SpliceAI_pred_DS_AL ?? db.spliceai_ds_al ?? (db.spliceai && db.spliceai['ds_al']))) : null;
              const dg = isExactMatch ? safeParseFloat(getFirstOrVal(db.spliceai?.ds_dg ?? db.spliceai_pred_ds_dg ?? db.SpliceAI_pred_DS_DG ?? db.spliceai_ds_dg ?? (db.spliceai && db.spliceai['ds_dg']))) : null;
              const dl = isExactMatch ? safeParseFloat(getFirstOrVal(db.spliceai?.ds_dl ?? db.spliceai_pred_ds_dl ?? db.SpliceAI_pred_DS_DL ?? db.spliceai_ds_dl ?? (db.spliceai && db.spliceai['ds_dl']))) : null;
              const hasSpliceAI = ag !== null || al !== null || dg !== null || dl !== null;

              const resVal: ConservationData = { 
                available: true, 
                revel, 
                gerp, 
                phylop, 
                consurf: consurfVal,
                bayesdel,
                metarnn,
                metarnnPred,
                clinpred,
                clinpredPred,
                eigenPhred,
                eigenRaw,
                dann,
                esm1b: esm1b,
                esm1bPred: esm1bPred,
                popeve: finalPopEVE,
                gpnStar: isExactMatch ? resolveGpnStarScore(dbnsfp, wtAa, mutAa, phylop, gerp) : null,
                gpnStarStatus: (isExactMatch && resolveGpnStarScore(dbnsfp, wtAa, mutAa, phylop, gerp) !== null) ? "live" : "unavailable",
                aouFrequency: hasAou ? {
                  aouAC,
                  aouAN,
                  aouHet,
                  aouHom
                } : null,
                spliceProximity,
                spliceai: hasSpliceAI ? {
                  ds_ag: ag,
                  ds_al: al,
                  ds_dg: dg,
                  ds_dl: dl,
                  max_ds: Math.max(ag ?? 0, al ?? 0, dg ?? 0, dl ?? 0)
                } : null,
                dbscsnv: hasDbscsnv ? {
                  ada_score: safeParseFloat(Array.isArray(rawAda) ? rawAda[0] : rawAda),
                  rf_score: safeParseFloat(Array.isArray(rawRf) ? rawRf[0] : rawRf)
                } : null,
                source: "myvariant.info"
              };
              return resVal;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
      }

      // A live SpliceAI score is overlaid by the progressive caller, which holds the genomic
      // coordinate; this function cannot resolve one (see the note above the aaMatch).
      return defaultRes;
    }
  });
}

export interface ProgressiveConservationContext {
  gene: string;
  variant: string;
  pos?: number | null;
  uniprotId?: string | null;
  /**
   * Build the caller's notation was expressed in. Every coordinate-consuming source in
   * this pipeline is single-build (GPN-Star, local dbNSFP, Genos, dbnsfp.org, gnomAD r4
   * ids) or has a service per build (SpliceAI Lookup), so this decides routing — a
   * GRCh37 coordinate handed to a GRCh38 index either misses or, worse, resolves to a
   * different locus. Defaults to GRCh38, which is what every source here is pinned to.
   */
  assembly?: GenomeAssembly;
  pdbMappingPromise?: Promise<any>;
  predictorPromise?: Promise<any>;
  genosPromise?: Promise<any>;
  biohubToken?: string | null;
  hfToken?: string | null;
  gpnApiUrl?: string | null;
  alphagenomeApiKey?: string | null;
  alphagenomeApiUrl?: string | null;
  sequence?: string | null;
}

export async function fetchConservationDataProgressive(
  context: ProgressiveConservationContext
): Promise<ConservationData> {
  const {
    gene,
    variant,
    pos,
    uniprotId,
    pdbMappingPromise,
    predictorPromise,
    genosPromise,
    hfToken,
    gpnApiUrl,
    alphagenomeApiKey,
    alphagenomeApiUrl,
    sequence
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

  const aaMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
  const wtAa = aaMatch ? toSingleAa(aaMatch[1]) : "";
  const mutAa = aaMatch ? toSingleAa(aaMatch[3]) : "";

  // 1. Asynchronously enrich ConSurf when PDB mapping resolves (zero waterfall delay on base fetch)
  const consurfTask = (pdbMappingPromise || Promise.resolve(null))
    .then(pdbMap => {
      if (pdbMap?.pdbId && resolvedPos !== null) {
        return fetchRealConsurfData(pdbMap.pdbId, pdbMap.chainId, resolvedPos);
      }
      return null;
    })
    .catch(() => null);

  // 2. Asynchronously compute PopEVE, GPN-Star Tabix, splice proximity, and AlphaGenome AVI when predictor resolves
  const predictorEnrichmentTask = (predictorPromise || Promise.resolve(null))
    .then(async (pred) => {
      let popEVEScore: number | null = null;
      let spliceProximity: any = null;
      let gpnStarResult: EvolutionaryScaleResult | null = null;
      let alphagenomeResult: AlphaGenomeAviData | null = null;
      let liveSpliceAi: SpliceAiScoreRecord | null = null;
      const assemblyRefusals: Array<{ source: string; reason: string }> = [];

      const parsedCoord = parseGenomicCoordinateString(pred?.gnomadVariantId) || parseGenomicCoordinateString(variant);
      if (parsedCoord) {
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
        const coordinateAssembly = pred?.gnomadVariantAssembly ?? null;
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
         */
        for (const src of ASSEMBLY_REFUSAL_SOURCES) {
          const reachable = src === "splice-proximity"
            ? Boolean(pred?.transcriptId)
            : src === "alphagenome"
            ? Boolean(alphagenomeApiKey || alphagenomeApiUrl)
            : true;
          if (!reachable) continue;
          if (coordinateAssembly === null) {
            assemblyRefusals.push({
              source: src,
              reason: `${src} was not scored: the coordinate's genome build was not declared.`
            });
          } else if (!sourceSupportsAssembly(src, coordinateAssembly)) {
            assemblyRefusals.push({ source: src, reason: describeAssemblyRefusal(src, coordinateAssembly) });
          }
        }

        const [popRes, gpnRes, alphaRes, liveSpliceAiRes] = await Promise.all([
          // PopEVE matches chrom/pos/ref/alt against a GRCh38-only index (`popeve_grch38.vcf.gz`).
          usableBy("popEVE")
            ? fetchPopEVEScore(parsedCoord.chrom, parsedCoord.pos, parsedCoord.ref, parsedCoord.alt).catch(() => null)
            : Promise.resolve(null),
          // GPN-Star is a GRCh38-only Tabix index.
          usableBy("gpn-star")
            ? fetchGpnStarByCoordinate(parsedCoord.chrom, parsedCoord.pos, parsedCoord.ref, parsedCoord.alt).catch(() => null)
            : Promise.resolve(null),
          // AlphaGenome is GRCh38-only: the Atlas holds GRCh38 SNVs and the model is GRCh38.
          usableBy("alphagenome")
            ? fetchAlphaGenome(parsedCoord.chrom, parsedCoord.pos, parsedCoord.ref, parsedCoord.alt, {
                apiKey: alphagenomeApiKey,
                apiUrl: alphagenomeApiUrl,
                // The build reaches the cache key so a GRCh38 entry is never served for another
                // build's coordinate at the same numeric position.
                assembly: coordinateAssembly
              }).catch(() => null)
            : Promise.resolve(null),
          // Live SpliceAI runs a service per build, so it routes on the COORDINATE's build
          // rather than the request's.
          fetchLiveSpliceAiIfPossible(
            parsedCoord.chrom, parsedCoord.pos, parsedCoord.ref, parsedCoord.alt, coordinateAssembly
          )
            // A caller abort makes the client throw so the HTTP layer can answer 504 honestly.
            // Catching it HERE keeps that abort from nulling PopEVE, GPN-Star and AlphaGenome, which
            // share this Promise.all — previously a single SpliceAI abort discarded all four.
            .catch(() => null)
        ]);
        popEVEScore = popRes;
        gpnStarResult = gpnRes;
        alphagenomeResult = alphaRes;
        liveSpliceAi = liveSpliceAiRes;

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
        if (pred?.transcriptId && usableBy("splice-proximity")) {
          const geometryTranscript = pred.canonicalEnsemblId || pred.transcriptId;
          spliceProximity = await resolveSpliceProximity(geometryTranscript, parsedCoord.pos, parsedCoord.chrom).catch(() => null);
        }
      }
      return { popEVEScore, spliceProximity, gpnStarResult, alphagenomeResult, liveSpliceAi, assemblyRefusals };
    })
    .catch(() => ({ popEVEScore: null, spliceProximity: null, gpnStarResult: null, alphagenomeResult: null, liveSpliceAi: null, assemblyRefusals: null as Array<{ source: string; reason: string }> | null }));

  // 3. Immediately kick off base conservation (local dbNSFP / Genos / dbnsfp.org / MyVariant)
  const genosRecTask = (genosPromise || Promise.resolve(null)).catch(() => null);
  const fastGenos = await Promise.race([
    genosRecTask,
    new Promise(r => setTimeout(() => r(null), 500))
  ]);

  /**
   * The base payload's cache key includes the coordinate's build.
   *
   * This payload folds in single-build sources (local dbNSFP, Genos, dbnsfp.org), so a result
   * assembled from one build's coordinates is not a valid answer for another's. The build lives
   * on the predictor metadata, so it is awaited here — the promise has already been started by
   * the caller, so this does not add a round trip, and the enrichment task above consumes the
   * same promise rather than a second copy.
   *
   * A rejection is not fatal: a missing predictor means "no coordinate", and the base payload is
   * still assembled without one.
   */
  const coordinateAssembly = await (predictorPromise || Promise.resolve(null))
    .then(pred => (pred?.gnomadVariantAssembly ?? null) as string | null)
    .catch(() => null);

  const baseConservationPromise = fetchConservationData(
    gene,
    variant,
    null,
    null,
    pos,
    null,
    fastGenos,
    uniprotId,
    null,
    null,
    coordinateAssembly
  );

  // 4. Concurrently query frontier genomic foundation model (Song Lab GPN-Star fallback)
  const gpnToken = hfToken || null;

  const gpnTask: Promise<EvolutionaryScaleResult> = (sequence && resolvedPos !== null && wtAa && mutAa)
    ? fetchGpnStarScore(sequence, resolvedPos, wtAa, mutAa, gpnToken, undefined, gpnApiUrl)
    : Promise.resolve({ score: null, status: gpnToken ? "unavailable" : "token_required" });

  // 5. Merge enriched ConSurf, PopEVE, Splice, base conservation, and GPN-Star data as they resolve concurrently
  const [baseConservation, consurfVal, enrichment, gpnRes] = await Promise.all([
    baseConservationPromise,
    consurfTask,
    predictorEnrichmentTask,
    gpnTask
  ]);

  const finalGpnScore = (enrichment.gpnStarResult?.score !== null && enrichment.gpnStarResult?.score !== undefined)
    ? enrichment.gpnStarResult.score
    : (gpnRes.score ?? baseConservation.gpnStar);

  const finalGpnStatus = (enrichment.gpnStarResult?.score !== null && enrichment.gpnStarResult?.score !== undefined)
    ? "live"
    : (gpnRes.status ?? baseConservation.gpnStarStatus ?? (finalGpnScore !== null ? "live" : "unavailable"));

  const finalGpnMessage = enrichment.gpnStarResult?.message ?? gpnRes.message ?? null;

  return applyLiveSpliceAi({
    ...baseConservation,
    consurf: consurfVal ?? baseConservation.consurf,
    popeve: baseConservation.popeve ?? enrichment.popEVEScore,
    spliceProximity: enrichment.spliceProximity ?? baseConservation.spliceProximity,
    assemblyRefusals: enrichment.assemblyRefusals && enrichment.assemblyRefusals.length > 0
      ? enrichment.assemblyRefusals
      : baseConservation.assemblyRefusals ?? null,
    gpnStar: finalGpnScore,
    gpnStarStatus: finalGpnStatus,
    gpnStarMessage: finalGpnMessage,
    alphagenome: enrichment.alphagenomeResult ?? baseConservation.alphagenome ?? null
  }, enrichment.liveSpliceAi);
}

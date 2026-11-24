import { z } from "zod";
import { fetchWithRetry, normalizeGeneSymbol, normalizeVariantTo3Letter } from "../../infra/http-client.ts";
import { safeParseFloat, toSingleAa, getFirstOrVal } from "./normalizer.ts";
import { NO_DBNSFP_SCORES, type DbnsfpScores } from "./dbnsfp-scores.ts";

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
      esm1b: z.any().optional(),
      spliceai: z.any().optional(),
      SpliceAI_pred_DS_AG: z.any().optional(),
      SpliceAI_pred_DS_AL: z.any().optional(),
      SpliceAI_pred_DS_DG: z.any().optional(),
      SpliceAI_pred_DS_DL: z.any().optional()
    }).optional()
  })).optional()
});

type MyVariantDbnsfp = NonNullable<NonNullable<z.infer<typeof myVariantResponseSchema>["hits"]>[number]["dbnsfp"]>;

const TARGET_FIELDS = "dbnsfp.revel,dbnsfp.gerp,dbnsfp.gerp++,dbnsfp.phylop,dbnsfp.hgvsp,dbnsfp.aa.pos,dbnsfp.aapos,dbnsfp.genename,dbnsfp.alphamissense,dbnsfp.spliceai,dbnsfp.metarnn,dbnsfp.clinpred,dbnsfp.bayesdel,dbnsfp.esm1b";

/**
 * MyVariant.info's dbNSFP record for this exact substitution, or null when it has none or the
 * request fails.
 *
 * The query is by protein position, so the hits are every variant at that residue. Only a hit whose
 * HGVSp names this substitution is read: any other hit is a different variant, and its scores would
 * be attributed to this one.
 */
export async function queryMyVariantDbnsfp(
  gene: string,
  variant: string,
  resolvedPos: number | null
): Promise<DbnsfpScores | null> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  const queryStr = resolvedPos !== null
    ? `dbnsfp.genename:${normGene} AND dbnsfp.aa.pos:${resolvedPos}`
    : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
  const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=${TARGET_FIELDS}&limit=100`;
  try {
    const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 15000 });
    if (!res.ok) return null;
    const parsed = myVariantResponseSchema.parse(await res.json());
    const hit = parsed.hits?.find(h => hgvspNamesVariant(h.dbnsfp?.hgvsp, variant, cleanVar));
    return hit?.dbnsfp ? scoresFromMyVariant(hit.dbnsfp) : null;
  } catch (err: any) {
    console.warn(`[Conservation Fetch Error] Failed to fetch MyVariant conservation: ${err.message}`);
    return null;
  }
}

function hgvspNamesVariant(hgvsp: unknown, variant: string, cleanVar: string): boolean {
  if (!hgvsp) return false;
  const term3 = `p.${cleanVar}`.toLowerCase();
  const m = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
  const term1 = m ? `p.${toSingleAa(m[1])}${m[2]}${toSingleAa(m[3])}`.toLowerCase() : "";
  const values = Array.isArray(hgvsp) ? hgvsp : [hgvsp];
  return values.some(v => typeof v === "string"
    && (v.toLowerCase().includes(term3) || (term1 !== "" && v.toLowerCase().includes(term1))));
}

/** MyVariant nests most columns (`revel.score`) and may give a list per transcript; the first is read. */
function scoresFromMyVariant(db: MyVariantDbnsfp): DbnsfpScores {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const num = (v: unknown) => safeParseFloat(first(v));
  const label = (v: unknown) => { const p = first(v); return typeof p === "string" ? p : null; };
  const gerpObj = db["gerp++"] || db.gerp || {};
  const phylop = db.phylop;
  const clinpred = first(db.clinpred);
  return {
    ...NO_DBNSFP_SCORES,
    revel: db.revel ? num(db.revel.score !== undefined ? db.revel.score : db.revel) : null,
    gerp: num(gerpObj.rs !== undefined ? gerpObj.rs : (gerpObj.elements || gerpObj["gerp++_rs"] || null)),
    phylop: phylop
      ? num(phylop["100way_vertebrate"]?.score !== undefined
        ? phylop["100way_vertebrate"].score
        : (phylop.vertebrate || phylop["phylop100way_vertebrate"] || null))
      : null,
    // The noAF score only: the calibrated BayesDel bands are for the score without allele frequency.
    bayesdel: num(db.bayesdel?.no_af?.score ?? db.bayesdel_noaf_score),
    metarnn: num(db.metarnn?.score),
    metarnnPred: label(db.metarnn?.pred),
    clinpred: num(clinpred?.score),
    clinpredPred: label(clinpred?.pred),
    esm1b: num(db.esm1b?.score),
    esm1bPred: label(db.esm1b?.pred),
    // EVE is never read as popEVE: EVE runs 0 to 1 (higher = harmful), popEVE is a negative scale.
    popeve: null,
    spliceai: spliceAiFromMyVariant(db as Record<string, any>),
  };
}

function spliceAiFromMyVariant(db: Record<string, any>): DbnsfpScores["spliceai"] {
  const delta = (key: "ag" | "al" | "dg" | "dl") => safeParseFloat(getFirstOrVal(
    db.spliceai?.[`ds_${key}`] ?? db[`spliceai_pred_ds_${key}`] ?? db[`SpliceAI_pred_DS_${key.toUpperCase()}`] ?? db[`spliceai_ds_${key}`]
  ));
  const [ag, al, dg, dl] = [delta("ag"), delta("al"), delta("dg"), delta("dl")];
  if (ag === null && al === null && dg === null && dl === null) return null;
  return { ds_ag: ag, ds_al: al, ds_dg: dg, ds_dl: dl, max_ds: Math.max(ag ?? 0, al ?? 0, dg ?? 0, dl ?? 0) };
}

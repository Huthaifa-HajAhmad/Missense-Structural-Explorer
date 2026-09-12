import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "../http-client.ts";
import { safeParseFloat } from "./normalizer.ts";
import type { ConservationData } from "../../../src/shared/contracts.ts";

/**
 * Fast Tier 1 baseline querying the public, unauthenticated query.dbnsfp.org API (~900ms).
 */
export async function queryDbnsfpOrg(
  gene: string,
  variant: string,
  gnomadVariantId?: string | null
): Promise<Partial<ConservationData> | null> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  let variantQuery = '';
  if (gnomadVariantId) {
    const parts = gnomadVariantId.split('-');
    if (parts.length >= 4) {
      variantQuery = `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}`;
    }
  }
  if (!variantQuery) {
    const formattedVariant = variant.startsWith('p.') ? variant : `p.${variant}`;
    variantQuery = `${normGene}:${formattedVariant}`;
  }

  try {
    const res = await fetchWithRetry('https://query.dbnsfp.org/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        variants: [variantQuery],
        genome_build: 'hg38'
      }),
      timeout: 7000
    }, 1);

    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data || !data.tabs) return null;

    const cScores = data.tabs.conservative_scores?.rows?.[0] || {};
    const allTrans = data.tabs.all_transcripts?.rows?.[0] || {};
    const fPred = data.tabs.function_prediction?.rows?.[0] || {};

    const revel = safeParseFloat(allTrans.REVEL ?? allTrans.REVEL_score ?? fPred.REVEL_score);
    const gerp = safeParseFloat(cScores['GERP++_RS'] ?? allTrans['GERP++_RS'] ?? fPred['GERP++_RS']);
    const phylop = safeParseFloat(cScores.phyloP100way_vertebrate ?? allTrans.phyloP100way_vertebrate ?? fPred.phyloP100way_vertebrate);
    const bayesdel = safeParseFloat(allTrans.BayesDel_noAF_score ?? allTrans.BayesDel_noAF ?? fPred.BayesDel_noAF_score ?? fPred.BayesDel_addAF_score);
    const metarnn = safeParseFloat(allTrans.MetaRNN ?? allTrans.MetaRNN_score ?? fPred.MetaRNN_score);
    const clinpred = safeParseFloat(allTrans.ClinPred_score ?? allTrans.ClinPred ?? fPred.ClinPred_score);
    const eigenPhred = safeParseFloat(fPred['Eigen-phred_coding'] ?? allTrans['Eigen-phred_coding']);
    const eigenRaw = safeParseFloat(fPred['Eigen-raw_coding'] ?? allTrans['Eigen-raw_coding']);
    const dann = safeParseFloat(fPred.DANN_score ?? allTrans.DANN_score);
    const esm1b = safeParseFloat(allTrans.ESM1b ?? allTrans.ESM1b_score ?? fPred.ESM1b_score);
    const popeve = safeParseFloat(allTrans.popEVE ?? allTrans.popEVE_score ?? fPred.popEVE_score);

    if (revel === null && gerp === null && phylop === null && metarnn === null && dann === null) {
      return null;
    }

    return {
      revel,
      gerp,
      phylop,
      bayesdel,
      metarnn,
      clinpred,
      eigenPhred,
      eigenRaw,
      dann,
      esm1b,
      popeve
    };
  } catch (err: any) {
    console.warn(`[dbNSFP.org Query Warning] Failed to query query.dbnsfp.org for ${variantQuery}:`, err.message);
    return null;
  }
}

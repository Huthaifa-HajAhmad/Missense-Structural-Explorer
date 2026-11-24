import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "../../infra/http-client.ts";
import { safeParseFloat } from "./normalizer.ts";
import { parseGenomicCoordinateString } from "../../../../src/shared/contracts.ts";
import { NO_DBNSFP_SCORES, type DbnsfpScores } from "./dbnsfp-scores.ts";
import { sourceSupportsAssembly } from "../../../../src/shared/assembly.ts";
import type { GenomeAssembly } from "../../../../src/shared/variantNotation.ts";

/**
 * Fast Tier 1 baseline querying the public, unauthenticated query.dbnsfp.org API (~900ms).
 *
 * `query.dbnsfp.org` indexes `hg38` only: when a caller supplies `assembly`, coordinates from any
 * non-GRCh38 build are withheld so a coordinate from GRCh37 never hits an hg38 locus.
 */
export async function queryDbnsfpOrg(
  gene: string,
  variant: string,
  gnomadVariantId?: string | null,
  assembly?: string | null
): Promise<DbnsfpScores | null> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  let variantQuery = '';
  const coordinateBuildAllowed =
    assembly === undefined
      ? true
      : assembly !== null && sourceSupportsAssembly("dbnsfpOrg", assembly as GenomeAssembly);
  if (gnomadVariantId && coordinateBuildAllowed) {
    const parsed = parseGenomicCoordinateString(gnomadVariantId);
    if (parsed) {
      variantQuery = `${parsed.chrom}-${parsed.pos}-${parsed.ref}-${parsed.alt}`;
    }
  }
  if (!variantQuery) {
    const formattedVariant = cleanVar.startsWith('p.') ? cleanVar : `p.${cleanVar}`;
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

    return scoresFromDbnsfpOrgTabs(data.tabs);
  } catch (err: any) {
    console.warn(`[dbNSFP.org Query Warning] Failed to query query.dbnsfp.org for ${variantQuery}:`, err.message);
    return null;
  }
}

type DbnsfpOrgRow = Record<string, unknown>;

/**
 * One record from the response's tabs. `function_prediction` holds the transcript the service
 * selected (MANE Select where there is one); `all_transcripts` lists every transcript in no stated
 * order, so its first row is read only when the selected row is missing. Every score comes from that
 * one row, never mixed across transcripts. GERP++ and phyloP are per position and sit in
 * `conservative_scores`. Null when no score is present.
 */
function scoresFromDbnsfpOrgTabs(tabs: Record<string, { rows?: DbnsfpOrgRow[] } | undefined>): DbnsfpScores | null {
  const row = tabs.function_prediction?.rows?.[0] ?? tabs.all_transcripts?.rows?.[0] ?? {};
  const conservation = tabs.conservative_scores?.rows?.[0] ?? {};
  const read = (column: string) => safeParseFloat(row[column]);
  const scores: DbnsfpScores = {
    ...NO_DBNSFP_SCORES,
    revel: read("REVEL_score"),
    gerp: safeParseFloat(conservation["GERP++_RS"] ?? row["GERP++_RS"]),
    phylop: safeParseFloat(conservation.phyloP100way_vertebrate ?? row.phyloP100way_vertebrate),
    // The noAF score only: the calibrated BayesDel bands are for the score without allele frequency.
    bayesdel: read("BayesDel_noAF_score"),
    esm1b: read("ESM1b_score"),
    popeve: read("popEVE_score"),
  };
  const hasAny = [scores.revel, scores.gerp, scores.phylop, scores.bayesdel,
    scores.esm1b, scores.popeve].some(v => v !== null);
  return hasAny ? scores : null;
}

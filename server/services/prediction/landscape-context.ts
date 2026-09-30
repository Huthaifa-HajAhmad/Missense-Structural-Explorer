import { fetchWithRetry, normalizeGeneSymbol } from "../infra/http-client.ts";
import { fetchGnomadGeneConstraint } from "../external-api/gnomad.ts";

/**
 * Gene-wide context for the Landscape overview: where ClinVar and gnomAD have missense variants,
 * and gnomAD's regional missense constraint. These are the facts a reader weighs for PM1
 * (hotspot / critical region without benign variation); the tab shows them and proposes no code.
 *
 * ClinVar and gnomAD come from gnomAD's GraphQL API on GRCh38, restricted to gnomAD's canonical
 * transcript so residue numbers match the landscape's MANE numbering in the usual case (gnomAD v4
 * canonical = MANE Select for most genes). Regional constraint only exists for gnomAD v2
 * (GRCh37 canonical transcript), and the payload says so.
 */

import { classifyClinvar, type ClinvarClass } from "../../../src/shared/clinvarClassification.ts";

export { classifyClinvar };
export type { ClinvarClass };

export interface ContextClinvar {
  pos: number;
  cls: ClinvarClass;
  significance: string;
  stars: number | null;
  hgvsp: string;
}

export interface ContextGnomad {
  pos: number;
  /** Distinct missense variants at this residue. */
  variants: number;
  /** Highest allele count among them (exome + genome). */
  maxAc: number;
}

export interface ContextRegion {
  start: number;
  end: number;
  oe: number | null;
  pValue: number | null;
}

export interface LandscapeContext {
  clinvar: ContextClinvar[] | null;
  gnomad: ContextGnomad[] | null;
  regions: ContextRegion[] | null;
  /** Transcript gnomAD numbered ClinVar/gnomAD residues on. */
  transcript: string | null;
  regionsBasis: string;
  /** Per-source failure notes, so an absent lane reads as "not loaded", never "none". */
  errors: string[];
}

const GNOMAD_API = "https://gnomad.broadinstitute.org/api";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_GENES = 200;
const cache = new Map<string, { at: number; value: LandscapeContext }>();

const AA3: Record<string, string> = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Gln: "Q", Glu: "E", Gly: "G", His: "H", Ile: "I",
  Leu: "L", Lys: "K", Met: "M", Phe: "F", Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V"
};

/** "p.Asp116Gly" → 116 when it is a missense change; null for synonymous, stop, frameshift, etc. */
export function missenseResidue(hgvsp: unknown): number | null {
  if (typeof hgvsp !== "string") return null;
  const m = hgvsp.match(/^p\.([A-Z][a-z]{2})(\d+)([A-Z][a-z]{2})$/);
  if (!m) return null;
  if (!AA3[m[1]] || !AA3[m[3]] || m[1] === m[3]) return null;
  return parseInt(m[2], 10);
}

async function gnomadQuery(query: string, gene: string): Promise<any> {
  const res = await fetchWithRetry(
    GNOMAD_API,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { gene } }),
      timeout: 20000
    },
    2,
    1500
  );
  if (!res.ok) throw new Error(`gnomAD API ${res.status}`);
  const json = (await res.json()) as any;
  if (json?.errors?.length) throw new Error(String(json.errors[0]?.message ?? "gnomAD API error"));
  return json?.data?.gene ?? null;
}

const onTranscript = (row: any, canonical: string | null) =>
  !canonical || !row?.transcript_id || String(row.transcript_id).split(".")[0] === canonical.split(".")[0];

export function parseClinvar(rows: any[], canonical: string | null): ContextClinvar[] {
  const out: ContextClinvar[] = [];
  for (const r of rows ?? []) {
    if (!onTranscript(r, canonical)) continue;
    const pos = missenseResidue(r?.hgvsp);
    if (pos === null) continue;
    out.push({
      pos,
      cls: classifyClinvar(r?.clinical_significance),
      significance: String(r?.clinical_significance ?? ""),
      stars: typeof r?.gold_stars === "number" ? r.gold_stars : null,
      hgvsp: r.hgvsp
    });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

export function parseGnomad(rows: any[], canonical: string | null): ContextGnomad[] {
  const byPos = new Map<number, ContextGnomad>();
  for (const r of rows ?? []) {
    if (!onTranscript(r, canonical)) continue;
    if (r?.consequence && r.consequence !== "missense_variant") continue;
    const pos = missenseResidue(r?.hgvsp);
    if (pos === null) continue;
    const ac = (Number(r?.exome?.ac) || 0) + (Number(r?.genome?.ac) || 0);
    if (ac <= 0) continue;
    const prev = byPos.get(pos);
    byPos.set(pos, { pos, variants: (prev?.variants ?? 0) + 1, maxAc: Math.max(prev?.maxAc ?? 0, ac) });
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

export function parseRegions(regions: any[] | undefined): ContextRegion[] {
  const out: ContextRegion[] = [];
  for (const r of regions ?? []) {
    const a = parseInt(String(r?.aa_start ?? "").replace(/\D/g, ""), 10);
    const b = parseInt(String(r?.aa_stop ?? "").replace(/\D/g, ""), 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    out.push({
      start: Math.min(a, b),
      end: Math.max(a, b),
      oe: typeof r?.obs_exp === "number" ? Number(r.obs_exp.toFixed(2)) : null,
      pValue: typeof r?.p_value === "number" ? r.p_value : r?.p_value != null ? Number(r.p_value) : null
    });
  }
  return out.sort((x, y) => x.start - y.start);
}

export async function fetchLandscapeContext(geneSymbol: string): Promise<LandscapeContext> {
  const gene = normalizeGeneSymbol(geneSymbol).toUpperCase();
  const hit = cache.get(gene);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const errors: string[] = [];
  // Two queries, so a failure in one list does not blank the other.
  const [clinvarRes, gnomadRes, constraintRes] = await Promise.allSettled([
    gnomadQuery(
      `query LandscapeClinvar($gene: String!) { gene(gene_symbol: $gene, reference_genome: GRCh38) { canonical_transcript_id clinvar_variants { variant_id clinical_significance gold_stars hgvsp transcript_id } } }`,
      gene
    ),
    gnomadQuery(
      `query LandscapeGnomad($gene: String!) { gene(gene_symbol: $gene, reference_genome: GRCh38) { canonical_transcript_id variants(dataset: gnomad_r4) { variant_id consequence hgvsp transcript_id exome { ac } genome { ac } } } }`,
      gene
    ),
    fetchGnomadGeneConstraint(gene)
  ]);

  let transcript: string | null = null;
  let clinvar: ContextClinvar[] | null = null;
  let gnomad: ContextGnomad[] | null = null;
  let regions: ContextRegion[] | null = null;

  if (clinvarRes.status === "fulfilled" && clinvarRes.value) {
    transcript = clinvarRes.value.canonical_transcript_id ?? null;
    clinvar = parseClinvar(clinvarRes.value.clinvar_variants ?? [], transcript);
  } else {
    errors.push(`ClinVar not loaded: ${clinvarRes.status === "rejected" ? clinvarRes.reason?.message ?? "request failed" : "gene not found"}`);
  }
  if (gnomadRes.status === "fulfilled" && gnomadRes.value) {
    transcript = transcript ?? gnomadRes.value.canonical_transcript_id ?? null;
    gnomad = parseGnomad(gnomadRes.value.variants ?? [], gnomadRes.value.canonical_transcript_id ?? transcript);
  } else {
    errors.push(`gnomAD not loaded: ${gnomadRes.status === "rejected" ? gnomadRes.reason?.message ?? "request failed" : "gene not found"}`);
  }
  if (constraintRes.status === "fulfilled" && constraintRes.value) {
    regions = constraintRes.value.hasRegionalData ? parseRegions(constraintRes.value.regions) : [];
  } else {
    errors.push("Regional constraint not loaded");
  }

  const value: LandscapeContext = {
    clinvar,
    gnomad,
    regions,
    transcript,
    regionsBasis: "gnomAD v2 regional missense constraint (GRCh37 canonical transcript numbering)",
    errors
  };
  // Cache only a complete answer; a partial one is retried on the next request.
  if (errors.length === 0) {
    // Bounded: drop the oldest entry (Map keeps insertion order) rather than grow per gene forever.
    if (cache.size >= MAX_CACHED_GENES) cache.delete(cache.keys().next().value as string);
    cache.set(gene, { at: Date.now(), value });
  }
  return value;
}

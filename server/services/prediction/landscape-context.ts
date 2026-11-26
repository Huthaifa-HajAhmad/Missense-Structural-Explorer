import { fetchWithRetry, normalizeGeneSymbol } from "../infra/http-client.ts";
import { unversioned } from "../../../src/shared/transcriptIdentity.ts";
import type { LandscapeContext } from "../../../src/shared/contracts.ts";
import { fetchRegionalConstraint } from "./regional-constraint.ts";

/**
 * Gene-wide context for the Landscape overview: where ClinVar and gnomAD have missense variants,
 * and gnomAD's regional missense constraint. These are the facts a reader weighs for PM1
 * (hotspot / critical region without benign variation); the tab shows them and proposes no code.
 *
 * ClinVar and gnomAD come from gnomAD's GraphQL API on GRCh38, read on the transcript the residue axis
 * is built on (the run's transcript), so residue numbers match the protein drawn. gnomAD's gene-level
 * canonical transcript is used only when no transcript is named or gnomAD does not know it; it can be a
 * different isoform (ABCG1: 666 residues against the modelled 678). The regional intervals come from
 * `regional-constraint.ts`.
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

async function gnomadQuery(query: string, variables: Record<string, string>, root: "gene" | "transcript"): Promise<any> {
  const res = await fetchWithRetry(
    GNOMAD_API,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      timeout: 20000
    },
    2,
    1500
  );
  if (!res.ok) throw new Error(`gnomAD API ${res.status}`);
  const json = (await res.json()) as any;
  if (json?.errors?.length) {
    const message = String(json.errors[0]?.message ?? "gnomAD API error");
    // gnomAD reports a transcript it does not hold as an error, not as an empty result.
    if (root === "transcript" && message === "Transcript not found") return null;
    throw new Error(message);
  }
  return json?.data?.[root] ?? null;
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

/**
 * The ClinVar and gnomAD missense rows, cached as raw rows per gene and transcript so the Landscape
 * context and the Hotspots reference sets (`referenceSets`) on one transcript are one fetch: two queries
 * would double the load on gnomAD and could disagree on a ClinVar refresh between them.
 *
 * `transcript_id` names the transcript the rows' HGVSp residue numbers are on. It is the requested
 * transcript when gnomAD knows it, else gnomAD's canonical transcript for the gene: callers must compare
 * it with their own axis instead of assuming the two agree.
 */
type MissenseRows = { transcript_id: string | null; clinvar_variants?: any[]; variants?: any[] } | null;
type RawRead = PromiseSettledResult<MissenseRows>;
const rowsCache = new Map<string, { at: number; value: Promise<[RawRead, RawRead]> }>();

const CLINVAR_FIELDS = "clinvar_variants { variant_id clinical_significance gold_stars hgvsp transcript_id }";
const GNOMAD_FIELDS = "variants(dataset: gnomad_r4) { variant_id consequence hgvsp transcript_id exome { ac filters } genome { ac filters } }";

/** Two queries, so a failure in one list does not blank the other. */
function readOnGene(gene: string): Promise<[RawRead, RawRead]> {
  const read = (fields: string) =>
    gnomadQuery(`query MissenseOnGene($gene: String!) { gene(gene_symbol: $gene, reference_genome: GRCh38) { canonical_transcript_id ${fields} } }`, { gene }, "gene")
      .then((g): MissenseRows => (g ? { transcript_id: g.canonical_transcript_id ?? null, clinvar_variants: g.clinvar_variants, variants: g.variants } : null));
  return Promise.allSettled([read(CLINVAR_FIELDS), read(GNOMAD_FIELDS)]) as Promise<[RawRead, RawRead]>;
}

async function readOnTranscript(gene: string, transcript: string): Promise<[RawRead, RawRead]> {
  const read = (fields: string) =>
    gnomadQuery(`query MissenseOnTranscript($transcript: String!) { transcript(transcript_id: $transcript, reference_genome: GRCh38) { transcript_id ${fields} } }`, { transcript }, "transcript")
      .then((t): MissenseRows => (t ? { transcript_id: t.transcript_id ?? transcript, clinvar_variants: t.clinvar_variants, variants: t.variants } : null));
  const reads = await (Promise.allSettled([read(CLINVAR_FIELDS), read(GNOMAD_FIELDS)]) as Promise<[RawRead, RawRead]>);
  // gnomAD answered and does not know this transcript (a RefSeq-only or retired ID): the gene's rows are
  // the only rows there are, and they say which transcript they are numbered on.
  const unknown = reads.every((r) => r.status === "fulfilled" && r.value === null);
  return unknown ? readOnGene(gene) : reads;
}

export function fetchGeneMissenseRows(gene: string, transcript: string | null = null): Promise<[RawRead, RawRead]> {
  // gnomAD holds Ensembl transcripts only; any other id (RefSeq) gets the gene's rows.
  const bare = transcript ? unversioned(transcript) : "";
  const tx = /^ENST\d+$/.test(bare) ? bare : null;
  const key = `${gene}::${tx ?? ""}`;
  const hit = rowsCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = tx ? readOnTranscript(gene, tx) : readOnGene(gene);
  if (rowsCache.size >= MAX_CACHED_GENES) rowsCache.delete(rowsCache.keys().next().value as string);
  rowsCache.set(key, { at: Date.now(), value });
  // A failed read is retried on the next request, never served from the cache.
  void value.then(([a, b]) => { if (a.status !== "fulfilled" || b.status !== "fulfilled") rowsCache.delete(key); });
  return value;
}

const failureOf = (read: RawRead) => (read.status === "rejected" ? read.reason?.message ?? "request failed" : "gene not found");

export async function fetchLandscapeContext(geneSymbol: string, expectedTranscript: string | null = null): Promise<LandscapeContext> {
  const gene = normalizeGeneSymbol(geneSymbol).toUpperCase();
  const axisTx = expectedTranscript ? unversioned(expectedTranscript) : null;
  const cacheKey = `${gene}::${axisTx ?? "none"}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [[clinvarRes, gnomadRes], regional] = await Promise.all([
    fetchGeneMissenseRows(gene, axisTx),
    fetchRegionalConstraint(gene, axisTx),
  ]);
  const clinvarRead = clinvarRes.status === "fulfilled" ? clinvarRes.value : null;
  const gnomadRead = gnomadRes.status === "fulfilled" ? gnomadRes.value : null;
  const transcript = clinvarRead?.transcript_id ?? gnomadRead?.transcript_id ?? null;
  const errors = [
    clinvarRead ? null : `ClinVar not loaded: ${failureOf(clinvarRes)}`,
    gnomadRead ? null : `gnomAD not loaded: ${failureOf(gnomadRes)}`,
    regional.reason,
  ].filter((e): e is string => e !== null);

  const value: LandscapeContext = {
    clinvar: clinvarRead ? parseClinvar(clinvarRead.clinvar_variants ?? [], clinvarRead.transcript_id) : null,
    gnomad: gnomadRead ? parseGnomad(gnomadRead.variants ?? [], gnomadRead.transcript_id ?? transcript) : null,
    regions: regional.regions,
    regionsStatus: regional.status,
    transcript,
    regionsBasis: regional.basis,
    errors
  };
  // Cache only when every source answered; a partial answer is retried on the next request.
  if (clinvarRead && gnomadRead && !regional.sourceFailed) {
    // Bounded: drop the oldest entry (Map keeps insertion order) rather than grow per gene forever.
    if (cache.size >= MAX_CACHED_GENES) cache.delete(cache.keys().next().value as string);
    cache.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}

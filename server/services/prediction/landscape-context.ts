import { fetchWithRetry, normalizeGeneSymbol } from "../infra/http-client.ts";
import { fetchGnomadGeneConstraint } from "../external-api/gnomad.ts";
import { getConstraintIndex } from "../external-api/constraint-snapshot.ts";
import { REGIONAL_CONSTRAINT_RELEASE } from "../../../src/shared/constraintSource.ts";
import { mapGenomicIntervalToProtein } from "../../../src/shared/constraintRegionMapping.ts";
import type { LandscapeContext } from "../../../src/shared/contracts.ts";
import { fetchTranscriptExons } from "./splice_resolver.ts";

/**
 * Gene-wide context for the Landscape overview: where ClinVar and gnomAD have missense variants,
 * and gnomAD's regional missense constraint. These are the facts a reader weighs for PM1
 * (hotspot / critical region without benign variation); the tab shows them and proposes no code.
 *
 * ClinVar and gnomAD come from gnomAD's GraphQL API on GRCh38, restricted to gnomAD's canonical
 * transcript so residue numbers match the landscape's MANE numbering in the usual case (gnomAD v4
 * canonical = MANE Select for most genes). Regional v4.1.1 intervals are genomic; they are projected
 * onto the protein axis through the transcript's verified CDS model, and withheld when no model can
 * be verified rather than projected blind.
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

export async function fetchLandscapeContext(geneSymbol: string, expectedTranscript: string | null = null): Promise<LandscapeContext> {
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
  let regions: LandscapeContext["regions"] = null;
  let regionsStatus: LandscapeContext["regionsStatus"] = "unavailable";
  let regionTx: string | null = null;
  // A withheld regional map is a stable, complete answer; only a source failure is worth retrying.
  let sourceFailed = false;

  if (clinvarRes.status === "fulfilled" && clinvarRes.value) {
    transcript = clinvarRes.value.canonical_transcript_id ?? null;
    clinvar = parseClinvar(clinvarRes.value.clinvar_variants ?? [], transcript);
  } else {
    sourceFailed = true;
    errors.push(`ClinVar not loaded: ${clinvarRes.status === "rejected" ? clinvarRes.reason?.message ?? "request failed" : "gene not found"}`);
  }
  if (gnomadRes.status === "fulfilled" && gnomadRes.value) {
    transcript = transcript ?? gnomadRes.value.canonical_transcript_id ?? null;
    gnomad = parseGnomad(gnomadRes.value.variants ?? [], gnomadRes.value.canonical_transcript_id ?? transcript);
  } else {
    sourceFailed = true;
    errors.push(`gnomAD not loaded: ${gnomadRes.status === "rejected" ? gnomadRes.reason?.message ?? "request failed" : "gene not found"}`);
  }
  if (constraintRes.status !== "fulfilled") {
    sourceFailed = true;
    regionsStatus = "unavailable";
    errors.push("Regional constraint not loaded");
  } else if (!constraintRes.value?.hasRegionalData) {
    // Fulfilled null (no constraint record for this gene) or a transcript with no released interval
    // is a confirmed "no call", not an outage, so the answer stays cacheable.
    regionsStatus = "none";
    regions = [];
  } else {
    // The intervals are numbered on the constraint transcript; the lane is drawn on the transcript
    // the Landscape residue axis was built on (`expectedTranscript`). Both must be known and equal,
    // or projecting would mislabel residues.
    const constraintTx = constraintRes.value.provenance?.transcriptId ?? null;
    const axisTx = expectedTranscript?.split(".")[0] ?? null;
    const constraintVersion = constraintRes.value.provenance?.transcriptVersion ?? null;
    if (!axisTx || !constraintTx || axisTx !== constraintTx) {
      regionsStatus = "withheld-mapping";
      errors.push(`Regional map withheld: the constraint transcript ${constraintTx ?? "(none)"} does not match the landscape axis transcript ${axisTx ?? "(unknown)"}.`);
    } else {
      const structure = await fetchTranscriptExons(constraintTx, null, null, { requireCds: true });
      const cdsStart = structure?.cdsStart;
      const cdsEnd = structure?.cdsEnd;
      const cds = structure && cdsStart !== undefined && cdsEnd !== undefined && structure.exons.length > 0
        ? { strand: structure.strand, cdsStart, cdsEnd, exons: structure.exons, proteinLength: structure.proteinLength, transcriptVersion: structure.transcriptVersion }
        : null;
      if (!cds) {
        // The model source failed, or the transcript is not coding: withhold, and retry on the next
        // request rather than caching a refusal that may be transient.
        sourceFailed = true;
        regionsStatus = "withheld-mapping";
        errors.push(`Regional map withheld: no verified CDS model for ${constraintTx}.`);
      } else if (cds.transcriptVersion !== undefined && constraintVersion !== null && cds.transcriptVersion !== constraintVersion) {
        // The live exon model is a different transcript version than the pinned release. Refuse
        // rather than project through a model whose exon boundaries may have moved.
        regionsStatus = "withheld-mapping";
        errors.push(`Regional map withheld: Ensembl transcript version ${cds.transcriptVersion} differs from the pinned ${constraintVersion}.`);
      } else {
        const model = { strand: cds.strand, cdsStart: cds.cdsStart, cdsEnd: cds.cdsEnd, exons: cds.exons, proteinLength: cds.proteinLength };
        const mapped = (getConstraintIndex().regions.get(constraintTx) ?? [])
          .map((r) => ({ span: mapGenomicIntervalToProtein(model, r.start, r.end), oe: r.oe, p: r.p }))
          .filter((r): r is { span: { start: number; end: number }; oe: number; p: number } => r.span !== null)
          .map((r) => ({ start: r.span.start, end: r.span.end, oe: r.oe, pValue: r.p }))
          .sort((x, y) => x.start - y.start);
        if (mapped.length) {
          regionsStatus = "available";
          regions = mapped;
          regionTx = constraintTx;
        } else {
          // Intervals exist but none fall in coding sequence: no protein-axis call, not a withheld map.
          regionsStatus = "none";
          regions = [];
        }
      }
    }
  }

  const value: LandscapeContext = {
    clinvar,
    gnomad,
    regions,
    regionsStatus,
    transcript,
    regionsBasis: regionsStatus === "available" && regionTx
      ? `gnomAD v${REGIONAL_CONSTRAINT_RELEASE} regional missense, ${regionTx} protein residues (Ensembl CDS)`
      : `gnomAD v${REGIONAL_CONSTRAINT_RELEASE} genomic intervals`,
    errors
  };
  // Cache only when every source answered; a partial answer is retried on the next request.
  if (!sourceFailed) {
    // Bounded: drop the oldest entry (Map keeps insertion order) rather than grow per gene forever.
    if (cache.size >= MAX_CACHED_GENES) cache.delete(cache.keys().next().value as string);
    cache.set(gene, { at: Date.now(), value });
  }
  return value;
}

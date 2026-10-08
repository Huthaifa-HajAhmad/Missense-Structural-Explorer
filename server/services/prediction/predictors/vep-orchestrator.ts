import { z } from "zod";
import { predictorCache, getCachedOrFetch } from "../../infra/cache.ts";
import { normalizeGeneSymbol, normalizeVariantTo3Letter, fetchWithRetry } from "../../infra/http-client.ts";
import { buildPredictorsKey } from "../../infra/cache-keys.ts";
import { queryLocalDbnsfpVariant, readLocalDbnsfpVersion } from "../dbnsfp_local.ts";
import { safeParseFloat, toSingleAa } from "./normalizer.ts";
import { getTranscriptsForProtein } from "./transcript-resolver.ts";
import { parseGenomicCoordinateString, type PredictorData } from "../../../../src/shared/contracts.ts";
import { liftCoordinateToCanonical } from "../../translation/liftover.ts";
import { recoverCanonicalLocus, readDbnsfpGrch38, type DbnsfpGrch38, ucscGrch38Base } from "./locus-resolver.ts";
import { LOCUS_POLICY_VERSION, type LocusResolution, type LocusResolutionStep } from "../../../../src/shared/locusResolution.ts";
import type { AssemblyTaggedCoordinate } from "../../../../src/shared/assembly.ts";
import { isIntrinsicallyAmbiguousProteinChange } from "../../../../src/shared/proteinAlleleIdentity.ts";
export { isIntrinsicallyAmbiguousProteinChange } from "../../../../src/shared/proteinAlleleIdentity.ts";
import { asList, valueAtIndex } from "../landscape-aggregate.ts";
import {
  type GenomeAssembly,
  buildForwardStrandGenomicId,
  reverseComplementDna,
} from "../../../../src/shared/variantNotation.ts";

export const vepResponseSchema = z.array(z.object({
  seq_region_name: z.string().optional(),
  start: z.number().optional(),
  allele_string: z.string().optional(),
  strand: z.union([z.number(), z.string()]).optional(),
  transcript_consequences: z.array(z.object({
    transcript_id: z.string().optional(),
    /**
     * Gene identity of the consequence. VEP annotates neighbors too (a downstream_gene_variant
     * row for an adjacent gene appears in the same response — observed live for ACOT9/PRDX4),
     * so the gene filter in buildPredictorFromVep needs the field present after parsing, and
     * zod strips unknown keys by default.
     */
    gene_symbol: z.string().optional(),
    /** e.g. "K/N" — used to bind a coordinate answer to the requested substitution (review H-2). */
    amino_acids: z.string().optional(),
    protein_start: z.number().optional(),
    canonical: z.union([z.number(), z.boolean()]).optional(),
    mane_select: z.any().optional(),
    mane_plus_clinical: z.any().optional(),
    alphamissense: z.object({
      am_pathogenicity: z.any().optional(),
      am_class: z.string().optional()
    }).optional(),
    cadd_phred: z.any().optional(),
    eve_score: z.any().optional(),
    eve_class: z.any().optional()
  })).optional()
})).min(1);

type VepParsed = z.infer<typeof vepResponseSchema>;
type FailureKind = NonNullable<LocusResolution["failureKind"]>;

// Predictor-local provenance generation: old canonical fallback entries may have promoted an
// arbitrary allele from an incomplete query. Keep healthy VEP entries; retire only that policy.
export function isUsablePredictorResult(res: PredictorData, variant?: string, coord?: AssemblyTaggedCoordinate | null, gene?: string): boolean {
  if (!res || res.gnomadVariantAssembly === "GRCh37" || res.locusResolution?.retryable) return false;
  if (variant && !coord && isIntrinsicallyAmbiguousProteinChange(variant, gene) && (res.gnomadVariantId || res.caddPhred != null)) return false;
  const fallback = res.locusResolution?.route === "fallback" || /Fallback|MyVariant|dbNSFP/i.test(res.source ?? "");
  return !fallback || res.locusResolution?.policyVersion === LOCUS_POLICY_VERSION;
}

function isAlleleAmbiguity(message: string): boolean {
  return /could not uniquely determine nucleotide|ambiguous.*(?:nucleotide|allele)|multiple.*nucleotide changes/i.test(message);
}

/**
 * Consequence selection, in the platform's documented preference order:
 * MANE Select → MANE Plus Clinical → Ensembl canonical → RefSeq NM_ → any scored → first.
 */
function pickPredictorConsequence(consequences: NonNullable<VepParsed[number]["transcript_consequences"]>): any | null {
  const hasPredictor = (c: any) => c.alphamissense || c.cadd_phred !== undefined;
  let tc = consequences.find((c: any) => c.mane_select && hasPredictor(c));
  if (!tc) tc = consequences.find((c: any) => c.mane_plus_clinical && hasPredictor(c));
  if (!tc) tc = consequences.find((c: any) => (c.canonical === 1 || c.canonical === true || String(c.canonical) === "1") && hasPredictor(c));
  if (!tc) tc = consequences.find((c: any) => typeof c.transcript_id === "string" && c.transcript_id.startsWith("NM_") && hasPredictor(c));
  if (!tc) tc = consequences.find(hasPredictor);
  if (!tc) tc = consequences[0];
  return tc ?? null;
}

/**
 * Build the predictor payload from a VEP response, on EITHER query route.
 *
 * Shared by the coordinate (region) path and the protein-HGVS ladder so the two can never
 * drift in consequence preference, coordinate stamping, or MANE extraction. `assembly` is the
 * build of the host that answered — the coordinate derived from the response belongs to it, and
 * the build must travel WITH the coordinate (see the gnomadVariantAssembly contract).
 *
 * `expectedGene` filters the consequence list BEFORE selection (review H-2): VEP answers a
 * region query with every overlapping gene's transcripts — a neighbor's `downstream_gene_variant`
 * row (observed live: PRDX4 in ACOT9's response) could otherwise win the `consequences[0]`
 * fallback and stamp the payload with the wrong gene's transcript. Zero matching consequences
 * is a refusal, not a fallback.
 */
function buildPredictorFromVep(
  parsed: VepParsed,
  assembly: GenomeAssembly,
  source: string,
  canonicalEnsemblId: string | null,
  expectedGene?: string | null
): PredictorData | null {
  const first = parsed[0];
  let consequences = first?.transcript_consequences;
  if (!consequences || consequences.length === 0) return null;
  if (expectedGene) {
    const want = expectedGene.trim().toUpperCase();
    consequences = consequences.filter((c: any) => typeof c.gene_symbol === "string" && c.gene_symbol.trim().toUpperCase() === want);
    if (consequences.length === 0) return null;
  }
  const tc = pickPredictorConsequence(consequences);
  if (!tc) return null;

  const amPathogenicity = (tc.alphamissense && tc.alphamissense.am_pathogenicity !== undefined) ? safeParseFloat(tc.alphamissense.am_pathogenicity) : null;
  const amClass = (tc.alphamissense && tc.alphamissense.am_class) ? String(tc.alphamissense.am_class) : null;
  const caddPhred = tc.cadd_phred !== undefined ? safeParseFloat(tc.cadd_phred) : null;
  // Provenance for the Landscape tab's rank cross-check: which release this score came from.
  const amProvenance = amPathogenicity !== null ? "VEP AlphaMissense plugin" : undefined;

  const chr = first.seq_region_name;
  const startPos = first.start;
  const alleleStr = first.allele_string;
  const strand = first.strand;
  let gnomadVariantId: string | null = null;
  if (chr && startPos && typeof alleleStr === "string") {
    const parts = alleleStr.split("/");
    if (parts.length >= 2) {
      gnomadVariantId = buildForwardStrandGenomicId(chr, startPos, parts[0], parts[1], strand);
    }
  }

  let maneRefSeqId: string | undefined = undefined;
  if (tc.mane_select && typeof tc.mane_select === "string") {
    maneRefSeqId = tc.mane_select;
  } else if (tc.mane_select && typeof tc.mane_select === "object") {
    maneRefSeqId = tc.mane_select.refseq_match || tc.mane_select.id || undefined;
  } else if (tc.mane_plus_clinical && typeof tc.mane_plus_clinical === "string") {
    maneRefSeqId = tc.mane_plus_clinical;
  } else if (tc.mane_plus_clinical && typeof tc.mane_plus_clinical === "object") {
    maneRefSeqId = tc.mane_plus_clinical.refseq_match || tc.mane_plus_clinical.id || undefined;
  }

  return {
    available: true,
    amPathogenicity,
    amClass,
    amProvenance,
    caddPhred,
    gnomadVariantId,
    gnomadVariantAssembly: gnomadVariantId ? assembly : null,
    transcriptId: tc.transcript_id,
    isManeSelect: !!tc.mane_select,
    isManePlusClinical: !!tc.mane_plus_clinical,
    isCanonical: !!(tc.canonical === 1 || tc.canonical === true || String(tc.canonical) === "1"),
    maneRefSeqId,
    canonicalEnsemblId,
    source
  };
}

/**
 * Coordinate fallback via MyVariant.info (GRCh38 / hg38).
 *
 * When Ensembl VEP is unavailable, rate-limited, or times out, query MyVariant.info directly
 * by HGVS genomic coordinate on assembly=hg38. Validates echo, gene binding, and substitution
 * binding against dbNSFP before returning predictor data and the verified GRCh38 locus.
 */
async function fetchPredictorsViaCoordinateMyVariant(
  lifted: { chrom: string; pos: number; ref: string; alt: string },
  canonicalEnsemblId: string | null,
  expect: { gene: string; wt: string | null; mut: string | null; pos: number | null },
  deadlineAt?: number
): Promise<PredictorData | null> {
  const normChrom = lifted.chrom.replace(/^chr/i, "");
  const hgvsId = `chr${normChrom}:g.${lifted.pos}${lifted.ref}>${lifted.alt}`;
  const url = `https://myvariant.info/v1/variant/${encodeURIComponent(hgvsId)}?assembly=hg38&fields=dbnsfp.alphamissense,dbnsfp.cadd,cadd,dbnsfp.gene_name,dbnsfp.genename,dbnsfp.hgvsp,dbnsfp.aa,dbnsfp.ensembl,dbnsfp.mane`;
  try {
    const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 6000, deadlineAt }, 1);
    if (!res.ok) return null;
    const hit = await res.json() as any;
    if (!hit || typeof hit !== "object" || hit.error) return null;

    // 1. Echo: Contig, position, REF and ALT must match
    const rawId = String(hit._id ?? "").replace(/^chr/i, "");
    const wantId = `${normChrom}:g.${lifted.pos}${lifted.ref}>${lifted.alt}`;
    if (rawId.toLowerCase() !== wantId.toLowerCase()) return null;

    // 2. Gene binding check
    const wantGene = expect.gene.trim().toUpperCase();
    const rawGenes = [hit.dbnsfp?.genename, hit.dbnsfp?.gene_name].flat().filter((x: any) => x !== undefined && x !== null);
    if (rawGenes.length > 0) {
      const geneMatches = rawGenes.some((g: any) => typeof g === "string" && g.trim().toUpperCase() === wantGene);
      if (!geneMatches) return null;
    }

    // 3. Substitution binding check
    if (expect.wt && expect.mut) {
      const aaRef = [hit.dbnsfp?.aa?.ref].flat().filter(Boolean).map(String);
      const aaAlt = [hit.dbnsfp?.aa?.alt].flat().filter(Boolean).map(String);
      const aaPos = [hit.dbnsfp?.aa?.pos].flat().filter(Boolean).map(Number);
      const wantRef = expect.wt.toUpperCase();
      const wantAlt = expect.mut.toUpperCase();
      const refMatches = aaRef.some(r => r.toUpperCase() === wantRef);
      const altMatches = aaAlt.some(a => a.toUpperCase() === wantAlt);
      const posMatches = expect.pos === null || aaPos.includes(expect.pos);

      const hgvspRows = [hit.dbnsfp?.hgvsp].flat().filter(Boolean).map(String);
      const hgvspMatches = hgvspRows.some(h => {
        const hUpper = h.toUpperCase();
        return (expect.pos === null || hUpper.includes(String(expect.pos))) &&
               (hUpper.includes(wantRef) || hUpper.includes(expect.wt!)) &&
               (hUpper.includes(wantAlt) || hUpper.includes(expect.mut!));
      });

      if (aaRef.length > 0 && aaAlt.length > 0) {
        if (!refMatches || !altMatches || !posMatches) return null;
      } else if (hgvspRows.length > 0 && !hgvspMatches) {
        return null;
      }
    }

    // 4. Score extraction, read at the CANONICAL transcript's index.
    //
    // dbNSFP lists AlphaMissense once per transcript, in the same order as the transcript ids
    // MyVariant exposes at `dbnsfp.ensembl.transcriptid`. Taking entry [0] can report a different
    // isoform's score — for RGS9 p.Cys182Ser that is 0.4926 where the canonical transcript
    // (ENST00000262406) scores 0.5136, the value Ensembl VEP returns on the primary path. Match the
    // canonical id the caller resolved; when it is unknown or absent, degrade to the first entry.
    const transcriptIds = asList(hit.dbnsfp?.ensembl?.transcriptid ?? hit.dbnsfp?.ensembl_transcriptid)
      .map((t: unknown) => (typeof t === "string" ? t.trim() : ""));
    const canonicalKey = canonicalEnsemblId ? canonicalEnsemblId.split(".")[0].toUpperCase() : null;
    const canonicalIndex = canonicalKey
      ? transcriptIds.findIndex(t => t.split(".")[0].toUpperCase() === canonicalKey)
      : -1;
    const readIndex = canonicalIndex >= 0 ? canonicalIndex : 0;

    const amData = hit.dbnsfp?.alphamissense;
    let amPathogenicity: number | null = null;
    let amClass: string | null = null;
    if (amData) {
      const rawAm = Array.isArray(amData) ? amData[0] : amData;
      const scoreList = asList(rawAm.score ?? rawAm.am_pathogenicity ?? rawAm.pathogenicity);
      amPathogenicity = safeParseFloat(valueAtIndex(scoreList, readIndex, Math.max(transcriptIds.length, scoreList.length, 1)));
      const predList = asList(rawAm.pred ?? rawAm.am_class);
      const rawPred = predList.length > 1 ? predList[readIndex < predList.length ? readIndex : 0] : predList[0];
      if (rawPred) {
        const predStr = String(rawPred).toUpperCase();
        amClass = predStr === "A" ? "ambiguous" : predStr === "P" ? "pathogenic" : predStr === "B" ? "benign" : String(rawPred);
      }
    }
    // myvariant.info serves the hit but not the dbNSFP release it was built from; the tier is
    // still named so a cross-check mismatch is diagnosable rather than mysterious.
    const amProvenance = amPathogenicity !== null ? "myvariant.info dbNSFP (release not stated)" : undefined;

    const caddData = hit.dbnsfp?.cadd || hit.cadd;
    let caddPhred: number | null = null;
    if (caddData) {
      const rawCadd = Array.isArray(caddData) ? caddData[0] : caddData;
      caddPhred = safeParseFloat(rawCadd.phred ?? rawCadd.cadd_phred ?? hit.cadd_phred ?? hit.cadd?.phred);
    }

    return {
      available: true,
      amPathogenicity,
      amClass,
      amProvenance,
      caddPhred,
      gnomadVariantId: `${normChrom}-${lifted.pos}-${lifted.ref}-${lifted.alt}`,
      gnomadVariantAssembly: "GRCh38",
      transcriptId: canonicalEnsemblId ?? undefined,
      canonicalEnsemblId,
      isManeSelect: false,
      isManePlusClinical: false,
      isCanonical: Boolean(canonicalEnsemblId),
      source: "MyVariant.info & dbNSFP (coordinate fallback)",
    };
  } catch (err: any) {
    console.warn(`[MyVariant Coordinate Fallback Query] Failed for ${lifted.chrom}:${lifted.pos}: ${err?.message ?? err}`);
    return null;
  }
}

/**
 * Coordinate fallback via UCSC Reference Genome.
 *
 * Confirms that the reference base at the requested GRCh38 position matches the input coordinate.
 * Used when prediction APIs are unavailable, preserving the verified genomic locus so cohort
 * and population evidence queries (gnomAD) are not erroneously suppressed.
 */
async function fetchPredictorsViaCoordinateUcsc(
  lifted: { chrom: string; pos: number; ref: string; alt: string },
  canonicalEnsemblId: string | null
): Promise<PredictorData | null> {
  try {
    const ucsc = await ucscGrch38Base(lifted.chrom, lifted.pos);
    if ("base" in ucsc && ucsc.base.toUpperCase() === lifted.ref.toUpperCase()) {
      const normChrom = lifted.chrom.replace(/^chr/i, "");
      return {
        available: true,
        amPathogenicity: null,
        amClass: null,
        caddPhred: null,
        gnomadVariantId: `${normChrom}-${lifted.pos}-${lifted.ref}-${lifted.alt}`,
        gnomadVariantAssembly: "GRCh38",
        transcriptId: canonicalEnsemblId ?? undefined,
        canonicalEnsemblId,
        isManeSelect: false,
        isManePlusClinical: false,
        isCanonical: Boolean(canonicalEnsemblId),
        source: "UCSC Reference Sequence (coordinate fallback)",
      };
    }
  } catch (err: any) {
    console.warn(`[UCSC Coordinate Fallback Query] Failed for ${lifted.chrom}:${lifted.pos}: ${err?.message ?? err}`);
  }
  return null;
}

/**
 * Coordinate-first predictor query (unmapping defect F-1).
 *
 * The protein-HGVS ladder below is a lossy re-derivation: Ensembl's REST hgvs endpoint rejects
 * any substitution whose codon back-map is not unique (Lys→Asn has two single-nucleotide
 * solutions — verified live: "Could not uniquely determine nucleotide change"), and it checks the
 * residue against the queried transcript's OWN numbering, which fails for every gene whose MANE
 * isoform is not the canonical one this platform models. Both walls collapse the query into the
 * MyVariant GRCh37 fallback, and the fallback forfeits every GRCh38-only evidence source.
 *
 * When the caller already HAS a verified genomic coordinate — which it does whenever the user
 * entered one, because the translate step resolved it — querying the region endpoint by that
 * coordinate answers in one request with no numbering ambiguity at all.
 *
 * Binding is enforced at three levels (external review H-2: the route is public and the client
 * asserts the coordinate's build; a lying or stale `genomicCoordinates` must not be able to
 * produce a mixed-locus payload):
 *   1. echo: the response's contig, position and REF must match what was asked;
 *   2. gene: at least one consequence must belong to the requested gene (the region response
 *      also carries neighbor-gene rows, so this filter runs BEFORE consequence selection);
 *   3. substitution: some consequence must state the requested WT→MUT change, and — when the
 *      protein position parsed — at that position on some transcript (the platform's numbering
 *      is canonical-isoform, so the match is sought across transcripts, not only the selected one).
 * Any failure returns null. The caller retains submitted identity, without claiming a successful
 * VEP binding or replacing the allele via the protein-HGVS ladder.
 */
async function fetchPredictorsViaCoordinate(
  lifted: { chrom: string; pos: number; ref: string; alt: string },
  canonicalEnsemblId: string | null,
  expect: { gene: string; wt: string | null; mut: string | null; pos: number | null },
  deadlineAt?: number
): Promise<PredictorData | null> {
  const url = `https://rest.ensembl.org/vep/human/region/${encodeURIComponent(lifted.chrom)}:${lifted.pos}-${lifted.pos}/${encodeURIComponent(lifted.alt)}?content-type=application/json&AlphaMissense=1&CADD=1&mane=1`;
  try {
    const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 8000, deadlineAt }, 1);
    if (res.ok) {
      const data = await res.json();
      const parsed = vepResponseSchema.parse(data) as VepParsed;
      const first = parsed[0];
      const echoChrom = String(first.seq_region_name ?? "").replace(/^chr/i, "").toUpperCase();
      const alleles = typeof first.allele_string === "string" ? first.allele_string.split("/") : [];
      const rawRef = (alleles[0] ?? "").toUpperCase();
      const strand = first.strand;
      const isNegative = strand === -1 || strand === "-1" || strand === "-";
      const echoRef = (isNegative ? reverseComplementDna(rawRef) : rawRef).toUpperCase();
      const rawAlt = (alleles[1] ?? "").toUpperCase();
      const echoAlt = (isNegative ? reverseComplementDna(rawAlt) : rawAlt).toUpperCase();
      if (alleles.length === 2 && echoAlt === lifted.alt.toUpperCase() && echoChrom === lifted.chrom.toUpperCase() && first.start === lifted.pos && echoRef === lifted.ref.toUpperCase()) {
        const consequences = (first.transcript_consequences ?? []) as any[];
        const wantGene = expect.gene.trim().toUpperCase();
        const geneRows = consequences.filter(c => typeof c.gene_symbol === "string" && c.gene_symbol.trim().toUpperCase() === wantGene);
        if (geneRows.length > 0) {
          let changeMatches = true;
          if (expect.wt && expect.mut) {
            const wantChange = `${expect.wt}/${expect.mut}`.toUpperCase();
            changeMatches = geneRows.some(c => typeof c.amino_acids === "string" && c.amino_acids.toUpperCase() === wantChange
              && (expect.pos === null || c.protein_start === expect.pos));
          }
          if (changeMatches) {
            return buildPredictorFromVep(parsed, "GRCh38", "Ensembl VEP API (coordinate)", canonicalEnsemblId, wantGene);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[VEP Coordinate Query] Ensembl query failed for ${lifted.chrom}:${lifted.pos}: ${err?.message ?? err}`);
  }

  // ── Fallback 1: MyVariant.info by exact GRCh38 genomic coordinate ──
  const myvariantData = await fetchPredictorsViaCoordinateMyVariant(lifted, canonicalEnsemblId, expect, deadlineAt);
  if (myvariantData) {
    return myvariantData;
  }

  // ── Fallback 2: UCSC REST API reference sequence validation ──
  const ucscData = await fetchPredictorsViaCoordinateUcsc(lifted, canonicalEnsemblId);
  if (ucscData) {
    return ucscData;
  }

  return null;
}

/**
 * A failure another attempt could change: an outage, a timeout, a dropped connection or an open
 * circuit breaker — as opposed to Ensembl stating something about the notation itself (a 400 such as
 * "Could not uniquely determine nucleotide change"), which a retry will only repeat.
 */
export function isTransientLookupFailure(message: string): boolean {
  return /\b(5\d\d|429)\b|timed? ?out|timeout|abort|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network|circuit|unavailable/i.test(message);
}

/**
 * The fallback branch: MyVariant.info / dbNSFP scores and locus, then recovery of the GRCh38 locus.
 *
 * @param prior  what the ladder already attempted, carried into the payload's `locusResolution` so the
 *               trail names every rung, and whether any of those failures was transient.
 */
export async function fetchPredictorsFallback(
  gene: string,
  variant: string,
  uniprotId?: string,
  prior: { steps: LocusResolutionStep[]; transient: boolean; failureKind?: FailureKind; coordinate?: AssemblyTaggedCoordinate } = { steps: [], transient: false }
): Promise<PredictorData> {
  const steps: LocusResolutionStep[] = [...prior.steps];
  let transient = prior.transient;
  const intrinsicAmbiguity = !prior.coordinate && isIntrinsicallyAmbiguousProteinChange(variant, gene);
  let failureKind = intrinsicAmbiguity ? "ambiguous-allele" as const : prior.failureKind;
  const knownAmbiguity = failureKind === "ambiguous-allele";
  if (intrinsicAmbiguity) steps.push({ step: "vep-hgvs", outcome: "failed", detail: "standard nuclear genetic code permits multiple single-base alleles for every possible reference codon" });
  // Explicit input already identifies the allele. Protein fallback may supply protein scores,
  // but cannot override that identity or provide another allele's CADD.
  const coordinateOnly = Boolean(prior.coordinate);
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  
  let transcriptId: string | undefined = undefined;
  let maneRefSeqId: string | undefined = undefined;
  let canonicalEnsemblId: string | null = null;
  let isManeSelect = false;
  if (uniprotId) {
    try {
      const transcripts = await getTranscriptsForProtein(uniprotId);
      if (transcripts.ensemblId) transcriptId = transcripts.ensemblId;
      if (transcripts.refseqId) maneRefSeqId = transcripts.refseqId;
      canonicalEnsemblId = transcripts.canonicalEnsemblId ?? null;
      if (transcripts.isManeSelect) isManeSelect = true;
    } catch (_) {}
  }

  const posMatch = variant.match(/\d+/);
  const pos = posMatch ? parseInt(posMatch[0], 10) : null;

  let amPathogenicity: number | null = null;
  let amClass: string | null = null;
  let amProvenance: string | undefined = undefined;
  let caddPhred: number | null = null;
  let gnomadVariantId: string | null = null;
  /** dbNSFP's own GRCh38 position for the matched record — the independent recovery route. */
  let dbnsfpGrch38: DbnsfpGrch38 | null = null;

  // 1. Check local dbNSFP first if available
  if (pos !== null) {
    try {
      const localData = await queryLocalDbnsfpVariant(normGene, pos, null, null, cleanVar);
      if (localData) {
        if (localData.alphamissense !== undefined && localData.alphamissense !== null) {
          amPathogenicity = safeParseFloat(localData.alphamissense);
          amClass = amPathogenicity !== null ? (amPathogenicity >= 0.564 ? "likely_pathogenic" : amPathogenicity <= 0.34 ? "likely_benign" : "ambiguous") : null;
          amProvenance = amPathogenicity !== null ? readLocalDbnsfpVersion() ?? "local dbNSFP (version not recorded)" : undefined;
        }
        // Local protein-row CADD is allele-specific and has not been bound to a verified
        // genomic identity. Only the matched, fully queried MyVariant allele may supply it.
      }
    } catch (_) {}
  }

  // 2. Query MyVariant.info for AlphaMissense & CADD — and ALWAYS for the locus.
  //    The local ingest can supply both scores, and this branch used to be skipped then, leaving the
  //    run with no genomic locus at all: every coordinate-keyed source (gnomAD r4 first) then refused
  //    a coordinate that was never looked up, and the refusal read as a build problem.
  {
    try {
      const cleanVarLower = cleanVar.toLowerCase();
      const mutMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
      const term1 = mutMatch ? `p.${toSingleAa(mutMatch[1])}${mutMatch[2]}${toSingleAa(mutMatch[3])}`.toLowerCase() : "";

      const queryStr = pos !== null
        ? `dbnsfp.genename:${normGene} AND (dbnsfp.hgvsp:"p.${cleanVar}" OR dbnsfp.aa.pos:${pos})`
        : `dbnsfp.genename:${normGene} AND dbnsfp.hgvsp:"p.${cleanVar}"`;
      const url = `https://myvariant.info/v1/query?q=${encodeURIComponent(queryStr)}&fields=dbnsfp.alphamissense,dbnsfp.cadd,cadd.phred,cadd_phred,dbnsfp.hgvsp,dbnsfp.aa.pos,dbnsfp.hg38,dbnsfp.chrom,dbnsfp.ref,dbnsfp.alt&limit=50`;
      const res = await fetchWithRetry(url, { headers: { "Accept": "application/json" }, timeout: 8000 }, 1);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.hits && Array.isArray(data.hits)) {
          /**
           * Locus-ambiguity refusal (external review M-3): the hgvsp test is a substring match,
           * and dbNSFP lists per-transcript notations — so a DIFFERENT genomic locus whose some
           * isoform happens to number the same substitution identically also matches (ACOT9 has
           * 4 positions where canonical and isoform-4 both carry K; 16/400 letters coincide).
           * Previously the first match's `_id` was adopted and the build gate merely refused it;
           * now that the fallback lifts, a coincidental locus would be promoted to TRUSTED
           * GRCh38 evidence. So: scan every hit, and if more than one distinct locus matches,
           * refuse the coordinate entirely — protein-level AlphaMissense stays, allele-level
           * CADD and locus-keyed evidence (geometry, gnomAD, AlphaGenome) decline, mirroring the
           * AMBIGUOUS_PROTEIN_NUMBERING policy of the translate route.
           */
          const matchedLoci = new Set<string>();
          for (const hit of data.hits) {
            const hgvsp = Array.isArray(hit.dbnsfp?.hgvsp) ? hit.dbnsfp.hgvsp : [hit.dbnsfp?.hgvsp];
            const matchesVar = hgvsp.some((h: any) => {
              if (typeof h !== "string") return false;
              const hl = h.toLowerCase();
              return hl.includes(cleanVarLower) || (term1 && hl.includes(term1));
            });

            // Strict No-Heuristics: ONLY accept data if this hit explicitly matches the requested variant substitution!
            if (matchesVar) {
              const amData = hit.dbnsfp?.alphamissense;
              const caddData = hit.dbnsfp?.cadd || hit.cadd;

              if (amData && amPathogenicity === null) {
                const rawAm = Array.isArray(amData) ? amData[0] : amData;
                amPathogenicity = safeParseFloat(rawAm.am_pathogenicity ?? rawAm.score ?? rawAm.pathogenicity);
                amClass = rawAm.am_class ? String(rawAm.am_class) : (rawAm.pred ? String(rawAm.pred) : null);
                amProvenance = amPathogenicity !== null ? "myvariant.info dbNSFP (release not stated)" : undefined;
              }
              if (caddData && caddPhred === null) {
                const rawCadd = Array.isArray(caddData) ? caddData[0] : caddData;
                caddPhred = safeParseFloat(rawCadd.phred ?? rawCadd.cadd_phred ?? hit.cadd_phred ?? hit.cadd?.phred);
              }
              if (hit._id && typeof hit._id === "string" && hit._id.startsWith("chr")) {
                const m = hit._id.match(/chr([0-9XYM]+):g\.(\d+)([A-Z]+)>([A-Z]+)/i);
                if (m) {
                  const locusId = `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
                  matchedLoci.add(locusId);
                  if (gnomadVariantId === null) {
                    gnomadVariantId = locusId;
                    dbnsfpGrch38 = readDbnsfpGrch38(hit);
                  }
                }
              }
            }
          }
          // MyVariant returns a bounded page. A single hit is not proof of uniqueness if
          // more records exist (or the response explicitly reports truncation).
          const incomplete = data.truncated === true || data.has_more === true ||
            data.next != null || data.next_page != null ||
            (data.total != null && (typeof data.total !== "number" || !Number.isInteger(data.total) || data.total < 0 || data.total !== data.hits.length)) ||
            (data.total == null && data.hits.length >= 50);
          if (coordinateOnly) {
            gnomadVariantId = null;
            dbnsfpGrch38 = null;
            caddPhred = null;
            steps.push({ step: "myvariant", outcome: "skipped", detail: "protein scores only; database alleles cannot replace the submitted coordinate" });
          } else if (matchedLoci.size > 1 || knownAmbiguity) {
            failureKind = "ambiguous-allele";
            console.warn(`[VEP Fallback] ${matchedLoci.size} distinct MyVariant loci match ${normGene} ${cleanVar} by notation; refusing the coordinate as ambiguous.`);
            gnomadVariantId = null;
            dbnsfpGrch38 = null;
            caddPhred = null;
            steps.push({ step: "myvariant", outcome: "failed", detail: knownAmbiguity ? "canonical/MANE HGVS already proved allele ambiguity; database hits cannot establish uniqueness" : `${matchedLoci.size} distinct alleles match this notation; refused as ambiguous` });
          } else if (incomplete) {
            failureKind = "incomplete-evidence";
            gnomadVariantId = null;
            dbnsfpGrch38 = null;
            caddPhred = null;
            steps.push({ step: "myvariant", outcome: "failed", detail: "truncated MyVariant results cannot establish a unique allele" });
          } else if (gnomadVariantId) {
            steps.push({ step: "myvariant", outcome: "ok", detail: `dbNSFP record at GRCh37 ${gnomadVariantId}` });
          } else {
            steps.push({ step: "myvariant", outcome: "failed", detail: "no dbNSFP record matched this gene and substitution" });
          }
        } else {
          steps.push({ step: "myvariant", outcome: "failed", detail: "MyVariant.info answered with no hits" });
        }
      } else {
        transient ||= isTransientLookupFailure(`HTTP ${res.status}`);
        steps.push({ step: "myvariant", outcome: "failed", detail: `MyVariant.info answered HTTP ${res.status}` });
      }
    } catch (err: any) {
      transient = true;
      steps.push({ step: "myvariant", outcome: "failed", detail: `MyVariant.info unreachable (${String(err?.message ?? err).slice(0, 80)})` });
    }
  }

  /**
   * Recover the GRCh38 locus for the hg19 `_id` (unmapping defect F-3, at its producer).
   *
   * The MyVariant `_id` is GRCh37 and its query service has no assembly parameter. A GRCh37 locus is
   * honest but terminal: every GRCh38-only source refuses it. `recoverCanonicalLocus` tries the
   * verified Ensembl lift and then dbNSFP's own GRCh38 position checked against the UCSC reference —
   * two routes on two different hosts, because the Ensembl one shares the breaker with the very VEP
   * queries whose failure brought the run here. A locus neither route can verify stays GRCh37, tagged.
   */
  let gnomadVariantAssembly: GenomeAssembly | null = null;
  let canonicalBy: LocusResolution["canonicalBy"] = null;
  if (knownAmbiguity || failureKind === "ambiguous-allele" || coordinateOnly) {
    gnomadVariantId = null;
    dbnsfpGrch38 = null;
    caddPhred = null;
  }
  if (prior.coordinate) {
    const c = prior.coordinate;
    // The input identity remains in the request/trail, not in queryable evidence IDs:
    // a failed gene/substitution binding must not authorize unrelated cohort evidence.
    steps.push({ step: "vep-coordinate", outcome: "failed", detail: `retained submitted ${c.assembly} ${c.chrom}:${c.pos}${c.ref}>${c.alt}; no verified gene/substitution binding` });
  } else if (gnomadVariantId) {
    const recovered = await recoverCanonicalLocus(gnomadVariantId, dbnsfpGrch38);
    gnomadVariantId = recovered.id;
    gnomadVariantAssembly = recovered.assembly;
    canonicalBy = recovered.canonicalBy;
    steps.push(...recovered.steps);
    transient ||= recovered.retryable;
  }
  if (!gnomadVariantId) caddPhred = null;
  const definitive = failureKind === "ambiguous-allele" || failureKind === "incomplete-evidence";
  const retryable = canonicalBy === null && !definitive && transient;
  const locusResolution: LocusResolution = {
    route: "fallback",
    canonicalBy,
    retryable,
    ...(canonicalBy === null ? { failureKind: definitive ? failureKind : retryable ? "transient-provider" as const : failureKind ?? "not-found" as const } : {}),
    policyVersion: LOCUS_POLICY_VERSION,
    steps: steps.slice(-12),
  };

  const hasAnyData = amPathogenicity !== null || caddPhred !== null || Boolean(transcriptId);
  return {
    available: hasAnyData,
    amPathogenicity,
    amClass,
    amProvenance,
    caddPhred,
    gnomadVariantId,
    gnomadVariantAssembly,
    locusResolution,
    transcriptId,
    maneRefSeqId,
    canonicalEnsemblId,
    isManeSelect: Boolean(isManeSelect),
    isCanonical: Boolean(transcriptId),
    source: (amPathogenicity !== null || caddPhred !== null) ? "MyVariant.info & dbNSFP (VEP Fallback)" : "UniProt Transcript Fallback"
  };
}

export async function fetchPredictorData(
  gene: string,
  variant: string,
  uniprotId?: string,
  /**
   * The genomic coordinate the protein notation was TRANSLATED FROM, build-tagged, when the
   * caller has one (a genomic/cDNA input). Used for the coordinate-first query above; ignored
   * for protein-only inputs, which keep the legacy ladder.
   */
  coord?: AssemblyTaggedCoordinate | null
): Promise<PredictorData> {
  const normGene = normalizeGeneSymbol(gene);
  const cleanVar = normalizeVariantTo3Letter(variant);
  // The coordinate participates in the cache key (review H2): a coordinate-first result is
  // computed at a specific locus, and the same protein substitution can sit at two loci
  // (p.Lys272Asn from C>A and from C>G — same codon, different nucleotide, different
  // CADD/SpliceAI/gnomAD answer). Keying without it lets one request's locus serve another's.
  const cacheKey = buildPredictorsKey(gene, variant, uniprotId, coord ?? null);
  const intrinsicAmbiguity = !coord && isIntrinsicallyAmbiguousProteinChange(variant, gene);

  return getCachedOrFetch({
    key: cacheKey,
    source: "Ensembl VEP API",
    l1Cache: predictorCache,
    ttlSeconds: 14 * 24 * 60 * 60,
    /**
     * Do not pin a GRCh37-coordinate result for 14 days (unmapping defect F-4).
     *
     * The fallback coordinate is what the build gate refuses; caching it behind a key that has
     * no build dimension turned a TRANSIENT VEP/liftover outage into a two-week blind panel for
     * every user of the same variant. A healthy canonical result or a definitive refusal keeps
     * the long TTL. Retryable failures (including null IDs) and GRCh37 entries are rejected on
     * BOTH writes and reads. Legacy fallback policy entries cannot prove allele uniqueness.
     */
    shouldCache: res => isUsablePredictorResult(res, variant, coord, gene),
    isUsable: res => isUsablePredictorResult(res, variant, coord, gene),
    fetcher: async () => {
      let transcriptRefseqId: string | null = null;
      let transcriptEnsemblId: string | null = null;
      let canonicalEnsemblId: string | null = null;
      if (uniprotId) {
        try {
          const transcripts = await getTranscriptsForProtein(uniprotId);
          transcriptRefseqId = transcripts.refseqId;
          transcriptEnsemblId = transcripts.ensemblId;
          canonicalEnsemblId = transcripts.canonicalEnsemblId ?? null;
        } catch (_) {}
      }

      /** The locus trail for this run, carried onto whichever branch answers. */
      const steps: LocusResolutionStep[] = [];
      if (intrinsicAmbiguity) steps.push({ step: "vep-hgvs", outcome: "failed", detail: "standard nuclear genetic code permits multiple single-base alleles for every possible reference codon" });
      let transient = false;
      const withTrail = (data: PredictorData, route: LocusResolution["route"]): PredictorData => ({
        ...data,
        ...(intrinsicAmbiguity ? { caddPhred: null, gnomadVariantId: null, gnomadVariantAssembly: null } : {}),
        locusResolution: {
          route,
          canonicalBy: !intrinsicAmbiguity && data.gnomadVariantAssembly === "GRCh38" ? "vep" : null,
          retryable: false,
          policyVersion: LOCUS_POLICY_VERSION,
          ...(intrinsicAmbiguity ? { failureKind: "ambiguous-allele" as const } : {}),
          steps: steps.slice(-12),
        },
      });

      // ── Coordinate-first: one unambiguous query beats a ladder of lossy ones ──
      if (coord) {
        // What the coordinate must PROVE it is (review H-2): the requested substitution,
        // parsed from the same notation the structural arm models. Position and letters are
        // canonical-isoform values, so the binding check looks for them on ANY consequence of
        // the requested gene, not on the selected one.
        const aaMatch = variant.match(/([a-zA-Z]{1,3})[=:/]?(\d+)[=:/]?([a-zA-Z]{1,3})/i);
        const expect = {
          gene: normGene,
          wt: aaMatch ? toSingleAa(aaMatch[1]) : null,
          mut: aaMatch ? toSingleAa(aaMatch[3]) : null,
          pos: aaMatch ? parseInt(aaMatch[2], 10) : null
        };
        // The lift + region query is an auxiliary prelude to the ladder, and the analysis
        // stream has a 30 s client-side idle watchdog — bound the prelude so a slow Ensembl
        // degrades to the ladder instead of stalling chunk 1 (review M4).
        const coordDeadline = Date.now() + 15_000;
        const lifted = await liftCoordinateToCanonical(coord, { deadlineAt: coordDeadline }).catch(() => null);
        if (lifted) {
          const viaCoordinate = await fetchPredictorsViaCoordinate(lifted, canonicalEnsemblId, expect, coordDeadline);
          if (viaCoordinate) {
            steps.push({ step: "vep-coordinate", outcome: "ok", detail: `region ${lifted.chrom}:${lifted.pos} via ${viaCoordinate.source}` });
            return withTrail(viaCoordinate, "vep-coordinate");
          }
          steps.push({ step: "vep-coordinate", outcome: "failed", detail: "the region query did not answer or did not bind to this gene and substitution" });
          // A coordinate that cannot prove it is this variant's locus falls through to the
          // ladder; it is never coerced, and the ladder's own fallback keeps the honest build tag.
        } else {
          steps.push({ step: "vep-coordinate", outcome: "skipped", detail: "the submitted coordinate could not be placed on GRCh38" });
        }
        // The submitted allele must not be replaced by a protein-HGVS or database guess
        // when its region lookup is unavailable. Keep its identity and only protein scores.
        return fetchPredictorsFallback(gene, variant, uniprotId, {
          steps, transient: true, coordinate: lifted ? { ...lifted, assembly: "GRCh38" } : coord,
        });
      }

      let queryTargets: string[] = [];
      if (transcriptRefseqId && transcriptRefseqId.startsWith("NM_")) {
        queryTargets.push(`${transcriptRefseqId}:p.${cleanVar}`);
        const cleanRefseq = transcriptRefseqId.split(".")[0];
        if (cleanRefseq !== transcriptRefseqId) {
          queryTargets.push(`${cleanRefseq}:p.${cleanVar}`);
        }
      }
      if (transcriptEnsemblId) {
        queryTargets.push(`${transcriptEnsemblId}:p.${cleanVar}`);
        const cleanEnsembl = transcriptEnsemblId.split(".")[0];
        if (cleanEnsembl !== transcriptEnsemblId) {
          queryTargets.push(`${cleanEnsembl}:p.${cleanVar}`);
        }
      }
      // The CANONICAL transcript's own numbering is what the platform feeds in (the isoform remap
      // guarantees it), so for MANE≠canonical genes this target succeeds exactly where every
      // MANE target fails a residue check (unmapping defect F-2).
      if (canonicalEnsemblId && canonicalEnsemblId !== transcriptEnsemblId) {
        queryTargets.push(`${canonicalEnsemblId}:p.${cleanVar}`);
        const cleanCanonical = canonicalEnsemblId.split(".")[0];
        if (cleanCanonical !== canonicalEnsemblId) {
          queryTargets.push(`${cleanCanonical}:p.${cleanVar}`);
        }
      }
      queryTargets.push(`${normGene}:p.${cleanVar}`);

      let parsedData: VepParsed | null = null;
      const errors: string[] = [];
      let ambiguousAllele = false;
      const cleanId = (id: string | null) => id?.split(".")[0] ?? null;
      const canonicalTarget = cleanId(canonicalEnsemblId);
      const maneMatchesCanonical = canonicalTarget && canonicalTarget === cleanId(transcriptEnsemblId);
      // The input protein numbering belongs to canonical. An unrelated MANE isoform's
      // ambiguity cannot veto a successfully bound canonical target.
      const authoritativeIds = new Set((canonicalTarget
        ? [canonicalEnsemblId, ...(maneMatchesCanonical ? [transcriptRefseqId] : [])]
        : [transcriptRefseqId, transcriptEnsemblId])
        .filter((id): id is string => Boolean(id)).map(id => id.split(".")[0]));
      const recordFailure = (target: string, message: string) => {
        errors.push(`${target}: ${message}`);
        transient ||= isTransientLookupFailure(message);
        // Gene-symbol HGVS has no guaranteed isoform numbering. Only explicit MANE /
        // canonical transcript targets can make a definitive statement about this allele.
        if (authoritativeIds.has(target.split(":")[0].split(".")[0]) && isAlleleAmbiguity(message)) ambiguousAllele = true;
        steps.push({ step: "vep-hgvs", outcome: "failed", detail: `${target}: ${message}`.slice(0, 300) });
      };

      for (const target of [...new Set(queryTargets)]) {
        const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(target)}?content-type=application/json&AlphaMissense=1&CADD=1&mane=1`;
        try {
          console.log(`[VEP Fetch] Querying target: ${target}`);
          const res = await fetchWithRetry(url, {
            headers: { "Accept": "application/json" },
            timeout: 8000
          }, 1);
          if (res.ok) {
            const data = await res.json() as any;
            parsedData = vepResponseSchema.parse(data);
            const targetIsAligned = !canonicalTarget || authoritativeIds.has(target.split(":")[0].split(".")[0]);
            if (parsedData.length > 0 && parsedData[0].transcript_consequences && !ambiguousAllele && targetIsAligned &&
                buildPredictorFromVep(parsedData, "GRCh38", "Ensembl VEP API", canonicalEnsemblId, normGene)) {
              console.log(`[VEP Fetch] Successfully resolved predictors via target: ${target}`);
              break;
            }
            parsedData = null;
            recordFailure(target, "no bound transcript consequence for this notation");
          } else {
            const errText = await res.text().catch(() => "");
            recordFailure(target, `Status ${res.status}: ${errText}`);
          }
        } catch (err: any) {
          recordFailure(target, err.message || String(err));
        }
      }

      try {
        if (parsedData && parsedData.length > 0 && parsedData[0].transcript_consequences) {
          const resVal = buildPredictorFromVep(parsedData, "GRCh38", "Ensembl VEP API", canonicalEnsemblId, normGene);
          if (resVal) {
            steps.push({ step: "vep-hgvs", outcome: "ok" });
            return withTrail(resVal, "vep-hgvs");
          }
        }
      } catch (err: any) {
        console.warn(`[Predictors Fetch Error] Failed to parse VEP predictors response: ${err.message}`);
      }

      const ladderFailure = errors.join("; ") || "no transcript consequence for this notation";
      if (!errors.length) steps.push({ step: "vep-hgvs", outcome: "failed", detail: ladderFailure });
      console.log(`[VEP Fallback] Ensembl VEP unavailable or incomplete for ${normGene} ${cleanVar} (${ladderFailure.slice(0, 120)}); falling back to MyVariant & UniProt`);
      return await fetchPredictorsFallback(gene, variant, uniprotId, {
        steps, transient, ...(ambiguousAllele ? { failureKind: "ambiguous-allele" as const } : {}),
      });
    }
  });
}

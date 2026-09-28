/**
 * assembly.ts — Single source of truth for genome-build policy across the pipeline.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The application supports two human genome builds, but the build was only ever tracked
 * inside the translation route: `assembly` is detected from an inline annotation, used to
 * pick the right Ensembl host, echoed to the client — and then dropped. The analysis
 * request had no assembly field at all, so every coordinate-consuming service downstream
 * silently assumed GRCh38.
 *
 * That is not a cosmetic gap. Most of the evidence sources are single-build:
 *   GPN-Star            GRCh38-only Tabix index
 *   local dbNSFP        hg38 columns
 *   Genos               sends `genome_build: 'hg38'`
 *   dbnsfp.org          sends `genome_build: 'hg38'`
 *   SpliceAI Lookup     separate service per build, client defaulted to GRCh38
 *   MyVariant.info      `_id` is hg19 by default, and was parsed as though it were GRCh38
 *
 * Feeding a GRCh37 coordinate to a GRCh38 service fails in one of two ways, and the second
 * is the dangerous one: the service either rejects it (loud, safe) or — when the GRCh38
 * base at that numeric position happens to match the supplied REF, which is common — it
 * accepts and scores a *different locus*, returning plausible numbers attributed to this
 * variant. Silent wrongness in a clinical report is worse than a missing value.
 *
 * THE POLICY, and why it is shaped this way
 * -----------------------------------------
 * 1. Every build-dependent consumer DECLARES the builds it can serve (`ASSEMBLY_SUPPORT`).
 *    Unknown consumers are treated as build-naive rather than assumed compatible.
 * 2. Coordinates are LIFTED to the canonical build when the input build differs, and the
 *    lift is REVERSE-VERIFIED before use (`reverseVerified`). A lift is only ever accepted
 *    when mapping back reproduces the original position exactly.
 *    (Implemented in `server/services/translation/liftover.ts`; applied at the coordinate
 *    producers, so consumers see one canonical-build coordinate or an honest refusal.)
 * 3. When a lift cannot be verified, or a coordinate's build is unknown, the evidence is
 *    reported as UNAVAILABLE (or unavailable-unless-provable) — never coerced, never
 *    guessed. Absence is a truthful answer; a wrong-build score is not.
 *
 * Canonicalising to one build is what Ensembl VEP and gnomAD themselves do, so it also
 * means a GRCh37 and a GRCh38 query for the same variant converge on identical evidence
 * rather than diverging.
 *
 * BOUNDARY CONTRACT
 * -----------------
 * Imported by BOTH `server/` and `src/`. Pure: no imports outside `src/shared/`
 * (enforced by scripts/check-boundaries.ts).
 */
import type { GenomeAssembly } from "./variantNotation.ts";
import {
  ACCESSIONED_CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  detectAssemblyAnnotation,
  normalizeGenomicNotation,
  parseGenomicHgvsNotation,
  referenceSequenceOf,
  releaseTokenFor,
} from "./variantNotation.ts";

/** The build every single-build service in this application is pinned to. */
export const CANONICAL_ASSEMBLY: GenomeAssembly = "GRCh38";

/** Human-facing labels, for provenance rows and error messages. */
export const ASSEMBLY_LABELS: Record<GenomeAssembly, string> = {
  GRCh37: "GRCh37 / hg19",
  GRCh38: "GRCh38 / hg38",
};

/**
 * Declared build support for every coordinate-consuming source.
 *
 * `["GRCh37", "GRCh38"]` means the source is build-aware (it is told the build, or has a
 * service per build). A single-element array means the source is pinned to that build and
 * MUST NOT receive a coordinate from the other one.
 *
 * Keeping this in one table is the point: previously each source hard-coded its own build
 * (`'hg38'`, `GRCh38`, `reference_genome: GRCh37`) with nothing recording the obligation,
 * so a caller had no way to know a mismatch was even possible.
 */
export const ASSEMBLY_SUPPORT = {
  "ensembl-vep": ["GRCh37", "GRCh38"],
  "variant-validator": ["GRCh37", "GRCh38"],
  "spliceai-lookup": ["GRCh37", "GRCh38"],
  /** hg38-only Tabix index (songlab/gpn-msa-hg38-scores). */
  "gpn-star": ["GRCh38"],
  /** AlphaGenome Atlas holds GRCh38 SNVs; the model inputs GRCh38 sequence. */
  alphagenome: ["GRCh38"],
  /** PopEVE is matched against `popeve_grch38.vcf.gz` on chrom/pos/ref/alt. */
  popEVE: ["GRCh38"],
  /** Splice-junction geometry is resolved against GRCh38 Ensembl exon boundaries. */
  "splice-proximity": ["GRCh38"],
  /** Local dbNSFP SQLite ingest carries hg38 columns only. */
  "dbnsfp-local": ["GRCh38"],
  /** Requests hard-code `genome_build: 'hg38'`. */
  genos: ["GRCh38"],
  dbnsfpOrg: ["GRCh38"],
  /** gnomAD r4 variant ids are GRCh38. */
  "gnomad-variants": ["GRCh38"],
  /** Gene-level constraint aggregates; no coordinates cross the boundary. */
  "gnomad-constraint": ["GRCh37", "GRCh38"],
  /** RefSeq transcript sequences are assembly-independent by construction. */
  "uniprot-sequence": ["GRCh37", "GRCh38"],
} as const satisfies Record<string, readonly GenomeAssembly[]>;

export type AssemblyAwareSource = keyof typeof ASSEMBLY_SUPPORT;

/** Whether a source can be given a coordinate from the supplied build. */
export function sourceSupportsAssembly(
  source: AssemblyAwareSource,
  assembly: GenomeAssembly
): boolean {
  return (ASSEMBLY_SUPPORT[source] as readonly GenomeAssembly[]).includes(assembly);
}

/** The builds a source can serve. Useful for wording "this source covers GRCh38 only". */
export function supportedAssemblies(source: AssemblyAwareSource): readonly GenomeAssembly[] {
  return ASSEMBLY_SUPPORT[source];
}

/** The build a coordinate is expressed in. */
export interface AssemblyTaggedCoordinate {
  chrom: string;
  pos: number;
  ref: string;
  alt: string;
  /** The build these numeric coordinates belong to. */
  assembly: GenomeAssembly;
}

/**
 * One canonical spelling for a contig name, shared by every component that compares a
 * variant's contig to a transcript's (the splice resolver) or interpolates one into a URL
 * (the liftover). The two sides used to carry private normalizers that disagreed on the
 * one case that matters: GRCh38 names the mitochondrion "MT" while variant callers write
 * "chrM" — with per-side helpers, an MT variant refused its own geometry (review L-8).
 */
export function normalizeContigName(chrom: string): string {
  const c = chrom.trim().replace(/^chr/i, "").toUpperCase();
  return c === "M" ? "MT" : c;
}

/** Whether two contig names denote the same chromosome. */
export function sameContig(a: string, b: string): boolean {
  return normalizeContigName(a) === normalizeContigName(b);
}

/**
 * NCBI RefSeq chromosome accessions, per build — the one place the accession↔contig↔build
 * relationship is written down.
 *
 * WHY
 * ---
 * `NC_000001.10:g.1256452C>A` is a GRCh37 coordinate and `NC_000001.11:g.1321072C>A` is the SAME
 * variant on GRCh38: the RefSeq accession differs per build and encodes it. Two things depend on
 * that fact, and neither could be answered before:
 *   - the coordinate gate accepts RefSeq accessions, so a caller stating `NC_000001.10` HAS
 *     declared a build, whether or not it also wrote `(GRCh37)`;
 *   - a lift needs a canonical Ensembl contig (`/map/human/GRCh37/1:…/GRCh38`), and the accession
 *     is not one.
 * The alternative — inferring the build from the numeric position — is the wrong-locus hazard at
 * the top of this file, so the accession is the only inference this module makes, and it refuses
 * to guess for an accession it does not know.
 *
 * Mitochondrial DNA is deliberately present in BOTH builds under the same accession
 * (`NC_012920.1`, the rCRS): it carries no build information, which is why the lookup returns
 * contig and build separately and callers treat "same accession in both" as no signal.
 *
 * VERIFIED, not recalled: all 50 accessions were checked against their NCBI nuccore summaries (the
 * record's own title names both the chromosome and the assembly), because a mislabelled accession
 * would route a lift at the wrong contig. Re-run that check if this table is ever edited.
 */
export const REFSEQ_CHROMOSOME_ACCESSIONS = {
  GRCh37: {
    "NC_000001.10": "1",
    "NC_000002.11": "2",
    "NC_000003.11": "3",
    "NC_000004.11": "4",
    "NC_000005.9": "5",
    "NC_000006.11": "6",
    "NC_000007.13": "7",
    "NC_000008.10": "8",
    "NC_000009.11": "9",
    "NC_000010.10": "10",
    "NC_000011.9": "11",
    "NC_000012.11": "12",
    "NC_000013.10": "13",
    "NC_000014.8": "14",
    "NC_000015.9": "15",
    "NC_000016.9": "16",
    "NC_000017.10": "17",
    "NC_000018.9": "18",
    "NC_000019.9": "19",
    "NC_000020.10": "20",
    "NC_000021.8": "21",
    "NC_000022.10": "22",
    "NC_000023.10": "X",
    "NC_000024.9": "Y",
    "NC_012920.1": "MT",
  },
  GRCh38: {
    "NC_000001.11": "1",
    "NC_000002.12": "2",
    "NC_000003.12": "3",
    "NC_000004.12": "4",
    "NC_000005.10": "5",
    "NC_000006.12": "6",
    "NC_000007.14": "7",
    "NC_000008.11": "8",
    "NC_000009.12": "9",
    "NC_000010.11": "10",
    "NC_000011.10": "11",
    "NC_000012.12": "12",
    "NC_000013.11": "13",
    "NC_000014.9": "14",
    "NC_000015.10": "15",
    "NC_000016.10": "16",
    "NC_000017.11": "17",
    "NC_000018.10": "18",
    "NC_000019.10": "19",
    "NC_000020.11": "20",
    "NC_000021.9": "21",
    "NC_000022.11": "22",
    "NC_000023.11": "X",
    "NC_000024.10": "Y",
    "NC_012920.1": "MT",
  },
} as const satisfies Record<GenomeAssembly, Record<string, string>>;

/** Contigs the Ensembl `map` endpoint addresses by bare name. */
const CANONICAL_CONTIGS = new Set([
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17",
  "18", "19", "20", "21", "22", "X", "Y", "MT",
]);

/** True for a contig the assembly-map endpoint can address (1..22, X, Y, MT). */
export function isCanonicalContig(contig: string): boolean {
  return CANONICAL_CONTIGS.has(normalizeContigName(contig));
}

/**
 * Resolves a contig token to the canonical Ensembl contig the assembly map uses.
 *
 * Returns `null` for anything that is not a bare contig or a KNOWN RefSeq chromosome accession —
 * an unknown accession is never guessed at, because a wrong contig would silently lift some other
 * locus into the analysis.
 */
export function canonicalContigOf(token: string): string | null {
  const normalized = token.trim().toUpperCase();
  if (isCanonicalContig(normalized)) return normalizeContigName(normalized);
  for (const build of Object.keys(REFSEQ_CHROMOSOME_ACCESSIONS) as GenomeAssembly[]) {
    const table: Record<string, string> = REFSEQ_CHROMOSOME_ACCESSIONS[build];
    const contig = table[normalized];
    if (contig) return contig;
  }
  return null;
}

/** Every build whose RefSeq chromosome accession table contains `token` (usually one). */
export function buildsForChromosomeAccession(token: string): GenomeAssembly[] {
  const normalized = token.trim().toUpperCase();
  if (!/^NC_\d+\.\d+$/.test(normalized)) return [];
  return (Object.keys(REFSEQ_CHROMOSOME_ACCESSIONS) as GenomeAssembly[]).filter((build) => {
    const table: Record<string, GenomeAssembly[keyof GenomeAssembly]> = REFSEQ_CHROMOSOME_ACCESSIONS[build];
    return Boolean(table[normalized]);
  });
}

/**
 * The build a notation STATES about itself, and where it says so.
 *
 * The two sources are the ones the server honours (`intake-assembly.ts`): an inline annotation, or a
 * RefSeq chromosome accession, which names the reference sequence. It deliberately reports nothing
 * for a bare `chr1:g.…` or for the shared mitochondrial accession — "not stated" is a fact, and the
 * alternative (returning the GRCh38 default) is how an assumed build comes to look established.
 */
export function statedAssemblyOf(
  notation: string
): { build: GenomeAssembly; source: "annotation" | "accession" } | null {
  if (!notation || typeof notation !== "string") return null;

  const annotated = detectAssemblyAnnotation(notation);
  if (annotated) return { build: annotated, source: "annotation" };

  /**
   * The accession rule is asked of the REFERENCE SEQUENCE, not of the `g.` family: a RefSeq
   * chromosome accession states the build whichever coordinate type it prefixes. Asking it only of
   * `parseGenomicHgvsNotation` meant `NC_000001.10:c.1799T>A` — a GRCh37 sequence by definition —
   * reported nothing, so the panel showed the server's GRCh38 default beside a GRCh37 accession and
   * the request went to the GRCh38 host.
   */
  const referenceSequence = referenceSequenceOf(notation);
  if (referenceSequence) {
    const builds = buildsForChromosomeAccession(referenceSequence);
    if (builds.length === 1) return { build: builds[0], source: "accession" };
  }
  return null;
}

/**
 * Rewrites a coordinate notation so that it carries `build` — the control the UI's build selector
 * needs, and the reason a build choice can be an INPUT AID rather than hidden state.
 *
 * WHY IT REWRITES RATHER THAN STORING A CHOICE
 * -------------------------------------------
 * A build is a property of the coordinate, so the submitted string is the single source of truth
 * (`variant-parser` refuses to trust a forwarded coordinate whose build was not stated, precisely
 * because a defaulted label over another build's position is the wrong-locus hazard). Writing the
 * annotation into the field means the reader SEES what will be sent, a report can quote it, and there
 * is no second piece of state to drift out of agreement with the text.
 *
 * Handles every build-bearing family the server accepts:
 *   `chr1:g.1256452C>A`            -> `Chr1(GRCh37):g.1256452C>A`
 *   `Chr1(GRCh38):g.1256452C>A`    -> `Chr1(GRCh37):g.1256452C>A`   (replaces the annotation)
 *   `1-1256452-C-A`                -> `Chr1(GRCh37):g.1256452C>A`   (dashed → HGVS, as the server does)
 *   `NC_000001.10:g.1256452C>A`    -> `Chr1(GRCh37):g.1256452C>A`   (accession → contig, so the two
 *                                                                   builds' spellings can be swapped)
 *   `NM_004333.6:c.1799T>A`        -> `NM_004333.6(GRCh37):c.1799T>A` (cDNA: the annotation goes on
 *                                                                     the transcript's own sequence)
 * Returns `null` for anything build-free (a protein notation, or a BARE `c.1799T>A` that names no
 * transcript and therefore no reference sequence), so a caller cannot annotate what the server
 * would not honour.
 *
 * A patch release already pinned for the CHOSEN build is KEPT (`GRCh38.p14` stays `GRCh38.p14`):
 * those are different reference releases, and a control whose purpose is to state a build must not
 * quietly loosen one the reader pinned.
 */
export function withAssemblyAnnotation(notation: string, build: GenomeAssembly): string | null {
  if (!notation || typeof notation !== "string") return null;
  if (build !== "GRCh37" && build !== "GRCh38") return null;

  const canonical = normalizeGenomicNotation(notation);
  const release = releaseTokenFor(notation, build);

  const parsed = parseGenomicHgvsNotation(canonical);
  if (parsed) {
    const contig = canonicalContigOf(parsed.chrom) ?? parsed.chrom;
    return `Chr${contig}(${release}):g.${parsed.pos}${parsed.ref}>${parsed.alt}`;
  }

  const dashed = canonical.match(DASHED_GENOMIC_PATTERN);
  if (dashed) {
    const contig = canonicalContigOf(dashed[1]) ?? dashed[1].toUpperCase();
    return `Chr${contig}(${release}):g.${dashed[2]}${dashed[3].toUpperCase()}>${dashed[4].toUpperCase()}`;
  }

  /**
   * cDNA. The build decides which reference the TRANSCRIPT is read against, so it belongs on the
   * transcript accession rather than on the `c.` body — a fact worth noting because it is the one
   * place a build annotation does not sit immediately before the coordinate.
   *
   * `canonical` already had any previous annotation stripped, so choosing a build REPLACES the
   * stated one rather than stacking a second.
   */
  const cdna = canonical.match(ACCESSIONED_CDNA_PATTERN);
  if (cdna) return `${cdna[1]}(${release}):${cdna[2]}`;

  return null;
}

/**
 * The wire vocabulary for `conservationData.assemblyRefusals[].source`.
 *
 * The server writes these keys and the client reads them back; as a free-string convention
 * a typo degrades silently to "no refusal recorded", which the surfaces then render as an
 * unexplained blank (review L-1). One exported tuple, both sides import it.
 */
export const ASSEMBLY_REFUSAL_SOURCES = [
  "popEVE",
  "gpn-star",
  "alphagenome",
  "splice-proximity"
] as const;
export type AssemblyRefusalSource = (typeof ASSEMBLY_REFUSAL_SOURCES)[number];

/** A coordinate lifted onto the canonical build. Produced by the liftover step, which owns
 * the round-trip check and discards any lift that fails it.
 *
 * Modelling "unverified" as an absent value rather than a flagged one means no downstream
 * consumer has to remember to check a boolean in order to stay correct: the unsafe state
 * cannot be expressed, and a successful lift is simply a canonical-build coordinate. */
export interface LiftedCoordinate extends AssemblyTaggedCoordinate {
  /** The build the caller originally supplied. */
  originalAssembly: GenomeAssembly;
  /** The coordinate as originally supplied, retained for provenance. */
  original: { chrom: string; pos: number };
  /** Always true on a value that exists; a failed round-trip yields no value at all. */
  reverseVerified: true;
}

/**
 * Word the absence of a score for a source that cannot serve this build, so a skipped
 * source reads as "not assessed" rather than as a negative result.
 *
 * Wired into the production pipeline: the conservation orchestrator records one per refused
 * source on `conservationData.assemblyRefusals`, and the splicing surfaces render it verbatim
 * (unmapping defect F-13). "Absence must be explained, not silent" is no longer only a test name.
 */
export function describeAssemblyRefusal(
  source: AssemblyAwareSource,
  assembly: GenomeAssembly
): string {
  const supported = supportedAssemblies(source).map(a => ASSEMBLY_LABELS[a]).join(" or ");
  return `${source} covers ${supported}; this coordinate is ${ASSEMBLY_LABELS[assembly]} and was not scored.`;
}

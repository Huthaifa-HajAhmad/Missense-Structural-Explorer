/**
 * variantNotation.ts — Single source of truth for variant notation grammar.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Variant-notation recognition was previously copy-pasted across eight call sites
 * (server request gate, client router, two React form inputs, a parser guard and an
 * inspector heuristic). Each copy drifted, so adding support for one notation family
 * in one place left the others silently rejecting it. Example: `Chr1(GRCh38):g.25484258G>A`
 * was accepted by Ensembl VEP but rejected with a 400 by the server gate, because
 * `VCF_GENOMIC_PATTERN` had no room for an inline assembly annotation.
 *
 * Every consumer now imports from here. Do not re-declare these patterns locally.
 *
 * SUPPORTED NOTATION FAMILIES
 * ---------------------------
 *  protein-hgvs     p.Arg408Trp | Arg408Trp | p.R408W | R408W | arg408trp
 *  protein-foldx    RA408W | RB215H
 *  genomic-hgvs     chr1:g.25484258G>A
 *                   Chr1(GRCh38):g.25484258G>A     <- inline assembly annotation
 *                   chr1(GRCh37):g.25484258G>A
 *                   chrX(hg19):g.12345C>G
 *                   NC_000001.11:g.25484258G>A     <- RefSeq RefSeqGene accession
 *  genomic-bare     g.25484258G>A | 1:25484258
 *  genomic-dashed   20-23365054-G-A | chr20-23365054-G-A
 *  cdna             NM_004333.6:c.1799T>A | c.1799T>A
 *
 * ASSEMBLY SEMANTICS (easy to get wrong — keep it here and only here)
 * ------------------------------------------------------------------
 *   hg19 === GRCh37      hg38 === GRCh38
 * The numeric suffix therefore differs per prefix ("hg19" does not contain "37"),
 * which is why the assembly regex is not a naive `(37|38)` alternation.
 *
 * BOUNDARY CONTRACT
 * -----------------
 * This module is imported by BOTH `server/` and `src/`. It must stay pure: no imports
 * outside of `src/shared/` (enforced by scripts/check-boundaries.ts).
 */

// ============================================================================
// Amino-acid alphabets (shared by the protein-notation patterns)
// ============================================================================

/** 3-letter IUPAC amino-acid codes. Matched case-insensitively (Ala | ALA | ala). */
const IUPAC_3 = "(?:Ala|Arg|Asn|Asp|Cys|Gln|Glu|Gly|His|Ile|Leu|Lys|Met|Phe|Pro|Ser|Thr|Trp|Tyr|Val)";

/** 1-letter IUPAC amino-acid codes. */
const IUPAC_1 = "[ARNDCQEGHILKMFPSTWYV]";

/** Protein substitution with an optional `p.` prefix. Groups: 1=wt, 2=pos, 3=mut. */
export const HGVS_PATTERN = new RegExp(`^(?:p\\.)?(${IUPAC_3}|${IUPAC_1})(\\d{1,6})(${IUPAC_3}|${IUPAC_1})$`, "i");

/**
 * Longest residue position any human protein can have (Titin, TTN, is ~34 350 aa).
 *
 * HGVS itself allows six digits, so `p.Lys99999Asn` is well-formed notation for a position that
 * cannot exist. Without this bound such a notation was accepted, then "reconciled" onto another
 * isoform's numbering and returned as a valid analysis target for a 439 aa protein.
 */
export const MAX_PROTEIN_POSITION = 40_000;

/** FoldX in-silico mutation string: wt1 + chain + pos + mut1 (e.g. RA408W). */
export const MUTATION_FOLDX_PATTERN = /^[ARNDCQEGHILKMFPSTWYV][A-Z]\d+[ARNDCQEGHILKMFPSTWYV]$/i;

// ============================================================================
// Genomic / cDNA grammar
// ============================================================================

/**
 * Genome-build annotation suffix sets.
 * NOTE: hg19 == GRCh37 and hg38 == GRCh38, so the allowed suffixes differ
 * between the `GRCh` and `hg` prefixes. Patch releases (`GRCh38.p14`) are accepted.
 */
const ASSEMBLY_INNER = /\(\s*(GRCh(?:37|38)(?:\.p\d+)?|hg(?:19|38))\s*\)/i;

/** Optional, non-capturing form of {@link ASSEMBLY_INNER} for embedding in larger patterns. */
const ASSEMBLY_GROUP = String.raw`(?:\(\s*(?:GRCh(?:37|38)(?:\.p\d+)?|hg(?:19|38))\s*\))?`;

/** Plain chromosome token: 1..99, X, Y, M, MT, with an optional `chr` prefix. */
const CHROM_GROUP = String.raw`(?:chr)?(?:\d{1,2}|X|Y|MT|M)`;

/** NCBI RefSeq / RefSeqGene chromosome accession (e.g. NC_000001.11). */
const ACCESSION_GROUP = String.raw`NC_\d{6}\.\d+`;

/**
 * STRICT genomic HGVS, anchored to the full substitution — use this to *accept* a genomic
 * query. Because it requires exactly `[A-Z]>[A-Z]`, it also rejects genomic indels
 * (`del`, `ins`, `dup`, `inv`, `delins`, `=`), which are outside this platform's
 * missense-only scope.
 *
 * Capture groups: 1 = reference allele, 2 = alternate allele.
 */
export const GENOMIC_HGVS_PATTERN = new RegExp(
  `^(?:${CHROM_GROUP}|${ACCESSION_GROUP})${ASSEMBLY_GROUP}:g\\.\\d+([A-Z])>([A-Z])$`,
  "i"
);

/** LENIENT genomic HGVS (prefix only, no allele check) — use this to *classify*. */
export const GENOMIC_HGVS_PREFIX_PATTERN = new RegExp(
  `^(?:chr)?(?:[0-9XYMT]+|${ACCESSION_GROUP})${ASSEMBLY_GROUP}:g\\.\\d+`,
  "i"
);

/** Dashed genomic coordinates. Groups: 1=chrom, 2=pos, 3=ref, 4=alt. */
export const DASHED_GENOMIC_PATTERN = /^(?:chr)?([0-9XYMT]+)-(\d+)-([ACGTN]+)-([ACGTN]+)$/i;

/** cDNA HGVS, anchored. */
export const CDNA_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+[A-Z]>[A-Z]$/i;

/** cDNA HGVS, prefix only. */
export const CDNA_PREFIX_PATTERN = /^(?:[A-Z0-9_.]+:)?c\.\d+/i;

/**
 * Protein accession a substitution's residue numbers belong to: a RefSeq protein
 * (`NP_001032248.1`) or a UniProt accession / isoform (`Q9Y305`, `Q9Y305-4`).
 *
 * Explicit because the numbering basis is not cosmetic: MANE Select routinely follows a
 * NON-canonical isoform, so the same variant has different numbers on `NP_001032248.1` and on
 * canonical `Q9Y305`. Lab/clinical pipelines report the former; structures follow the latter.
 */
export const PROTEIN_ACCESSION_GROUP = String.raw`(?:NP_\d+(?:\.\d+)?|[A-Z][A-Z0-9]{5,9}(?:-\d+)?)`;

/** The substitution body shared by the protein patterns (optional `p.`, optional parentheses). */
const PROTEIN_SUBSTITUTION_BODY = String.raw`(?:p\.)?\(?(${IUPAC_3}|${IUPAC_1})(\d{1,6})(${IUPAC_3}|${IUPAC_1})\)?`;

/**
 * A protein substitution qualified by the protein it is numbered on:
 *   `NP_001032248.1:p.Lys281Asn` | `NP_001032248.1:p.(Lys281Asn)`
 *   `Q9Y305-4:p.Lys281Asn`       | `Q9Y305:p.Lys272Asn`
 * Groups: 1 = accession, 2 = wt, 3 = position, 4 = mut.
 */
export const ACCESSIONED_PROTEIN_PATTERN = new RegExp(
  `^(${PROTEIN_ACCESSION_GROUP}):${PROTEIN_SUBSTITUTION_BODY}$`,
  "i"
);

/** Bare `g.` HGVS without a chromosome context (e.g. `g.25484258G>A`). */
export const BARE_GENOMIC_PATTERN = /^(?:[A-Z0-9_.]+:)?g\.\d+/i;

/** Bare `chrom:position` (e.g. `chr7:140753336`). */
export const CHROM_POS_PATTERN = new RegExp(`^(?:chr)?(?:[0-9XYMT]+|${ACCESSION_GROUP}):\\d+`, "i");

/**
 * Genomic / cDNA HGVS describing something OTHER than a single-nucleotide substitution:
 * deletions, insertions, duplications, inversions, delins and "no change" (`=`).
 *
 * MissenseResolve models single amino-acid substitutions only. Recognizing these explicitly
 * lets the API reject them with a precise missense-scope explanation instead of a generic
 * "invalid notation format" message — and without spending an Ensembl VEP round trip on a
 * query that could never be modeled.
 *
 * NOTE: this deliberately covers only the `g.` / `c.` coordinate families. Protein-level
 * non-missense notations (nonsense, frameshift, protein indels) are diagnosed by
 * `validateVariant` in server/utils/validation.ts, which already emits targeted messages.
 */
export const GENOMIC_OR_CDNA_NON_SUBSTITUTION_PATTERN =
  /^(?:[A-Z0-9_.]+:)?(?:g|c)\.\d+(?:_\d+)?(?:delins|del|dup|inv|ins|=)/i;

/** User-facing statement of the missense-only scope, shared by every rejection site. */
export const MISSENSE_ONLY_NOTE =
  "MissenseResolve models single amino-acid substitutions (missense variants) only. " +
  "Deletions, insertions, duplications, inversions, delins and no-change notations cannot be " +
  "modeled with missense biophysical stability predictors (FoldX/DynaMut2).";

// ============================================================================
// Classification & normalization
// ============================================================================

export type GenomeAssembly = "GRCh37" | "GRCh38";

export type NotationKind =
  | "genomic-hgvs"
  | "genomic-dashed"
  | "genomic-bare"
  | "cdna"
  | "protein-hgvs"
  /**
   * A protein substitution qualified by the protein whose numbering it uses
   * (`NP_001032248.1:p.Lys281Asn`, `Q9Y305-4:p.Lys281Asn`). Needs the isoform model to be turned
   * into canonical numbering before it can be modelled.
   */
  | "protein-accessioned"
  | "protein-foldx"
  /**
   * A recognized `g.` / `c.` coordinate notation that is NOT a single-nucleotide
   * substitution (del, ins, dup, inv, delins, `=`). Outside this platform's missense scope.
   */
  | "non-substitution"
  | "unknown";

export interface NotationDescriptor {
  /** Which grammar family the input belongs to. */
  kind: NotationKind;
  /** Assembly inferred from an inline annotation such as `(GRCh38)`. `null` when absent. */
  assembly: GenomeAssembly | null;
  /**
   * Canonical, VEP-ready form of the notation (inline assembly annotation stripped and
   * `chr` casing normalized), or `null` when the kind is `"unknown"` / `"protein-*"`.
   */
  canonical: string | null;
}

/**
 * Normalizes `chr` casing and strips any inline assembly annotation.
 * `"Chr1(GRCh38):g.25484258G>A"` -> `"chr1:g.25484258G>A"`
 */
export function normalizeGenomicNotation(input: string): string {
  return input
    .trim()
    .replace(ASSEMBLY_INNER, "")
    .replace(/^chr/i, "chr")
    .trim();
}

/**
 * Extracts the genome build from an inline annotation.
 * `(GRCh38)` / `(hg38)` -> `"GRCh38"`;  `(GRCh37)` / `(hg19)` -> `"GRCh37"`.
 * Returns `null` when the notation carries no assembly hint.
 *
 * This is the ONLY place the hg19<->GRCh37 and hg38<->GRCh38 mapping lives.
 */
export function detectAssemblyAnnotation(input: string): GenomeAssembly | null {
  if (!input || typeof input !== "string") return null;
  const match = input.match(ASSEMBLY_INNER);
  if (!match) return null;
  const token = match[1].toLowerCase();
  return token.startsWith("hg19") || token.startsWith("grch37") ? "GRCh37" : "GRCh38";
}

/**
 * Classifies any variant notation in a single call, so consumers never need to chain
 * `.test()` calls across several regexes — the exact practice that let the notation
 * grammar drift out of sync across eight call sites.
 *
 * Precedence is deliberate: genomic families are tested before protein families,
 * because genomic strings can superficially resemble protein ones, never the reverse.
 */
export function classifyNotation(input: string): NotationDescriptor {
  const unknown: NotationDescriptor = { kind: "unknown", assembly: null, canonical: null };
  if (!input || typeof input !== "string") return unknown;

  const trimmed = input.trim();
  if (!trimmed) return unknown;

  const assembly = detectAssemblyAnnotation(trimmed);
  const canonical = normalizeGenomicNotation(trimmed);

  // Missense-scope check first: `c.1799del` and `chr1:g.25484258delG` otherwise look like
  // ordinary cDNA / genomic notations to the prefix patterns below. Tested against the
  // canonical form so assembly-annotated input ("Chr1(GRCh38):g.25484258delG") is covered.
  if (GENOMIC_OR_CDNA_NON_SUBSTITUTION_PATTERN.test(canonical)) {
    return { kind: "non-substitution", assembly, canonical };
  }
  if (DASHED_GENOMIC_PATTERN.test(trimmed)) {
    return { kind: "genomic-dashed", assembly, canonical: trimmed };
  }
  if (GENOMIC_HGVS_PREFIX_PATTERN.test(trimmed)) {
    return { kind: "genomic-hgvs", assembly, canonical };
  }
  if (CDNA_PREFIX_PATTERN.test(trimmed)) {
    return { kind: "cdna", assembly, canonical };
  }
  if (BARE_GENOMIC_PATTERN.test(trimmed) || CHROM_POS_PATTERN.test(trimmed)) {
    return { kind: "genomic-bare", assembly, canonical };
  }
  if (ACCESSIONED_PROTEIN_PATTERN.test(trimmed)) {
    return { kind: "protein-accessioned", assembly: null, canonical: null };
  }
  if (HGVS_PATTERN.test(trimmed)) {
    return { kind: "protein-hgvs", assembly: null, canonical: null };
  }
  if (MUTATION_FOLDX_PATTERN.test(trimmed)) {
    return { kind: "protein-foldx", assembly: null, canonical: null };
  }
  return unknown;
}

/**
 * True for any genomic / cDNA coordinate notation that must first be resolved to a
 * protein substitution via Ensembl VEP.
 *
 * Includes `"non-substitution"` so routing stays consistent: such queries must reach the
 * gateway that can explain the missense-only scope, rather than falling through to the
 * protein parser and producing a misleading "invalid HGVS missense format" error.
 */
export function isGenomicOrCdnaNotation(input: string): boolean {
  const { kind } = classifyNotation(input);
  return (
    kind === "genomic-hgvs" ||
    kind === "genomic-dashed" ||
    kind === "genomic-bare" ||
    kind === "cdna" ||
    kind === "non-substitution"
  );
}

/** True for any protein-level notation the biophysical pipeline can analyze directly. */
export function isProteinNotation(input: string): boolean {
  const { kind } = classifyNotation(input);
  return kind === "protein-hgvs" || kind === "protein-foldx" || kind === "protein-accessioned";
}

/**
 * True when a notation must be resolved by the server before the modelling pipeline can run:
 * coordinate/cDNA input needs coordinate translation, and an accession-qualified protein
 * notation needs its numbering mapped onto the canonical sequence.
 *
 * Kept separate from {@link isGenomicOrCdnaNotation} (which answers a narrower question and is
 * used by the server's coordinate gate) so callers that must decide "translate first?" have one
 * place to ask.
 */
export function needsNotationResolution(input: string): boolean {
  return isGenomicOrCdnaNotation(input) || classifyNotation(input).kind === "protein-accessioned";
}

export interface AccessionedProteinNotation {
  /** The protein the numbering belongs to: `NP_001032248.1`, `Q9Y305-4`, `Q9Y305`. */
  accession: string;
  /** The substitution alone, normalised to HGVSp form: `p.Lys281Asn`. */
  proteinNotation: string;
}

/** Splits `NP_001032248.1:p.(Lys281Asn)` into its accession and its substitution. */
export function parseAccessionedProteinNotation(
  input: string
): AccessionedProteinNotation | null {
  if (!input || typeof input !== "string") return null;
  const match = input.trim().match(ACCESSIONED_PROTEIN_PATTERN);
  if (!match) return null;
  return {
    accession: match[1].toUpperCase(),
    proteinNotation: `p.${match[2]}${match[3]}${match[4]}`,
  };
}

/**
 * Human-facing catalogue of accepted notation families, shared by the server's 400
 * response and the client's input hints so the two can never disagree.
 */
export const ACCEPTED_NOTATION_EXAMPLES = {
  genomicHgvs: "chr1:g.25484258G>A",
  genomicHgvsAssemblyAnnotated: "Chr1(GRCh38):g.25484258G>A",
  genomicAccession: "NC_000001.11:g.25484258G>A",
  genomicDashed: "20-23365054-G-A",
  cdna: "NM_004333.6:c.1799T>A",
  protein: "p.Arg408Trp",
} as const;

/** One-line summary of accepted coordinate notations, used in user-facing error messages. */
export const ACCEPTED_NOTATION_SUMMARY =
  `genomic HGVS (e.g., ${ACCEPTED_NOTATION_EXAMPLES.genomicHgvs} or ` +
  `${ACCEPTED_NOTATION_EXAMPLES.genomicHgvsAssemblyAnnotated}), ` +
  `transcript cDNA (e.g., ${ACCEPTED_NOTATION_EXAMPLES.cdna}), or ` +
  `dashed genomic coordinates (e.g., ${ACCEPTED_NOTATION_EXAMPLES.genomicDashed})`;

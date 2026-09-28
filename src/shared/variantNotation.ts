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
 *                   NM_004333.6(GRCh37):c.1799T>A   <- build annotation on the transcript's sequence
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
 * The one place the genome-build token is written.
 *
 * `ASSEMBLY_TOKEN` is the token itself, `ASSEMBLY_ANNOTATION` a complete parenthesised annotation, and
 * every pattern and helper below derives from them. They used to be hand-written twice — a CAPTURING
 * form for reading and a non-capturing copy for embedding — which is a drift class rather than a
 * convenience: the reading form and the embedding form must agree on what an annotation IS, or a
 * notation can be read as annotated by one and not by the other.
 *
 * NOTE: hg19 == GRCh37 and hg38 == GRCh38, so the allowed suffixes differ between the `GRCh` and `hg`
 * prefixes. Patch releases (`GRCh38.p14`) are accepted.
 */
const ASSEMBLY_TOKEN = String.raw`GRCh(?:37|38)(?:\.p\d+)?|hg(?:19|38)`;
const ASSEMBLY_ANNOTATION = String.raw`\(\s*(?:${ASSEMBLY_TOKEN})\s*\)`;

/** Optional, non-capturing form of {@link ASSEMBLY_ANNOTATION} for embedding in larger patterns. */
const ASSEMBLY_GROUP = `(?:${ASSEMBLY_ANNOTATION})?`;

/**
 * A fresh pattern per call, deliberately: a module-level `/g/` regex carries `lastIndex` between
 * `.test()`/`.exec()` calls, and a pattern shared across a read path and a write path is exactly where
 * that statefulness produces an intermittent, unreproducible miss.
 */
const assemblyAnnotationPattern = (flags: string) => new RegExp(ASSEMBLY_ANNOTATION, flags);

/** The build an annotation token names, or `null` when it names none we honour. */
function buildFromAssemblyToken(token: string): GenomeAssembly | null {
  const normalized = token.toLowerCase();
  if (normalized.includes("grch37") || normalized.includes("hg19")) return "GRCh37";
  if (normalized.includes("grch38") || normalized.includes("hg38")) return "GRCh38";
  return null;
}

/** The token text of a parenthesised annotation, without its brackets or padding. */
function tokenText(annotation: string): string {
  return annotation.replace(/^\s*\(\s*|\s*\)\s*$/g, "");
}

/**
 * Plain chromosome token: 1..22, X, Y, M, MT, with an optional `chr` prefix.
 *
 * The numeric range is EXACT, matching the dashed parser below and
 * `parseGenomicCoordinateString`. A bare `\d{1,2}` accepted `chr23:g.…`, which no reference carries:
 * it passed this gate, could not be lifted (`isCanonicalContig` refuses it) and could not be
 * annotated on either Ensembl host, so the request ended in a provider-failure message whose advice
 * ("annotate the build and it will be verified on GRCh38") could never help. Rejecting it here
 * answers with the accepted-notation summary instead, which is the honest answer: that chromosome
 * does not exist in either build.
 */
const CHROM_GROUP = String.raw`(?:chr)?(?:[1-9]|1[0-9]|2[0-2]|X|Y|MT|M)`;

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

/**
 * cDNA HGVS, anchored. Groups: 1 = reference allele, 2 = alternate allele.
 *
 * The optional build annotation sits between the transcript accession and the colon —
 * `NM_004333.6(GRCh37):c.1799T>A` — because it qualifies the REFERENCE SEQUENCE the transcript
 * belongs to, exactly as it does in `Chr1(GRCh37):g.…`. The server already honoured that spelling
 * (it strips and reads the annotation before this gate), but the grammar did not, so the CLIENT
 * classified it as `unknown`: the field stopped being routed as a coordinate, the gene became
 * required, and the one notation family whose build is easiest to get wrong was the one where the
 * build could not be stated.
 */
export const CDNA_PATTERN = new RegExp(
  `^(?:[A-Z0-9_.]+${ASSEMBLY_GROUP}:)?c\\.\\d+([A-Z])>([A-Z])$`,
  "i"
);

/** cDNA HGVS, prefix only. */
export const CDNA_PREFIX_PATTERN = new RegExp(`^(?:[A-Z0-9_.]+${ASSEMBLY_GROUP}:)?c\\.\\d+`, "i");

/**
 * A cDNA notation split into the reference sequence it hangs on and its `c.` body.
 * Groups: 1 = reference-sequence token, 2 = body (`c.1799T>A`), both without any build annotation.
 *
 * A BARE `c.123A>G` deliberately does not match: it names no reference sequence, so there is nothing
 * for a build annotation to attach to — and a build stated against an unnamed sequence would be a
 * claim about a reference nobody identified.
 *
 * The token class is deliberately WIDE (`NM_`, `XM_`, `ENST…`, `LRG_…t1`, and any INSDC accession a
 * provider may know): narrowing it would refuse cDNA notations that can genuinely be resolved, and the
 * build claim — which is what must be right — is decided by
 * {@link referenceSequenceOf} + the accession tables, not by this pattern.
 */
export const ACCESSIONED_CDNA_PATTERN = new RegExp(
  `^([A-Z0-9_.]+)${ASSEMBLY_GROUP}:(c\\.\\d+[A-Z]>[A-Z])$`,
  "i"
);

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
   * Canonical form of the notation, or `null` when the kind is `"unknown"` / `"protein-*"`.
   *
   * For `g.` / `c.` families this is the VEP-ready spelling: EVERY inline assembly annotation
   * stripped and `chr` casing normalized. Every one, not just the first — a notation that somehow
   * carried two (`(GRCh37)(GRCh38)`) would otherwise keep one of them, and the string the server then
   * queries would state a build nobody chose while `assembly` reported the other. Such input is
   * refused as `"unknown"` (see `classifyNotation`), so no consumer ever sees a `canonical` that still
   * contains an annotation.
   *
   * `genomic-dashed` is the exception: it keeps the submitted spelling, because the server's intake
   * converts it to HGVS itself and nothing downstream has ever consumed this field for that family.
   */
  canonical: string | null;
}

/**
 * Normalizes `chr` casing and strips EVERY inline assembly annotation.
 * `"Chr1(GRCh38):g.25484258G>A"` -> `"chr1:g.25484258G>A"`
 */
export function normalizeGenomicNotation(input: string): string {
  return input
    .trim()
    .replace(assemblyAnnotationPattern("gi"), "")
    .replace(/^chr/i, "chr")
    .trim();
}

/**
 * Every genome build the notation states inline, in the order written.
 *
 * A LIST rather than one value because "how many" is itself an answer: `NM_004333.6(GRCh37)(GRCh38):c.…`
 * states two builds, and reading only the first — while the other survived into the canonical string —
 * is how a request came to be sent under one build while its own text said the other.
 */
export function assemblyAnnotationsOf(input: string): GenomeAssembly[] {
  if (!input || typeof input !== "string") return [];
  const builds: GenomeAssembly[] = [];
  for (const match of input.matchAll(assemblyAnnotationPattern("gi"))) {
    const build = buildFromAssemblyToken(tokenText(match[0]));
    if (build) builds.push(build);
  }
  return builds;
}

/**
 * Extracts the genome build from an inline annotation.
 * `(GRCh38)` / `(hg38)` -> `"GRCh38"`;  `(GRCh37)` / `(hg19)` -> `"GRCh37"`.
 * Returns `null` when the notation carries no assembly hint.
 *
 * This is the ONLY place the hg19<->GRCh37 and hg38<->GRCh38 mapping lives.
 */
export function detectAssemblyAnnotation(input: string): GenomeAssembly | null {
  return assemblyAnnotationsOf(input)[0] ?? null;
}

/**
 * The release token a rewrite should write for `build`: the build itself, or a patch release the
 * notation already pinned for that same major release (`GRCh38.p14`).
 *
 * WHY IT MATTERS: `GRCh38` and `GRCh38.p14` are different reference releases. A control whose whole
 * purpose is to let the reader STATE a build must not silently loosen a reference they pinned — that
 * would be the same class of quiet substitution this module exists to prevent, one release level down.
 * A patch for the OTHER major is never carried across (`GRCh38.p14` → `GRCh37`), because it does not
 * name that release.
 */
export function releaseTokenFor(input: string, build: GenomeAssembly): string {
  if (!input || typeof input !== "string") return build;
  for (const match of input.matchAll(assemblyAnnotationPattern("gi"))) {
    const token = tokenText(match[0]);
    if (buildFromAssemblyToken(token) === build && /\.p\d+$/i.test(token)) return token;
  }
  return build;
}

/**
 * The reference sequence a coordinate notation hangs on, as written: a contig (`1`, `X`) or a RefSeq
 * chromosome accession (`NC_000001.10`) for a `g.` description, or the accession before a `c.` body
 * (`NM_004333.6`). `null` for anything else — including a BARE `c.123A>G`, which names no sequence.
 *
 * ONE accessor for both families, because the build policy asks the same question of both: an
 * accession that names the reference sequence states the build, whether it prefixes `g.` or `c.`
 * (`src/shared/assembly.ts`). Reading the build only for `g.` meant `NC_000001.10:c.…` — a GRCh37
 * sequence by definition — was reported as the GRCh38 default and queried on the GRCh38 host.
 */
export function referenceSequenceOf(notation: string): string | null {
  if (!notation || typeof notation !== "string") return null;
  const genomic = parseGenomicHgvsNotation(notation);
  if (genomic) return genomic.chrom;
  const cdna = normalizeGenomicNotation(notation).match(ACCESSIONED_CDNA_PATTERN);
  return cdna ? cdna[1].toUpperCase() : null;
}

/**
 * What a `c.` description gets WRONG about its reference sequence, or `null` when nothing is.
 *
 * WHY IT IS NOT PART OF THE PATTERNS. `CDNA_PATTERN` answers "is this the cDNA family?" — and a bare
 * `c.123A>G` IS a `c.` fragment, which is a pinned contract with tests on both sides of the boundary.
 * This answers a different question: "can a provider resolve it at all?". Both problems below are
 * unanswerable everywhere (Ensembl answers `Unable to parse HGVS notation`; VariantValidator raises
 * `VariantSyntaxError`), so the ladder could only report "the providers returned unusable responses"
 * with build advice that cannot help — when what is missing is the transcript, or the prefix's case.
 */
export type CdnaReferenceProblem = 
  /** No reference sequence at all (`c.1799T>A`): nothing identifies the transcript. */
  | "missing-transcript"
  /** A PROTEIN accession before a `c.` body (`NP_…:c.…`): proteins carry `p.` positions, not `c.`. */
  | "protein-accession"
  /** The HGVS type prefix is not lower-case (`C.1799T>A`) — `c.` is part of the notation's grammar. */
  | "type-prefix-case";

/** True for the cDNA family, case-insensitively, annotation or not. Shared by the checks below. */
function isCdnaNotation(canonical: string): boolean {
  return CDNA_PREFIX_PATTERN.test(canonical);
}

/** The body after the last `:` — the `c.…` part a reader recognises as the coordinate itself. */
function cdnaBodyOf(canonical: string): string {
  const colon = canonical.lastIndexOf(":");
  return colon === -1 ? canonical : canonical.slice(colon + 1);
}

export function cdnaReferenceProblem(input: string): CdnaReferenceProblem | null {
  if (!input || typeof input !== "string") return null;
  const canonical = normalizeGenomicNotation(input);
  // Only a `c.` description can have a cDNA reference problem; anything else is somebody else's
  // question, and this must never reclassify a `g.` or `p.` notation.
  if (!isCdnaNotation(canonical)) return null;

  // The type prefix is lower-case in HGVS. Checked on the body rather than with `/c\./` anywhere in
  // the string: an accession or a stray `c.` elsewhere must not stand in for the real prefix.
  if (!cdnaBodyOf(canonical).startsWith("c.")) return "type-prefix-case";

  const reference = referenceSequenceOf(canonical);
  if (!reference) return "missing-transcript";
  // `NP_`/`XP_`/`YP_` are proteins. `NG_`/`NC_` are nucleotide sequences but not transcripts; they are
  // left to the providers rather than refused here, because an accession we do not recognise may still
  // be resolvable and refusing it would break input that works.
  if (/^(?:NP|XP|YP)_/i.test(reference)) return "protein-accession";
  return null;
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

  /**
   * A notation that states TWO builds is not a notation: the reader has contradicted themselves, and
   * any reading of it is a choice on their behalf. `canonical` would then carry an annotation nobody
   * chose while `assembly` reported the other — the exact drift this descriptor exists to prevent.
   * Refused here (and by the server's gate) rather than silently resolved to the first annotation.
   */
  const annotations = assemblyAnnotationsOf(trimmed);
  if (annotations.length > 1) return unknown;

  const assembly = annotations[0] ?? null;
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
  if (isCdnaNotation(canonical)) {
    /**
     * The two cDNA reference problems are treated DIFFERENTLY, on purpose.
     *
     * A case-wrong prefix (`C.1799T>A`) is not a cDNA description at all, so this reports `unknown` —
     * the client must not advertise a family the notation is not written in.
     *
     * A missing transcript (`c.1799T>A`) IS a `c.` fragment, and a pinned contract on both sides says
     * so; it is routed to the resolver, which answers with the precise reason. Reporting `unknown`
     * here would instead strand the reader on a client-side "No match" with no explanation of what is
     * missing.
     */
    return cdnaReferenceProblem(trimmed) === "type-prefix-case"
      ? unknown
      : { kind: "cdna", assembly, canonical };
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

/** The parts of a genomic HGVS substitution, as written. */
export interface ParsedGenomicHgvs {
  /**
   * Contig as written, `chr`-prefix stripped: `1`, `X`, `MT`, or a RefSeq accession
   * (`NC_000001.10`). NOT resolved to a canonical Ensembl contig — that is a genome-build
   * question and belongs to `assembly.ts` (`canonicalContigOf`), so this parser
   * stays free of build policy.
   */
  chrom: string;
  /** 1-based genomic position. */
  pos: number;
  ref: string;
  alt: string;
  /** Build stated inline (`(GRCh37)` / `(hg19)`), or `null` when the notation carries none. */
  assembly: GenomeAssembly | null;
}

/**
 * Parses a genomic HGVS substitution into contig / position / alleles.
 *
 * WHY THIS EXISTS
 * ---------------
 * The build policy is "coordinates are lifted to the canonical build when the input build
 * differs" (`src/shared/assembly.ts`), and a lift needs the PARTS of the coordinate — which
 * nothing could extract: `GENOMIC_HGVS_PATTERN` captures only the two alleles, because its job is
 * to ACCEPT a notation. Every place that needed the parts grew its own ad-hoc slicing, and the one
 * place that mattered (lifting a GRCh37 coordinate before annotating it) had no way to ask.
 *
 * Accepts every genomic spelling the server gate accepts — `chr1:g.…`, `1:g.…`,
 * `Chr1(GRCh37):g.…`, `NC_000001.10:g.…` — and returns `null` for everything else (indels, cDNA,
 * protein notations), so a caller can never lift something that is not a single substitution.
 */
export function parseGenomicHgvsNotation(input: string): ParsedGenomicHgvs | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();

  // The strict pattern is the gate: it is anchored to a single `[A-Z]>[A-Z]` substitution, which
  // is exactly the family a lift can carry (the liftover refuses indels by contract).
  if (!GENOMIC_HGVS_PATTERN.test(trimmed)) return null;

  // Contig and position are read from the CANONICAL form, because the strict pattern's capture
  // groups are the alleles only. `normalizeGenomicNotation` strips the inline annotation and
  // normalizes `chr` casing, so this one regex covers every accepted spelling.
  const body = normalizeGenomicNotation(trimmed).match(/^([^:]+):g\.(\d+)([A-Z])>([A-Z])$/i);
  if (!body) return null;

  const pos = Number.parseInt(body[2], 10);
  if (!Number.isFinite(pos) || pos < 1) return null;

  return {
    chrom: body[1].replace(/^chr/i, "").toUpperCase(),
    pos,
    ref: body[3].toUpperCase(),
    alt: body[4].toUpperCase(),
    assembly: detectAssemblyAnnotation(trimmed),
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
  cdnaAssemblyAnnotated: "NM_004333.6(GRCh37):c.1799T>A",
  protein: "p.Arg408Trp",
  proteinAccessioned: "NP_001032248.1:p.Lys281Asn",
} as const;

/** One-line summary of accepted coordinate notations, used in user-facing error messages. */
export const ACCEPTED_NOTATION_SUMMARY =
  `genomic HGVS (e.g., ${ACCEPTED_NOTATION_EXAMPLES.genomicHgvs} or ` +
  `${ACCEPTED_NOTATION_EXAMPLES.genomicHgvsAssemblyAnnotated}), ` +
  `transcript cDNA (e.g., ${ACCEPTED_NOTATION_EXAMPLES.cdna}), ` +
  `dashed genomic coordinates (e.g., ${ACCEPTED_NOTATION_EXAMPLES.genomicDashed}), or a protein ` +
  `substitution qualified by the protein it is numbered on (e.g., ${ACCEPTED_NOTATION_EXAMPLES.proteinAccessioned})`;

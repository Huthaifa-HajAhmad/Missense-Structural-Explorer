import { type Router } from "express";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  formatZodError,
} from "../../utils.ts";
import {
  isSupportedGenomicHgvs,
  isSupportedCdnaHgvs,
  ACCEPTED_NOTATION_SUMMARY,
  MISSENSE_ONLY_NOTE,
  assemblyAnnotationsOf,
  buildForwardStrandGenomicId,
  cdnaReferenceProblem,
  classifyNotation,
  detectAssemblyAnnotation,
  normalizeGenomicNotation,
  parseAccessionedProteinNotation,
  parseGenomicHgvsNotation,
  parseGenomicNotation,
  type CdnaReferenceProblem,
  type GenomeAssembly,
} from "../../../src/shared/variantNotation.ts";
import { withAssemblyAnnotation } from "../../../src/shared/assembly.ts";
import { type BuildHint, REFUSAL_CODES } from "../../../src/shared/contracts.ts";
import {
  resolveCoordinate,
  selectProteinConsequence,
  pickInformativeConsequence,
  DEFAULT_ASSEMBLY,
  DEFAULT_RESOLUTION_BUDGET_MS,
} from "../../services/translation/coordinate-resolver.ts";
import {
  CoordinateResolutionError,
  TRANSLATION_PROVIDER_LABELS,
  resolutionFailureToHttp,
  type ResolvedTranscriptConsequence,
} from "../../services/translation/types.ts";
import {
  buildIsoformRemapWarning,
  buildUnverifiedNumberingWarning,
} from "../../services/translation/isoform-numbering.ts";
import {
  INTAKE_LIFT_BUDGET_MS,
  TRANSLATE_TOTAL_BUDGET_MS,
  decideIntakeAssembly,
  type IntakeAssemblyDecision,
} from "../../services/translation/intake-assembly.ts";
import {
  buildProteinNumberingRemapWarning,
  resolveAccessionedProteinNotation,
} from "../../services/translation/protein-numbering.ts";
import { fetchAssemblyReferenceBase } from "../../services/translation/liftover.ts";
import {
  currentEnsemblTranscriptNotation,
  resolveIdentifierIntake,
} from "../../services/translation/identifier-intake.ts";
import { buildAmbiguousNumberingMessage } from "../../services/translation/isoform-remap.ts";

/**
 * How long the route may spend checking the build it is about to OFFER as a retry.
 *
 * This runs on a path that has already spent a whole ladder run, and it exists to avoid offering a
 * coordinate the reader cannot use — so it is worth a round trip, and not worth holding the refusal
 * open. A check that does not finish in time withholds the offer rather than guessing.
 */
const REFERENCE_MISMATCH_CHECK_BUDGET_MS = 4_000;

const translateVariantSchema = z.object({
  variant: z.string().min(1).max(200),
});

/**
 * Sequence Ontology terms that DO change (or may change) the encoded protein.
 *
 * Used to keep the no-HGVSp explanation honest: the previous wording asserted the coordinate
 * "does not alter the encoded protein sequence" for whatever consequence happened to be the
 * most informative one, which is a conclusion the payload does not establish when that
 * consequence is itself protein-altering (an annotation gap, not a non-coding variant).
 */
const PROTEIN_ALTERING_TERMS = new Set([
  "missense_variant",
  "stop_gained",
  "stop_lost",
  "start_lost",
  "frameshift_variant",
  "inframe_insertion",
  "inframe_deletion",
  "protein_altering_variant",
  "splice_acceptor_variant",
  "splice_donor_variant",
  "transcript_amplification",
]);

/**
 * Explains why a coordinate cannot start the missense pipeline when no transcript consequence
 * carries an HGVSp.
 *
 * This is a property of the VARIANT, not a system failure: intronic / UTR / splice-region /
 * non-coding coordinates have no protein change on ANY reference translator, so the ladder has
 * already asked every provider before this is emitted. The message names the gene, the actual
 * consequence terms and the transcript-level HGVS (the identifiers a clinician needs to
 * cross-check the coordinate), and states what input WOULD work.
 *
 * Kept pure and exported so the wording is unit-testable without network mocks.
 */
export function buildNoProteinChangeMessage(
  notation: string,
  assembly: GenomeAssembly,
  tc: ResolvedTranscriptConsequence | undefined
): string {
  if (!tc) {
    return (
      `No protein variant (HGVSp) could be produced for "${notation}" on ${assembly}: the ` +
      "coordinate resolved, but no transcript consequence overlaps it. Verify the chromosome, " +
      "position, alleles and genome build, or enter a protein-level substitution " +
      "(e.g. p.Gly380Arg)."
    );
  }

  const terms = Array.isArray(tc.consequence_terms) ? tc.consequence_terms : [];
  const effect = terms.length > 0 ? terms.join(" + ") : "a non-coding transcript effect";
  const genePart = tc.gene_symbol ? ` of ${tc.gene_symbol}` : "";
  const identifiers: string[] = [];
  if (tc.transcript_id) identifiers.push(`transcript ${tc.transcript_id}`);
  if (tc.hgvsc) identifiers.push(tc.hgvsc);
  const idPart = identifiers.length > 0 ? ` (${identifiers.join(", ")})` : "";

  // Protein-altering terms with no HGVSp mean the annotation did not resolve to a protein
  // consequence — NOT that the protein is unaffected. Say only what is established.
  if (terms.some((term) => PROTEIN_ALTERING_TERMS.has(term))) {
    return (
      `"${notation}" resolves on ${assembly} to ${effect}${genePart}${idPart}, but no reference ` +
      "provider could compute a protein variant (HGVSp) for it. Because those consequences can " +
      "alter the protein, this is an annotation gap rather than proof that the protein is " +
      "unaffected — verify the transcript and coordinate, or enter the protein-level " +
      "substitution directly (e.g. p.Gly380Arg)."
    );
  }

  return (
    `"${notation}" resolves on ${assembly} to ${effect}${genePart}${idPart}, which does not ` +
    "alter the encoded protein sequence, so no protein variant (HGVSp) exists for it. " +
    "This platform analyses missense substitutions only — enter a coding coordinate, or a " +
    "protein-level notation such as p.Gly380Arg."
  );
}

/**
 * Narrows an `any` payload field to an object map.
 *
 * Ensembl VEP reports `mane_select` / `mane_plus_clinical` either as a RefSeq string
 * (`"NM_018202.6"`) or as an object (`{ refseq_match, id }`). Reading `.refseq_match`
 * directly off the property makes TypeScript narrow it to bare `object`, which has no such
 * key, so the value is funnelled through this helper instead.
 */
function asObjectMap(value: any): Record<string, any> | null {
  return value && typeof value === "object" ? (value as Record<string, any>) : null;
}

/** RefSeq id of a MANE field in either of the shapes VEP uses. */
function maneRefSeqIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const map = asObjectMap(value);
  if (map) return map.refseq_match || map.id || undefined;
  return undefined;
}

/**
 * What the route can offer a caller whose coordinate's REF allele matched no reference base, and the
 * honest sentence to put beside it.
 *
 * WHY IT IS NOT A PLAIN BUILDER. An offered retry is a CLAIM — "the same locus is spelled differently
 * on the other build" — and the first version made that claim without checking anything: it took the
 * build the annotation had not used and annotated the submitted notation with it. That is wrong in
 * two ways, both observed:
 *
 *  - the position may exist in NEITHER build (`chr1:g.999999999A>G`), where the "other build" spelling
 *    is a coordinate nobody can resolve, and the confident build advice is simply false;
 *  - whether the allele is plausible on the other build is checkable, exactly as the lift checks it —
 *    and it is the difference between a real remedy (a genuine hg19 locus in the GRCh37-only tail of a
 *    chromosome) and a typo. Verified: `chrX:g.23723975C>A` (hg19 ACOT9) has GRCh38 base `A` and
 *    GRCh37 base `C`, so that retry works; `chr1:g.999999999A>G` has no base at all.
 *
 * KNOWN LIMITS, stated rather than hidden: a matching base is necessary, not sufficient — most
 * positions have the same base in both builds, so the hint stays a suggestion, and the retry is
 * verified by the pipeline exactly like a hand-typed annotation.
 */
type BuildHintOutcome =
  | { status: "offered"; hint: BuildHint }
  | {
      status: "withheld";
      reason:
        /** No build decision to speak from — the refusal predates it. */
        | "no-decision"
        /** The submitted build was already verified against the other one; there is no untried build. */
        | "already-verified"
        /** The notation cannot carry a build annotation at all (a bare `c.`, a protein notation). */
        | "not-annotatable"
        /**
         * The notation CAN state a build, but carries no genomic position whose reference base could be
         * checked (cDNA): an alternative spelling could not be verified, so none is offered.
         */
        | "no-reference-base-to-check"
        /** NEITHER build carries the submitted allele at that position. */
        | "no-build-carries-allele"
        /** The build already read against DOES carry it, so the build is not what disagrees. */
        | "submitted-build-carries-allele"
        /** The other build could not be checked (no parts, or its host did not answer). */
        | "unverifiable";
    };

/** The submitted coordinate the refusal is about, ready to annotate for the other build. */
function submittedLocusOf(decision: IntakeAssemblyDecision): string | null {
  const { chrom, pos, ref, alt } = parseGenomicHgvsNotation(decision.notation) ?? {};
  if (!chrom || pos === undefined || !ref || !alt) return null;
  return `Chr${chrom}(${decision.submittedAssembly}):g.${pos}${ref}>${alt}`;
}

async function buildHintFor(decision: IntakeAssemblyDecision | undefined): Promise<BuildHintOutcome> {
  if (!decision) return { status: "withheld", reason: "no-decision" };

  /**
   * A VERIFIED lift means the submitted build and the canonical build were already compared for this
   * very position and were found to agree. `decision.notation` is then the LIFTED spelling, which the
   * caller never submitted — offering it as "the same locus in the other build" would aim the retry at
   * a different position. There is also no untried build left to offer.
   */
  if (decision.coordinateLift.status === "lifted") {
    return { status: "withheld", reason: "already-verified" };
  }

  /**
   * A cDNA notation CAN state its build (on the transcript), but a `c.` position is a place in a
   * TRANSCRIPT, not in a reference assembly — there is no base here to check against the other build,
   * so no alternative could be verified. Withheld rather than offered unverified: the earlier version
   * would have proposed a spelling nothing had checked, and the copy would have claimed the other
   * build carries the allele. The remedy is still reachable and is stated in words instead (state the
   * build on the transcript), which the reader can do with the field's own build control.
   */
  const locus = submittedLocusOf(decision);
  if (!locus) {
    return {
      status: "withheld",
      reason: withAssemblyAnnotation(decision.notation, decision.resolveAssembly)
        ? "no-reference-base-to-check"
        : "not-annotatable",
    };
  }

  const alternative: GenomeAssembly = decision.resolveAssembly === "GRCh38" ? "GRCh37" : "GRCh38";
  const notation = withAssemblyAnnotation(locus, alternative);
  if (!notation) return { status: "withheld", reason: "not-annotatable" };

  const parsed = parseGenomicHgvsNotation(locus);
  if (!parsed) return { status: "withheld", reason: "unverifiable" };

  /**
   * BOTH builds' reference base at the submitted position, checked against the submitted allele — the
   * same check the lift performs, and the difference between advice and a guess.
   *
   * WHY BOTH. One check answers "would the retry work?"; the pair answers "is the build the explanation
   * AT ALL?", which is the question the reader actually has:
   *
   *  - the other build carries the allele, the submitted one does not → the build is the explanation,
   *    and the retry is the remedy (verified live: `chrX:g.23723975C>A` is GRCh37 `C` / GRCh38 `A`);
   *  - NEITHER carries it → the position or the alleles are wrong, and a "try the other build" button
   *    would be a promise nobody can keep (`chr1:g.999999999A>G`: no base on either — there is no such
   *    position, and the confident build advice the first version gave was simply false);
   *  - the SUBMITTED build already carries it → the build is not what disagrees, whatever the provider
   *    said, so the honest answer is to re-read the position and the alleles.
   *
   * The pair also makes a retry LOOP impossible in principle: an offered hint means the offered build
   * carries the submitted allele, so annotating there cannot reproduce the mismatch at that position —
   * and the middle case, where both builds carry it and the ping-pong would otherwise be endless, is
   * withheld rather than offered.
   *
   * Bounded so a slow archive cannot hold the refusal open; this runs on a path that has already spent
   * a whole ladder run, and neither request is worth waiting on to say "I could not check".
   */
  const deadlineAt = Date.now() + REFERENCE_MISMATCH_CHECK_BUDGET_MS;
  const [submittedReference, alternativeReference] = await Promise.all([
    fetchAssemblyReferenceBase(parsed.chrom, parsed.pos, decision.submittedAssembly, deadlineAt),
    fetchAssemblyReferenceBase(parsed.chrom, parsed.pos, alternative, deadlineAt),
  ]);

  if ("failure" in alternativeReference) {
    return {
      status: "withheld",
      reason: alternativeReference.failure === "no-mapping" ? "no-build-carries-allele" : "unverifiable",
    };
  }
  if (alternativeReference.base !== parsed.ref) {
    return { status: "withheld", reason: "no-build-carries-allele" };
  }
  // Only when the submitted build's base was actually READ: a failed check says nothing either way.
  if (!("failure" in submittedReference) && submittedReference.base === parsed.ref) {
    return { status: "withheld", reason: "submitted-build-carries-allele" };
  }

  return {
    status: "offered",
    hint: {
      assembly: alternative,
      triedAssembly: decision.resolveAssembly,
      notation,
      reason:
        `the reference allele matched no reference base on ${decision.resolveAssembly} at that ` +
        `position, while ${alternative} carries the submitted allele there`,
    },
  };
}

/**
 * What to add to a reference-mismatch refusal when no retry could be offered.
 *
 * The taxonomy's own message leads with "the usual cause is a genome-build mismatch", which is
 * unhelpful-to-false for every case below — so each one gets the sentence its evidence supports.
 */
function withheldHintAdvice(reason: Extract<BuildHintOutcome, { status: "withheld" }>["reason"]): string {
  switch (reason) {
    case "no-build-carries-allele":
      return (
        " Both builds were checked: neither carries the submitted allele at that position, so check the " +
        "position and the REF/ALT alleles."
      );
    case "submitted-build-carries-allele":
      return (
        " The build this coordinate was read against already carries the submitted allele at that " +
        "position, so the build is not what disagrees here — check the position and the REF/ALT alleles."
      );
    case "no-reference-base-to-check":
      return (
        " A cDNA position names a place in a transcript, not in a reference assembly, so no alternative " +
        "spelling could be verified. If this notation came from another build, state the build on the " +
        "transcript — for example \"NM_000277.5(GRCh37):c.1222C>A\" — and it will be read against that " +
        "reference."
      );
    case "already-verified":
      return (
        " The coordinate was verified against the other build before this annotation ran, so there is " +
        "no untried build left."
      );
    case "not-annotatable":
      return " This notation carries no genomic locus to state a build on; check the position and the alleles.";
    case "unverifiable":
      return " The other build could not be checked right now, so the alleles are worth re-reading.";
    case "no-decision":
    default:
      return "";
  }
}

/** Drops undefined entries so an error payload never carries an empty `details` object. */
function compactDetails(details: Record<string, unknown>): Record<string, unknown> | undefined {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) compact[key] = value;
  }
  return Object.keys(compact).length > 0 ? compact : undefined;
}

/** Classifies a `validateVariant` failure as out-of-scope rather than a malformed request. */
function isNonMissenseMessage(message: string): boolean {
  return (
    message.includes("Nonsense") ||
    message.includes("Frameshift") ||
    message.includes("Insertion/deletion") ||
    message.includes("Synonymous") ||
    message.includes("Start-loss") ||
    message.includes("Protein effect unknown")
  );
}

/**
 * What is wrong with a cDNA notation's reference sequence, in the reader's terms.
 *
 * Each message names the fix rather than the rule: a bare `c.` is missing its transcript, a protein
 * accession cannot carry `c.` positions, and HGVS writes the type prefix in lower case. All three
 * would otherwise reach a provider that cannot parse them.
 */
function cdnaProblemMessage(problem: CdnaReferenceProblem, variant: string): string {
  switch (problem) {
    case "protein-accession":
      return (
        `"${variant}" numbers a cDNA position on a PROTEIN accession. A "c." description needs a ` +
        `nucleotide reference sequence — for example "NM_004333.6:c.1799T>A". Protein accessions ` +
        `carry protein-level positions instead, like "NP_001032248.1:p.Lys281Asn".`
      );
    case "type-prefix-case":
      return (
        `"${variant}" must write the HGVS type prefix in lower case: "c.1799T>A", not "C.1799T>A" ` +
        `(the same rule applies to "g." and "p.").`
      );
    case "missing-transcript":
    default:
      return (
        `"${variant}" is a cDNA position without a transcript. A "c." description must name the ` +
        `reference sequence its positions are numbered on — for example "NM_004333.6:c.1799T>A" — ` +
        `and a genome build can be stated on it: "NM_004333.6(GRCh37):c.1799T>A".`
      );
  }
}

export function registerTranslationRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
    const parseResult = translateVariantSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    /**
     * The build decision, declared OUTSIDE the try so the error paths can report it too: a request
     * whose coordinate was verified on the canonical build and whose providers then failed must say
     * which build answered (see the catch block). `undefined` until the decision is taken, which is
     * itself meaningful — the 400s raised before it have no build decision to report.
     */
    let decision: IntakeAssemblyDecision | undefined;
    try {
      /**
       * Identifiers (rs…, VCV…) and gene-qualified cDNA (`NAE1:c.347A>G`) are rewritten into an
       * ordinary coordinate / transcript notation first, so every gate below applies to them
       * unchanged. An identifier naming several substitutions is refused with the alternatives.
       */
      const intake = await resolveIdentifierIntake(req.body.variant);
      if (intake.status === "refused") {
        sendError(
          res,
          intake.httpStatus,
          intake.code,
          intake.message,
          intake.candidates ? { candidates: intake.candidates } : undefined
        );
        return;
      }
      const variant: string = intake.notation;
      const inputResolution = intake.status === "rewritten" ? intake.resolution : undefined;

      /**
       * A notation may state ONE build. Two annotations are a contradiction, and every reading of them
       * is a choice made on the caller's behalf: the first would decide the host, while the second
       * survived in the string that was queried and echoed back as `notationNormalized` — so a request
       * could be sent as GRCh37 while its own text said GRCh38. Refused, not resolved.
       */
      const annotations = assemblyAnnotationsOf(variant);
      if (annotations.length > 1) {
        sendError(
          res,
          400,
          "BAD_REQUEST",
          `"${variant}" states more than one genome build (${annotations.join(" and ")}). ` +
            `State exactly one — for example "Chr1(GRCh37):g.25484258G>A" — so the coordinate is read ` +
            `against the reference you mean.`
        );
        return;
      }

      // Any inline genome-build annotation (e.g. "(GRCh38)", "(hg19)") must be read
      // BEFORE normalization strips it, because it decides which Ensembl host to query.
      const annotationAssembly = detectAssemblyAnnotation(variant);
      const assembly: GenomeAssembly = annotationAssembly ?? DEFAULT_ASSEMBLY;

      // Canonicalize: strip EVERY annotation and normalize `chr` casing.
      // "Chr1(GRCh38):g.25484258G>A" -> "chr1:g.25484258G>A"
      let trimmed = normalizeGenomicNotation(variant);

      const coordinate = parseGenomicNotation(trimmed);
      if (coordinate) {
        /**
         * Single bases are a substitution. Anything longer (common in VCF rows) is written as the
         * `delins` it is — `GAG>A` is not HGVS and used to fail as a generic format error — so the
         * gates below answer properly: an equal-length 2–3 bp change may be one codon and goes to VEP
         * (`isInFrameSingleAaDelins`), every other length change is refused as non-missense.
         */
        const { pos, ref, alt, chrom } = coordinate;
        const span = ref.length === 1 ? `${pos}` : `${pos}_${pos + ref.length - 1}`;
        trimmed = ref.length === 1 && alt.length === 1
          ? `chr${chrom}:g.${pos}${ref}>${alt}`
          : `chr${chrom}:g.${span}delins${alt}`;
      }

      // ── Missense-only scope gate ────────────────────────────────────────────────
      // Evaluated BEFORE the generic format gate and BEFORE calling VEP. An insertion /
      // deletion / inversion written in otherwise-valid HGVS would otherwise produce a
      // vague "invalid notation format" 400, and translating it would waste a network
      // round trip only to be rejected as a non-missense consequence afterwards.
      if (classifyNotation(trimmed).kind === "non-substitution") {
        sendError(
          res,
          422,
          "NON_MISSENSE_VARIANT",
          `"${variant}" is not a single-nucleotide substitution. ${MISSENSE_ONLY_NOTE}`
        );
        return;
      }

      /**
       * ── cDNA admission gate ─────────────────────────────────────────────────────
       *
       * A `c.` description must hang on a NUCLEOTIDE reference sequence, written with the lower-case
       * type prefix HGVS defines. When it does not, no provider can answer (Ensembl: "Unable to parse
       * HGVS notation"; VariantValidator: `VariantSyntaxError`), so without this gate the round trip
       * ended in "the providers returned unusable responses" plus advice to state a genome build —
       * advice that cannot help when the missing thing is the transcript.
       */
      const cdnaProblem = cdnaReferenceProblem(trimmed);
      if (cdnaProblem) {
        sendError(res, 400, "BAD_REQUEST", cdnaProblemMessage(cdnaProblem, variant));
        return;
      }

      if (!isSupportedGenomicHgvs(trimmed) && !isSupportedCdnaHgvs(trimmed)) {
        // ── Accession-qualified protein notation ──────────────────────────────────────
        // `NP_001032248.1:p.Lys281Asn` (how a lab reports it) or `Q9Y305-4:p.Lys281Asn`. The
        // accession IS the numbering basis, so this resolves exactly — UniProt's RefSeq
        // cross-references name the isoform — and the notation is converted onto canonical
        // numbering before the modelling pipeline ever sees it. Previously the whole family was
        // rejected as an unrecognised format.
        const accessionedProtein = parseAccessionedProteinNotation(trimmed);
        if (accessionedProtein) {
          await AuditLogger.log("TRANSLATE_PROTEIN_NOTATION", {
            accession: accessionedProtein.accession,
          });

          const outcome = await resolveAccessionedProteinNotation(accessionedProtein);

          if (outcome.status === "canonical" || outcome.status === "remapped") {
            let proteinGene: string;
            let canonicalNotation: string;
            try {
              proteinGene = validateGene(outcome.geneSymbol || "");
              canonicalNotation = validateVariant(outcome.canonicalVariant || "");
            } catch (valErr: any) {
              const valErrMessage: string = valErr?.message ?? String(valErr);
              sendError(
                res,
                422,
                isNonMissenseMessage(valErrMessage) ? "NON_MISSENSE_VARIANT" : "UNPROCESSABLE_ENTITY",
                `${accessionedProtein.accession}:${accessionedProtein.proteinNotation} is not a modellable missense substitution: ${valErrMessage}`,
                compactDetails({
                  accession: accessionedProtein.accession,
                  notation: accessionedProtein.proteinNotation,
                })
              );
              return;
            }

            await AuditLogger.log("TRANSLATE_PROTEIN_NOTATION_RESOLVED", {
              accession: accessionedProtein.accession,
              numberingBasis: outcome.status,
              basisId: outcome.basisId,
              canonicalAccession: outcome.canonicalAccession,
            });

            const proteinWarning = buildProteinNumberingRemapWarning(
              outcome,
              accessionedProtein.proteinNotation
            );

            res.json({
              gene: proteinGene,
              variant: canonicalNotation,
              uniprotId: outcome.canonicalAccession ?? "",
              // NOTE: no `uniprotIsoform` here. That field means "the isoform the RETURNED variant
              // is numbered on", and `canonicalNotation` is canonical by construction — reporting
              // the input's isoform (e.g. Q9Y305-4) would describe a numbering this response does
              // not use. The input basis is recorded below in `numberingRemap.from.isoform`.
              ...(/^NP_/.test(accessionedProtein.accession)
                ? { numberingProteinId: accessionedProtein.accession }
                : {}),
              numberingBasis: outcome.status,
              numberingVerified: true,
              ...(outcome.status === "remapped"
                ? {
                    numberingRemap: {
                      reason:
                        "the notation was numbered on a non-canonical isoform of this protein",
                      from: {
                        hgvsp: accessionedProtein.proteinNotation,
                        transcriptId: outcome.transcriptId,
                        isoform: outcome.basisId,
                        accession: outcome.basisAccession,
                      },
                      to: {
                        hgvsp: canonicalNotation,
                        isoform: outcome.canonicalAccession,
                      },
                    },
                  }
                : {}),
              notationNormalized: accessionedProtein.proteinNotation,
              provenance: {
                provider: "uniprot-isoform-model",
                providerLabel: "UniProt (RefSeq ↔ isoform cross-references)",
                usedFallback: false,
                cacheHit: false,
                attempts: [],
              },
              ...(proteinWarning ? { transcriptWarning: proteinWarning } : {}),
            });
            return;
          }

          if (outcome.status === "ambiguous") {
            sendError(
              res,
              422,
              "AMBIGUOUS_PROTEIN_NUMBERING",
              buildAmbiguousNumberingMessage(
                accessionedProtein.proteinNotation,
                outcome.candidates ?? []
              ),
              compactDetails({
                accession: accessionedProtein.accession,
                candidates: (outcome.candidates ?? []).map((candidate) => ({
                  variant: candidate.variant,
                  basisId: candidate.basisId,
                  basisKind: candidate.basisKind,
                  canonicalPosition: candidate.canonicalPosition,
                  label:
                    candidate.basisKind === "canonical"
                      ? `Canonical numbering (${candidate.basisId})`
                      : `MANE/isoform numbering (${candidate.basisId})`,
                })),
              })
            );
            return;
          }

          // The basis could not be established: refuse rather than guess. Guessing here IS the
          // silent wrong-residue case, so the message names the reliable routes instead.
          if (outcome.status === "unverified") {
            sendError(
              res,
              422,
              "UNPROCESSABLE_ENTITY",
              `Could not establish the numbering basis for ${accessionedProtein.accession}: ${outcome.reason}. ` +
                "Enter the genomic/cDNA coordinate (it resolves the numbering against the reference " +
                "annotation), or qualify the notation with a UniProt isoform (e.g. Q9Y305-4:p.Lys281Asn).",
              compactDetails({
                accession: accessionedProtein.accession,
                notation: accessionedProtein.proteinNotation,
                reason: outcome.reason,
              })
            );
            return;
          }

          sendError(
            res,
            422,
            "UNPROCESSABLE_ENTITY",
            `Could not use ${accessionedProtein.accession}:${accessionedProtein.proteinNotation} — ${outcome.reason}. ` +
              "Check the accession and the residue, or enter the genomic/cDNA coordinate.",
            compactDetails({
              accession: accessionedProtein.accession,
              notation: accessionedProtein.proteinNotation,
              reason: outcome.reason,
            })
          );
          return;
        }

        sendError(res, 400, "BAD_REQUEST", `Invalid notation format: "${variant}". Must be ${ACCEPTED_NOTATION_SUMMARY}.`);
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Coord Translator] Resolving notation "${trimmed}" against ${assembly}...`);
      } else {
        console.log(`[Coord Translator] Resolving coordinate notation (${assembly})...`);
      }

      /**
       * ── Genome-build intake policy ──────────────────────────────────────────────
       * "Coordinates are LIFTED to the canonical build when the input build differs, and the lift is
       * REVERSE-VERIFIED before use" (`src/shared/assembly.ts`). A submitted GRCh37 coordinate is
       * therefore annotated on GRCh38 — the release that carries MANE Select, `uniprot_isoform` and
       * current gene symbols — instead of on Ensembl's frozen GRCh37 archive. When no verified lift
       * exists the coordinate keeps its own build and the decision says why, so a reader can tell
       * "annotated on the old release" from "annotated on the canonical one".
       *
       * Done BEFORE the ladder so the resolution cache key, the ladder's host, every downstream
       * message and the response all agree on one build; and AFTER the missense/notation gates, so
       * a coordinate that can never be lifted (indel, cDNA, protein) never pays for an attempt.
       *
       * ── ONE allowance for the whole call, split between the lift and the ladder ──
       * The client gives this route 60s (`src/api/structureApi.ts`) and documents that the ladder's
       * own 40s budget must fit inside it — Ensembl VEP legitimately needs 20-34s under load. A lift
       * in front of the ladder therefore cannot be given an unbounded share: the lift is capped
       * ({@link INTAKE_LIFT_BUDGET_MS}), the ladder is told what remains, and the 52s ceiling keeps
       * the sum below the client's deadline with margin for transport and serialization. Without
       * this arithmetic the two budgets would each look reasonable and their SUM would be what
       * aborts a request that was about to succeed.
       */
      const requestDeadlineAt = Date.now() + TRANSLATE_TOTAL_BUDGET_MS;

      decision = await decideIntakeAssembly({
        notation: trimmed,
        annotatedAssembly: assembly,
        annotationPresent: annotationAssembly !== null,
        // Never past the request deadline: a lift that cannot finish inside the allowance must
        // degrade to the submitted build, not consume the ladder's time.
        deadlineAt: Math.min(requestDeadlineAt, Date.now() + INTAKE_LIFT_BUDGET_MS),
      });
      // The submitted build (what the caller's notation is expressed in) and the build the
      // annotation actually ran against. They are the same string unless a lift was verified.
      const submittedAssembly: GenomeAssembly = decision.submittedAssembly;
      const resolveAssembly: GenomeAssembly = decision.resolveAssembly;
      const queryNotation = decision.notation;
      const coordinateLift = decision.coordinateLift;
      const liftedCoordinates = decision.liftedCoordinates;

      if (process.env.NODE_ENV !== "production" && resolveAssembly !== submittedAssembly) {
        console.log(
          `[Coord Translator] Coordinate verified on ${resolveAssembly} (submitted build ` +
            `${submittedAssembly}): "${queryNotation}"`
        );
      }

      await AuditLogger.log("TRANSLATE_VARIANT", {
        // The SUBMITTED notation, because that is what the caller asked for — and because the audit
        // anonymizer hashes this field, so hashing the LIFTED spelling gave one request two
        // pseudonyms across its two rows and broke request↔resolution correlation. The locus
        // actually queried travels beside it.
        variant: trimmed,
        assembly: submittedAssembly,
        queryNotation,
        resolvedAssembly: resolveAssembly,
        liftStatus: coordinateLift.status,
      });

      // Tier 0 (immutable cache) -> Tier 1 (Ensembl VEP) -> Tier 2 (VariantValidator).
      // The ladder owns transcript selection AND protein-numbering reconciliation, because the
      // cache decision depends on the latter (an unverified numbering must stay re-resolvable).
      // Throws CoordinateResolutionError so the catch block below can answer 503/404/502
      // honestly instead of a blanket 500.
      const resolution = await resolveCoordinate(queryNotation, resolveAssembly, undefined, {
        // What the lift left of the allowance, never more than the ladder's own budget (so a fast
        // lift changes nothing) and never less than a floor that lets both rungs answer.
        budgetMs: Math.max(
          10_000,
          Math.min(DEFAULT_RESOLUTION_BUDGET_MS, requestDeadlineAt - Date.now())
        ),
      });
      const consequence = resolution.consequence;

      const chr = consequence.seq_region_name;
      const startPos = consequence.start;
      const alleleStr = consequence.allele_string;
      const strand = consequence.strand;
      const echoedCoordinates =
        chr && startPos && typeof alleleStr === "string"
          ? (() => {
              const parts = alleleStr.split("/");
              return parts.length >= 2 ? buildForwardStrandGenomicId(chr, startPos, parts[0], parts[1], strand) : null;
            })()
          : null;
      /**
       * `genomicCoordinates` is one half of a PAIR: `assembly` is the build it belongs to, and the
       * client forwards both to the predictors. So the locus must be the CALLER's whenever the
       * notation states one:
       *
       *   - a verified lift moved the locus, and the provider echo is the CANONICAL build's
       *     coordinate — forwarding it under the submitted build's tag is the wrong-locus hazard;
       *   - no lift, but the notation IS a genomic coordinate: the caller's own locus is
       *     authoritative for the pair. An honest build-specific provider echoes the same locus
       *     (Ensembl hosts are per-build; VariantValidator is read from
       *     `primary_assembly_loci[assembly]`), so this changes nothing today — it removes the need
       *     to ASSUME it. Found by review: the earlier form of this branch took the echo whenever no
       *     lift happened, which left the invariant resting on every provider's good behaviour.
       *
       * A cDNA notation has no genomic locus of its own, so there the echo is the only source — which
       * is what the fallback is for.
       */
      const genomicCoordinates: string | null =
        decision.submittedCoordinates ?? echoedCoordinates;

      const transcriptConsequences = consequence.transcript_consequences ?? [];

      if (!resolution.proteinChangeFound || !resolution.numbering) {
        // Every rung was asked and none reported a protein change: this is a property of the
        // VARIANT, not a system failure, so answer with what the coordinate actually is instead
        // of a bare "not found" that reads like a bug and dead-ends the UI.
        const informativeTc = pickInformativeConsequence(transcriptConsequences);

        /**
         * The build label must describe the SAME locus the message names.
         *
         * `buildNoProteinChangeMessage` prints `"<notation>" resolves on <assembly> to …`, so pairing
         * the submitted GRCh37 spelling with the resolved (GRCh38) build produced
         * `"chr1:g.1256452C>A" resolves on GRCh38 to intron_variant…` — a GRCh37 position wearing a
         * GRCh38 label, in prose, which is the hazard this whole module exists to refuse. When a lift
         * happened, the message therefore names the QUERY locus and build, and states the submitted
         * spelling first so the reader still recognises their own input.
         */
        const liftPrefix = liftedCoordinates
          ? `"${trimmed}" was verified on the ${resolveAssembly} reference as ` +
            `"${queryNotation}". `
          : "";
        const messageNotation = liftedCoordinates ? queryNotation : trimmed;

        sendError(
          res,
          422,
          "NON_MISSENSE_VARIANT",
          liftPrefix + buildNoProteinChangeMessage(messageNotation, resolveAssembly, informativeTc),
          compactDetails({
            gene: informativeTc?.gene_symbol,
            transcriptId: informativeTc?.transcript_id,
            hgvsc: informativeTc?.hgvsc,
            consequence: informativeTc?.consequence_terms,
            notation: trimmed,
            assembly: submittedAssembly,
            ...(resolveAssembly !== submittedAssembly ? { resolvedAssembly: resolveAssembly } : {}),
            ...(liftedCoordinates ? { liftedGenomicCoordinates: liftedCoordinates } : {}),
            coordinateLift,
          })
        );
        return;
      }

      const verdict = resolution.numbering;
      // The pre-reconciliation selection is deterministic (MANE → canonical → any), so the
      // notation the translator originally reported can be recovered for the disclosure.
      const originalSelection = selectProteinConsequence(transcriptConsequences);
      const selectedTc = verdict.consequence;

      if (verdict.status === "unsupported") {
        const isoformLabel = verdict.numberingIsoform
          ? ` (UniProt isoform ${verdict.numberingIsoform})`
          : "";
        /**
         * Names the accession-qualified route as well as the canonical-equivalent notation.
         *
         * This refusal is now reachable from a COORDINATE query — the GRCh37 archive omits VEP's
         * `uniprot_isoform`, so once the isoform is read from UniProt the basis can be known to be
         * non-canonical while no canonically-numbered sibling reports the substitution. "Enter the
         * canonical-equivalent substitution" alone is a dead end for someone who already entered a
         * coordinate; `Q5TA45-5:p.Arg23Leu` is a route that resolves it by sequence anchoring.
         */
        sendError(
          res,
          422,
          "ISOFORM_NUMBERING_MISMATCH",
          `"${trimmed}" resolves to ${selectedTc.gene_symbol || "a transcript"} ` +
            `${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}${isoformLabel}, but that numbering ` +
            `does not match the canonical sequence of ${verdict.canonicalAccession}, and ` +
            `${verdict.reason}. Structural modelling needs the variant numbered on the ` +
            "canonical sequence — enter the canonical-equivalent protein substitution" +
            (verdict.numberingIsoform
              ? `, or qualify the notation with the protein it is numbered on ` +
                `(e.g. ${verdict.numberingIsoform}:${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}), ` +
                "which this platform maps onto the canonical sequence."
              : "."),
          compactDetails({
            gene: selectedTc.gene_symbol,
            hgvsp: selectedTc.hgvsp,
            transcriptId: selectedTc.transcript_id,
            isoform: verdict.numberingIsoform,
            uniprotId: verdict.canonicalAccession,
            reason: verdict.reason,
            notation: trimmed,
            assembly: submittedAssembly,
            ...(resolveAssembly !== submittedAssembly ? { resolvedAssembly: resolveAssembly } : {}),
            ...(liftedCoordinates ? { liftedGenomicCoordinates: liftedCoordinates } : {}),
            coordinateLift,
          })
        );
        return;
      }

      let geneSymbol: string;
      let proteinPart: string;
      let uniprotId = "";

      // After a remap the accession that was VERIFIED is the reconciliation one — never the
      // sibling's own `swissprot`, which nothing cross-checked (a sibling claiming a different
      // accession previously produced `uniprotId: P99999` beside `uniprotIsoform: Q9Y305-1`).
      // For an unverified answer the reported accession is kept so the client can still resolve
      // the sequence it is about to model against.
      const accessionSource =
        verdict.canonicalAccession ?? selectedTc.swissprot?.[0]?.split(".")[0];
      // A remapped consequence annotates the SAME gene, so gene-level metadata is inherited
      // when the replacement transcript's record omits it.
      const geneSymbolSource = selectedTc.gene_symbol || originalSelection?.gene_symbol;

      try {
        geneSymbol = validateGene(geneSymbolSource || "");
        proteinPart = validateVariant(selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp);
        if (accessionSource) {
          uniprotId = validateUniProt(accessionSource);
        }
      } catch (valErr: any) {
        // `valErr` is an Error; interpolating it directly yields "Error: ..." and loses the
        // message, so the classifier and the surfaced text both read `.message`.
        const valErrMessage: string = valErr?.message ?? String(valErr);
        const isNonMissense = isNonMissenseMessage(valErrMessage);

        const errorCode = isNonMissense ? REFUSAL_CODES.nonMissenseVariant : "UNPROCESSABLE_ENTITY";
        const errorMsg = isNonMissense
          ? `Genomic coordinate translated to non-missense consequence (${selectedTc.gene_symbol || "Gene"} ${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}): ${valErrMessage}`
          : `Resolved variant values are invalid: ${valErrMessage}`;

        sendError(res, 422, errorCode, errorMsg, compactDetails({
          gene: selectedTc.gene_symbol,
          hgvsc: selectedTc.hgvsc,
          hgvsp: selectedTc.hgvsp,
          consequence: selectedTc.consequence_terms,
          uniprotId: verdict.canonicalAccession,
        }));
        return;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log(`[VEP Translator] Resolved VCF/cDNA to: Gene: ${geneSymbol}, Protein Variant: ${proteinPart}, UniProt: ${uniprotId}`);
      } else {
        console.log("[VEP Translator] Resolved VCF/cDNA successfully.");
      }

      // Recorded AFTER resolution so the audit trail states the numbering basis that was
      // actually analysed, not only the notation that was requested — and which reference release
      // numbered it, which is a different question once a GRCh37 coordinate is lifted.
      await AuditLogger.log("TRANSLATE_VARIANT_RESOLVED", {
        variant: trimmed,
        assembly: submittedAssembly,
        resolvedAssembly: resolveAssembly,
        liftStatus: coordinateLift.status,
        numberingBasis: verdict.status,
        provider: resolution.consequence.provider,
        usedFallback: resolution.usedFallback,
        cacheHit: resolution.cacheHit,
        // Present only when the provider named the gene with a retired symbol that UniProt lists as
        // a synonym (Ensembl's GRCh37 archive answers `CPSF3L` for `INTS11`). Recorded so a reader
        // can tell the returned `gene` is a refreshed symbol rather than what was reported.
        ...(resolution.consequence.geneSymbolUpdated
          ? { geneSymbolUpdated: resolution.consequence.geneSymbolUpdated }
          : {}),
      });

      const transcriptId: string = selectedTc.transcript_id || "";
      const isManeSelect: boolean = !!selectedTc.mane_select;
      const isManePlusClinical: boolean = !!selectedTc.mane_plus_clinical;
      const isCanonical: boolean = !!(
        selectedTc.canonical === 1 ||
        selectedTc.canonical === true ||
        selectedTc.canonical === "1"
      );

      const maneRefSeqId =
        maneRefSeqIdOf(selectedTc.mane_select) ?? maneRefSeqIdOf(selectedTc.mane_plus_clinical);
      // The MANE identifier of the ORIGINAL selection, for the remap record: after a remap the
      // analysed transcript is no longer the MANE one, so its own fields cannot supply it.
      const originalManeRefSeqId =
        maneRefSeqIdOf(originalSelection?.mane_select) ??
        maneRefSeqIdOf(originalSelection?.mane_plus_clinical);

      let transcriptWarning: string | undefined = undefined;
      if (verdict.status === "remapped" && originalSelection) {
        // A remap note REPLACES the generic transcript warnings: it already explains which
        // transcripts/isoforms are involved, and appending "Ensembl canonical transcript used
        // (not explicitly tagged MANE Select)" beside it would read as two unrelated caveats.
        transcriptWarning = buildIsoformRemapWarning(
          originalSelection.hgvsp ?? "",
          selectedTc.hgvsp ?? "",
          verdict.fromIsoform,
          verdict.numberingIsoform,
          originalManeRefSeqId
        );
      } else if (verdict.status === "unverified") {
        // Never silent: an un-verified numbering is exactly the state in which a prediction can
        // describe a different residue than the one that was requested.
        transcriptWarning = buildUnverifiedNumberingWarning(
          selectedTc.hgvsp,
          verdict.canonicalAccession,
          verdict.reason ?? "the reference provider did not state the numbering basis"
        );
      } else if (!isManeSelect && !isManePlusClinical && !isCanonical) {
        transcriptWarning = "Non-canonical transcript used — disease isoform may differ. Verify transcript against MANE Select or RefSeq clinical.";
      } else if (!isManeSelect && !isManePlusClinical && isCanonical) {
        transcriptWarning = "Ensembl canonical transcript used (not explicitly tagged MANE Select). Verify isoform against clinical databases.";
      }

      // Surfaced so the client can display which build was actually annotated, and say so when the
      // submitted build differs from it. Written by the intake decision, which is the only place
      // that knows whether a lift was verified — "resolved against the GRCh37 reference" would be
      // false for a lifted coordinate, and was true here only while the archive was queried.
      const assemblyNote = decision.assemblyNote;

      // The stated transcript version is not the current one. The resolution used the stated
      // version's own sequence, so it stands; the reader is told, ahead of any other caveat.
      const transcriptVersionNote = resolution.consequence.transcriptVersionNote;
      if (transcriptVersionNote) {
        const versionSentence = `${transcriptVersionNote.replace(/\.?$/, ".")} Resolved on the version you entered.`;
        transcriptWarning = transcriptWarning ? `${versionSentence} ${transcriptWarning}` : versionSentence;
      }

      res.json({
        gene: geneSymbol,
        variant: proteinPart,
        uniprotId,
        transcriptId,
        isManeSelect,
        isManePlusClinical,
        isCanonical,
        maneRefSeqId,
        genomicCoordinates,
        // The build the CALLER's coordinate is expressed in — what a report cites and what the
        // client must pair with `genomicCoordinates`.
        assembly: submittedAssembly,
        // The build the annotation came from. Equal to `assembly` unless a lift was verified.
        resolvedAssembly: resolveAssembly,
        // The verified canonical locus, present only when a lift was verified. Forwarding this
        // lets the predictor query the canonical build directly instead of lifting a second time.
        ...(liftedCoordinates ? { liftedGenomicCoordinates: liftedCoordinates } : {}),
        // How the build was decided: submitted vs annotated build, both loci, and — when no lift
        // was used — why. Machine-readable so a report, a UI or an agent can state the trail.
        coordinateLift,
        // Derived from the SAME resolved allele and reconciled canonical protein, never inferred
        // by reversing a protein substitution (multiple nucleotide changes can encode it).
        literatureAliases: verdict.status !== "unverified" && selectedTc.hgvsc
          ? [{ notation: selectedTc.hgvsc, gene: geneSymbol, proteinVariant: proteinPart, uniprotId, source: consequence.provider }]
          : [],
        notationNormalized: trimmed,
        // How an identifier or gene-qualified cDNA was rewritten before resolution, when it was.
        ...(inputResolution ? { inputResolution } : {}),
        ...(transcriptVersionNote ? { transcriptVersionNote } : {}),
        // Present only when the provider named the resolved gene with a RETIRED symbol that UniProt
        // lists as a synonym, and `gene` above is therefore the current HGNC symbol (Ensembl's
        // GRCh37 archive answers `CPSF3L` for `INTS11`). Machine-readable so a report can state
        // which symbol the provider used; every gene-keyed lookup gets the current one.
        ...(resolution.consequence.geneSymbolUpdated
          ? { geneSymbolUpdated: resolution.consequence.geneSymbolUpdated }
          : {}),
        // Which UniProt isoform `variant` is numbered on, and how that basis was established.
        // AlphaFold DB models only canonical sequences, so `canonical`/`remapped` are the only
        // states in which the residue numbers are safe to model; `unverified` is disclosed and
        // re-resolved rather than cached.
        ...(verdict.numberingIsoform ? { uniprotIsoform: verdict.numberingIsoform } : {}),
        // …and, when the provider named the protein the numbering follows without naming a
        // UniProt isoform, that accession too — an unverifiable basis that can still be checked.
        ...(verdict.numberingProteinId ? { numberingProteinId: verdict.numberingProteinId } : {}),
        numberingBasis: verdict.status,
        numberingVerified: verdict.status !== "unverified",
        ...(verdict.status === "unverified" && verdict.reason
          ? { numberingUnverifiedReason: verdict.reason }
          : {}),
        // Present only when the reported notation had to be renumbered onto the canonical
        // isoform. Machine-readable so reports and audit trails can state both notations.
        ...(verdict.status === "remapped" && originalSelection
          ? {
              numberingRemap: {
                // NOT "MANE Select protein numbering": the basis that needed remapping is whatever
                // protein the reporting pipeline used — MANE Select on a current release, and the
                // Ensembl canonical transcript on the GRCh37 archive, which predates MANE. The
                // actual basis is named machine-readably in `from.isoform`.
                reason:
                  "the reported protein's numbering follows a non-canonical UniProt isoform",
                from: {
                  hgvsp: originalSelection.hgvsp,
                  transcriptId: originalSelection.transcript_id,
                  isoform: verdict.fromIsoform,
                  ...(originalManeRefSeqId ? { maneRefSeqId: originalManeRefSeqId } : {}),
                },
                to: {
                  hgvsp: selectedTc.hgvsp,
                  transcriptId: selectedTc.transcript_id,
                  isoform: verdict.numberingIsoform,
                },
              },
            }
          : {}),
        // Provenance: which provider actually answered, whether a fallback was used, and
        // what else was attempted. Cache hits report one synthetic attempt with 0ms.
        provenance: {
          provider: resolution.consequence.provider,
          providerLabel: TRANSLATION_PROVIDER_LABELS[resolution.consequence.provider],
          usedFallback: resolution.usedFallback,
          cacheHit: resolution.cacheHit,
          attempts: resolution.attempts,
        },
        ...(transcriptWarning ? { transcriptWarning } : {}),
        ...(assemblyNote ? { assemblyNote } : {}),
      });
    } catch (err: any) {
      /**
       * A refused coordinate is not a crash, and logging it as one sends whoever reads the server log
       * hunting for a stack trace that does not exist — for the most common clinical outcome there is
       * (a coordinate read against the wrong build). The refusal is logged with its kind, which is the
       * machine-readable cause; anything else is still a crash.
       */
      if (err instanceof CoordinateResolutionError) {
        console.error(`[Coordinate Translator Refused ${err.kind}]: ${err.message}`);
      } else {
        console.error(`[Coordinate Translator Crash]:`, err);
      }

      // Honest status mapping: an upstream outage is NOT an internal server error, and the
      // client needs to be able to tell the difference (retry vs. report a bug).
      if (err instanceof CoordinateResolutionError) {
        const { status, code } = resolutionFailureToHttp(err.kind);


        /**
         * The build trail travels with the FAILURE too.
         *
         * `decision` exists by the time the ladder runs, so a request whose lift was verified and
         * whose providers then failed was answering `{attempts}` alone — and the 404 text asks the
         * reader to "verify … genome build" for a coordinate the server itself had already verified.
         * Every response, successful or not, states what the build decision was.
         */
        const buildTrail = typeof decision !== "undefined"
          ? {
              assembly: decision.submittedAssembly,
              resolvedAssembly: decision.resolveAssembly,
              ...(decision.liftedCoordinates
                ? { liftedGenomicCoordinates: decision.liftedCoordinates }
                : {}),
              coordinateLift: decision.coordinateLift,
              ...(decision.assemblyNote ? { assemblyNote: decision.assemblyNote } : {}),
            }
          : {};

        /**
         * The one refusal whose remedy can be a different COORDINATE carries that coordinate, ready
         * to submit — but only once the alternative has been CHECKED to carry the submitted allele
         * (see `buildHintFor`). When nothing could be offered, the MESSAGE says what to look at
         * instead: the taxonomy's sentence leads with "the usual cause is a genome-build mismatch",
         * which is actively misleading for a coordinate whose build was already stated or whose
         * position exists in neither build.
         */
        /**
         * A retired Ensembl transcript version fails in whichever way the providers happen to fail —
         * "not found", an unusable answer (VEP: "Could not get a Transcript object"), or a timeout
         * (VEP has been observed to hang on one) — and each generic sentence ("verify the build",
         * "the providers are degraded") sends the reader looking in the wrong place. The retirement
         * itself is a fact Ensembl confirms, so when it holds it is what the reader is told, with the
         * current-version notation OFFERED, not substituted (see `currentEnsemblTranscriptNotation`
         * for why it cannot be verified automatically). Rate limits and reference mismatches keep
         * their own remedies.
         */
        if (
          (err.kind === "not_found" || err.kind === "invalid_response" || err.kind === "upstream_unavailable") &&
          typeof req.body?.variant === "string"
        ) {
          // Annotation-free, so `ENST….1(GRCh38):c.…` is recognised too. (A `GENE:c.…` rewrite is
          // always to the CURRENT canonical version, so it cannot be the retired one.)
          const submittedNotation = normalizeGenomicNotation(req.body.variant);
          const current = await currentEnsemblTranscriptNotation(submittedNotation);
          if (current) {
            const retired = submittedNotation.split(":")[0];
            sendError(
              res,
              422,
              "TRANSCRIPT_VERSION_RETIRED",
              `${retired} is not in the current Ensembl release, so no provider can place this notation. ` +
                `The current version is ${current.split(":")[0]}: run ${current} if this variant's ` +
                "c. numbering is unchanged in it. Ensembl no longer serves the retired version's " +
                "sequence, so that cannot be checked automatically.",
              { candidates: [current], attempts: err.attempts, ...buildTrail }
            );
            return;
          }
        }

        /**
         * `Retry-After` on BOTH temporary-failure statuses, not just 503.
         *
         * A degraded provider sometimes answers with an unusable payload instead of timing out, which
         * this taxonomy reports as 502 — and a 502 with no cooldown is RETRIED by the client. Observed
         * in the developer console: three whole ladder runs (12.3s) for one query, each re-asking two
         * providers that were already failing. The advertised cooldown is what stops that: the client
         * returns any response whose Retry-After exceeds 2s instead of retrying it, so the user sees
         * this message once and gets the workaround.
         *
         * The per-host circuit breaker cools down for ~60s (jittered), so advise that window.
         */
        if (status === 503 || status === 502) {
          try {
            res.setHeader?.("Retry-After", "60");
          } catch { /* headers already sent */ }
        }

        if (err.kind !== "reference_mismatch") {
          sendError(res, status, code, err.message, { attempts: err.attempts, ...buildTrail });
          return;
        }

        const hint = await buildHintFor(decision);
        sendError(
          res,
          status,
          code,
          hint.status === "offered" ? err.message : `${err.message}${withheldHintAdvice(hint.reason)}`,
          {
            attempts: err.attempts,
            ...buildTrail,
            ...(hint.status === "offered" ? { buildHint: hint.hint } : {}),
          }
        );
        return;
      }

      if (err.name === "AbortError" || err.message.includes("timeout")) {
        sendError(res, 504, "TIMEOUT", "Coordinate translation timed out. Please try again.");
        return;
      }
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "An error occurred during coordinate translation.");
    }
  });
}

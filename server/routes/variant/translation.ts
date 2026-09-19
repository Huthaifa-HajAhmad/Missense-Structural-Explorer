import { type Router } from "express";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  formatZodError,
} from "../../utils.ts";
import {
  GENOMIC_HGVS_PATTERN,
  ACCEPTED_NOTATION_SUMMARY,
  MISSENSE_ONLY_NOTE,
  classifyNotation,
  detectAssemblyAnnotation,
  normalizeGenomicNotation,
  parseAccessionedProteinNotation,
  type GenomeAssembly,
} from "../../../src/shared/variantNotation.ts";
import {
  resolveCoordinate,
  selectProteinConsequence,
  pickInformativeConsequence,
  DEFAULT_ASSEMBLY,
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
  buildProteinNumberingRemapWarning,
  resolveAccessionedProteinNotation,
} from "../../services/translation/protein-numbering.ts";
import { buildAmbiguousNumberingMessage } from "../../services/translation/isoform-remap.ts";

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

export function registerTranslationRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
    const parseResult = translateVariantSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { variant } = req.body;

      // Any inline genome-build annotation (e.g. "(GRCh38)", "(hg19)") must be read
      // BEFORE normalization strips it, because it decides which Ensembl host to query.
      const annotationAssembly = detectAssemblyAnnotation(variant);
      const assembly: GenomeAssembly = annotationAssembly ?? DEFAULT_ASSEMBLY;

      // Canonicalize: strip the annotation and normalize `chr` casing.
      // "Chr1(GRCh38):g.25484258G>A" -> "chr1:g.25484258G>A"
      let trimmed = normalizeGenomicNotation(variant);

      const dashedMatch = trimmed.match(DASHED_GENOMIC_PATTERN);
      if (dashedMatch) {
        trimmed = `chr${dashedMatch[1]}:g.${dashedMatch[2]}${dashedMatch[3].toUpperCase()}>${dashedMatch[4].toUpperCase()}`;
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

      if (!GENOMIC_HGVS_PATTERN.test(trimmed) && !CDNA_PATTERN.test(trimmed)) {
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
                candidates: (outcome.candidates ?? []).map((c) => c.variant),
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

      await AuditLogger.log("TRANSLATE_VARIANT", {
        variant: trimmed,
        assembly
      });

      // Tier 0 (immutable cache) -> Tier 1 (Ensembl VEP) -> Tier 2 (VariantValidator).
      // The ladder owns transcript selection AND protein-numbering reconciliation, because the
      // cache decision depends on the latter (an unverified numbering must stay re-resolvable).
      // Throws CoordinateResolutionError so the catch block below can answer 503/404/502
      // honestly instead of a blanket 500.
      const resolution = await resolveCoordinate(trimmed, assembly);
      const consequence = resolution.consequence;

      const chr = consequence.seq_region_name;
      const startPos = consequence.start;
      const alleleStr = consequence.allele_string;
      let genomicCoordinates: string | null = null;
      if (chr && startPos && typeof alleleStr === "string") {
        const parts = alleleStr.split("/");
        if (parts.length >= 2) {
          genomicCoordinates = `${chr}-${startPos}-${parts[0]}-${parts[1]}`;
        }
      }

      const transcriptConsequences = consequence.transcript_consequences ?? [];

      if (!resolution.proteinChangeFound || !resolution.numbering) {
        // Every rung was asked and none reported a protein change: this is a property of the
        // VARIANT, not a system failure, so answer with what the coordinate actually is instead
        // of a bare "not found" that reads like a bug and dead-ends the UI.
        const informativeTc = pickInformativeConsequence(transcriptConsequences);

        sendError(
          res,
          422,
          "NON_MISSENSE_VARIANT",
          buildNoProteinChangeMessage(trimmed, assembly, informativeTc),
          compactDetails({
            gene: informativeTc?.gene_symbol,
            transcriptId: informativeTc?.transcript_id,
            hgvsc: informativeTc?.hgvsc,
            consequence: informativeTc?.consequence_terms,
            notation: trimmed,
            assembly,
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
        sendError(
          res,
          422,
          "ISOFORM_NUMBERING_MISMATCH",
          `"${trimmed}" resolves to ${selectedTc.gene_symbol || "a transcript"} ` +
            `${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}${isoformLabel}, but that numbering ` +
            `does not match the canonical sequence of ${verdict.canonicalAccession}, and ` +
            `${verdict.reason}. Structural modelling needs the variant numbered on the ` +
            "canonical sequence — enter the canonical-equivalent protein substitution.",
          compactDetails({
            gene: selectedTc.gene_symbol,
            hgvsp: selectedTc.hgvsp,
            transcriptId: selectedTc.transcript_id,
            isoform: verdict.numberingIsoform,
            uniprotId: verdict.canonicalAccession,
            reason: verdict.reason,
            notation: trimmed,
            assembly,
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

        const errorCode = isNonMissense ? "NON_MISSENSE_VARIANT" : "UNPROCESSABLE_ENTITY";
        const errorMsg = isNonMissense
          ? `Genomic coordinate translated to non-missense consequence (${selectedTc.gene_symbol || "Gene"} ${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}): ${valErrMessage}`
          : `Resolved variant values are invalid: ${valErrMessage}`;

        sendError(res, 422, errorCode, errorMsg, compactDetails({
          gene: selectedTc.gene_symbol,
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
      // actually analysed, not only the notation that was requested.
      await AuditLogger.log("TRANSLATE_VARIANT_RESOLVED", {
        variant: trimmed,
        assembly,
        numberingBasis: verdict.status,
        provider: resolution.consequence.provider,
        usedFallback: resolution.usedFallback,
        cacheHit: resolution.cacheHit,
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

      // Surfaced so the client can display which build was actually queried, and warn when
      // an inline annotation redirected the request to the GRCh37 Ensembl host.
      const assemblyNote = annotationAssembly
        ? `Notation annotated "(${annotationAssembly})" — resolved against the ${assembly} reference assembly.`
        : undefined;

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
        assembly,
        notationNormalized: trimmed,
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
                reason:
                  "MANE Select protein numbering differs from the canonical UniProt isoform",
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
      console.error(`[Coordinate Translator Crash]:`, err);

      // Honest status mapping: an upstream outage is NOT an internal server error, and the
      // client needs to be able to tell the difference (retry vs. report a bug).
      if (err instanceof CoordinateResolutionError) {
        const { status, code } = resolutionFailureToHttp(err.kind);

        if (status === 503) {
          // The per-host circuit breaker cools down for ~60s (jittered), so advise that window.
          try {
            res.setHeader?.("Retry-After", "60");
          } catch { /* headers already sent */ }
        }

        sendError(res, status, code, err.message, { attempts: err.attempts });
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

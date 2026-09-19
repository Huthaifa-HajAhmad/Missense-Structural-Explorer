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
  type GenomeAssembly,
} from "../../../src/shared/variantNotation.ts";
import {
  resolveCoordinate,
  DEFAULT_ASSEMBLY,
} from "../../services/translation/coordinate-resolver.ts";
import {
  CoordinateResolutionError,
  TRANSLATION_PROVIDER_LABELS,
  resolutionFailureToHttp,
  type ProteinAlteringConsequence,
  type ResolvedTranscriptConsequence,
} from "../../services/translation/types.ts";
import {
  buildIsoformRemapWarning,
  reconcileIsoformNumbering,
} from "../../services/translation/isoform-numbering.ts";

const translateVariantSchema = z.object({
  variant: z.string().min(1).max(200),
});

/**
 * Explains why a coordinate cannot start the missense pipeline when it resolved to
 * transcript consequences but none carries an HGVSp.
 *
 * This is a property of the VARIANT, not a system failure: intronic / UTR /
 * splice-region / non-coding coordinates have no protein change on ANY reference
 * translator — Ensembl VEP, VariantValidator, or a cached copy of either — so
 * "falling back" to another provider could never succeed. The message therefore names
 * the gene, the actual consequence terms and the transcript-level HGVS (the identifiers
 * a clinician needs to cross-check the coordinate), and states what input WOULD work.
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

      const consequences = consequence.transcript_consequences;
      // Type predicates carry the invariant into the type system: any consequence that reaches
      // the missense path is known to have an `hgvsp`, so the later reassignment onto a
      // reconciled consequence cannot widen it back to `string | undefined`.
      let selectedTc =
        consequences.find(
          (t): t is ProteinAlteringConsequence => Boolean(t.mane_select && t.hgvsp)
        ) ??
        consequences.find(
          (t): t is ProteinAlteringConsequence =>
            Boolean((t.canonical === 1 || t.canonical === true) && t.hgvsp)
        ) ??
        consequences.find((t): t is ProteinAlteringConsequence => Boolean(t.hgvsp));

      if (!selectedTc) {
        // The coordinate resolved, but no transcript consequence describes a
        // protein-altering change (intronic / UTR / splice-region / non-coding gene).
        // That is a property of the VARIANT, not a system failure — no reference
        // translator can produce an HGVSp for it, so answer with the actual consequence
        // instead of a bare "not found" that reads like a bug and dead-ends the UI.
        const informativeTc =
          consequences.find((t) => t.mane_select) ??
          consequences.find((t) => t.canonical === 1 || t.canonical === true) ??
          consequences[0];

        sendError(res, 422, "NON_MISSENSE_VARIANT", buildNoProteinChangeMessage(trimmed, assembly, informativeTc), {
          gene: informativeTc?.gene_symbol,
          transcriptId: informativeTc?.transcript_id,
          hgvsc: informativeTc?.hgvsc,
          consequence: informativeTc?.consequence_terms,
          notation: trimmed,
          assembly,
        });
        return;
      }

      // ── Isoform-numbering reconciliation ────────────────────────────────────────
      // `hgvsp` is numbered on the SELECTED transcript's protein, while `swissprot` names
      // the CANONICAL accession. When a MANE Select transcript maps to a non-canonical
      // UniProt isoform (ACOT9: MANE → Q9Y305-4 vs canonical Q9Y305-1, offset 9 residues)
      // those disagree, and the old code handed the mismatch downstream where FoldX and the
      // biophysics guard rejected it as a "wild-type residue mismatch" — an upstream
      // numbering error surfacing as three fatal console entries. Reconcile here, where the
      // sibling consequences that carry the canonical numbering are still available.
      const canonicalAccession = selectedTc.swissprot?.[0]?.split(".")[0];
      const reconciliation = reconcileIsoformNumbering(selectedTc, consequences, canonicalAccession);
      if (reconciliation.action === "unresolved") {
        const isoformLabel = reconciliation.isoform ? ` (UniProt isoform ${reconciliation.isoform})` : "";
        sendError(
          res,
          422,
          "ISOFORM_NUMBERING_MISMATCH",
          `"${trimmed}" resolves to ${selectedTc.gene_symbol || "a transcript"} ` +
            `${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}${isoformLabel}, but that numbering ` +
            `does not match the canonical sequence of ${canonicalAccession}, and ` +
            `${reconciliation.reason}. Structural modelling needs the variant numbered on the ` +
            "canonical sequence — enter the canonical-equivalent protein substitution.",
          {
            gene: selectedTc.gene_symbol,
            hgvsp: selectedTc.hgvsp,
            transcriptId: selectedTc.transcript_id,
            isoform: reconciliation.isoform,
            uniprotId: canonicalAccession,
            reason: reconciliation.reason,
            notation: trimmed,
            assembly,
          }
        );
        return;
      }

      // The remap is disclosed below rather than applied silently: the analysed variant is no
      // longer the one a MANE-based clinical report would name.
      const remap = reconciliation.action === "remap" ? reconciliation : null;
      // Captured BEFORE the swap so the disclosure can name the notation that was replaced.
      const originalSelection = selectedTc;
      if (remap) selectedTc = remap.consequence;

      let geneSymbol: string;
      let proteinPart: string;
      let uniprotId = "";

      // A remapped consequence annotates the SAME gene, so gene-level metadata is inherited
      // when the replacement transcript's record omits it. Without this, a sparse sibling
      // (no gene_symbol / no swissprot) would turn a valid remap into "Gene symbol must be a
      // non-empty string", or silently drop the UniProt accession the client resolves against.
      const geneSymbolSource = selectedTc.gene_symbol || originalSelection.gene_symbol;
      const swissprotSource = selectedTc.swissprot?.length
        ? selectedTc.swissprot
        : originalSelection.swissprot;

      try {
        geneSymbol = validateGene(geneSymbolSource || "");
        proteinPart = validateVariant(selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp);
        if (swissprotSource && swissprotSource.length > 0) {
          uniprotId = validateUniProt(swissprotSource[0].split(".")[0]);
        }
      } catch (valErr: any) {
        // `valErr` is an Error; interpolating it directly yields "Error: ..." and loses the
        // message, so the classifier and the surfaced text both read `.message`.
        const valErrMessage: string = valErr?.message ?? String(valErr);

        const isNonMissense = valErrMessage.includes("Nonsense") ||
          valErrMessage.includes("Frameshift") ||
          valErrMessage.includes("Insertion/deletion") ||
          valErrMessage.includes("Synonymous");

        const errorCode = isNonMissense ? "NON_MISSENSE_VARIANT" : "UNPROCESSABLE_ENTITY";
        const errorMsg = isNonMissense
          ? `Genomic coordinate translated to non-missense consequence (${selectedTc.gene_symbol || "Gene"} ${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}): ${valErrMessage}`
          : `Resolved variant values are invalid: ${valErrMessage}`;

        sendError(res, 422, errorCode, errorMsg, {
          gene: selectedTc.gene_symbol,
          hgvsp: selectedTc.hgvsp,
          consequence: (selectedTc as any).consequence_terms,
          // Strip the Swiss-Prot version suffix for consistency with the success path.
          uniprotId: selectedTc.swissprot?.[0]?.split(".")[0] ?? ""
        });
        return;
      }

      if (process.env.NODE_ENV !== "production") {
        console.log(`[VEP Translator] Resolved VCF/cDNA to: Gene: ${geneSymbol}, Protein Variant: ${proteinPart}, UniProt: ${uniprotId}`);
      } else {
        console.log("[VEP Translator] Resolved VCF/cDNA successfully.");
      }

      const transcriptId: string = selectedTc.transcript_id || "";
      const isManeSelect: boolean = !!selectedTc.mane_select;
      const isManePlusClinical: boolean = !!selectedTc.mane_plus_clinical;
      const isCanonical: boolean = !!(selectedTc.canonical === 1 || selectedTc.canonical === true);

      let maneRefSeqId: string | undefined = undefined;
      const maneSelectObject = asObjectMap(selectedTc.mane_select);
      const manePlusObject = asObjectMap(selectedTc.mane_plus_clinical);
      if (typeof selectedTc.mane_select === "string") {
        maneRefSeqId = selectedTc.mane_select;
      } else if (maneSelectObject) {
        maneRefSeqId = maneSelectObject.refseq_match || maneSelectObject.id || undefined;
      } else if (typeof selectedTc.mane_plus_clinical === "string") {
        maneRefSeqId = selectedTc.mane_plus_clinical;
      } else if (manePlusObject) {
        maneRefSeqId = manePlusObject.refseq_match || manePlusObject.id || undefined;
      }

      let transcriptWarning: string | undefined = undefined;
      if (remap) {
        // A remap note REPLACES the generic transcript warnings: it already explains which
        // transcripts/isoforms are involved, and appending "Ensembl canonical transcript used
        // (not explicitly tagged MANE Select)" beside it would read as two unrelated caveats.
        transcriptWarning = buildIsoformRemapWarning(
          originalSelection.hgvsp ?? "",
          remap.consequence.hgvsp ?? "",
          remap.fromIsoform,
          remap.toIsoform,
          typeof originalSelection.mane_select === "string" ? originalSelection.mane_select : undefined
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
        // Which UniProt isoform `variant` is numbered on. AlphaFold DB models only canonical
        // sequences, so this is normally the canonical isoform — recorded so a reader can tell
        // which numbering the analysed residues belong to.
        ...(selectedTc.uniprot_isoform?.[0] ? { uniprotIsoform: selectedTc.uniprot_isoform[0] } : {}),
        // Present only when the MANE-resolved notation had to be renumbered to the canonical
        // isoform. Machine-readable so reports and audit trails can state both notations.
        ...(remap
          ? {
              numberingRemap: {
                reason:
                  "MANE Select protein numbering differs from the canonical UniProt isoform",
                from: {
                  hgvsp: originalSelection.hgvsp,
                  transcriptId: originalSelection.transcript_id,
                  isoform: remap.fromIsoform,
                  ...(typeof originalSelection.mane_select === "string"
                    ? { maneRefSeqId: originalSelection.mane_select }
                    : {}),
                },
                to: {
                  hgvsp: remap.consequence.hgvsp,
                  transcriptId: remap.consequence.transcript_id,
                  isoform: remap.toIsoform,
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
          // The per-host circuit breaker cools down for 60s, so advise the same window.
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

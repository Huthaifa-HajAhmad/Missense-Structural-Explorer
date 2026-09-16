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
} from "../../services/translation/types.ts";

const translateVariantSchema = z.object({
  variant: z.string().min(1).max(200),
});

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
      let selectedTc = consequences.find((t) => t.mane_select && !!t.hgvsp);
      if (!selectedTc) {
        selectedTc = consequences.find((t) => (t.canonical === 1 || t.canonical === true) && !!t.hgvsp);
      }
      if (!selectedTc) {
        selectedTc = consequences.find((t) => !!t.hgvsp);
      }

      if (!selectedTc || !selectedTc.hgvsp) {
        sendError(res, 404, "NOT_FOUND", "Could not find a transcript mapping to a protein variant (HGVSp).");
        return;
      }

      let geneSymbol: string;
      let proteinPart: string;
      let uniprotId = "";

      try {
        geneSymbol = validateGene(selectedTc.gene_symbol || "");
        proteinPart = validateVariant(selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp);
        if (selectedTc.swissprot && selectedTc.swissprot.length > 0) {
          uniprotId = validateUniProt(selectedTc.swissprot[0].split(".")[0]);
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
      if (!isManeSelect && !isManePlusClinical && !isCanonical) {
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

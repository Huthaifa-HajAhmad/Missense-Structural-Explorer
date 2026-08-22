import { type Router } from "express";
import { z } from "zod";

import {
  validateGene,
  validateVariant,
  validateUniProt,
  sendError,
  AuditLogger,
  VCF_GENOMIC_PATTERN,
  CDNA_PATTERN,
  DASHED_GENOMIC_PATTERN,
  formatZodError,
} from "../../utils.ts";
import { fetchWithRetry } from "../../services/http-client.ts";

const ensemblResponseSchema = z.array(
  z.object({
    seq_region_name: z.string().optional(),
    start: z.number().optional(),
    allele_string: z.string().optional(),
    transcript_consequences: z.array(
      z.object({
        transcript_id: z.string().optional(),
        canonical: z.union([z.number(), z.boolean()]).optional(),
        mane_select: z.any().optional(),
        mane_plus_clinical: z.any().optional(),
        hgvsp: z.string().optional(),
        gene_symbol: z.string().optional(),
        swissprot: z.array(z.string()).optional()
      })
    ).optional()
  })
);

const translateVariantSchema = z.object({
  variant: z.string().min(1).max(200),
});

export function registerTranslationRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/translate-variant", jsonParserRegular, async (req, res) => {
    const parseResult = translateVariantSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { variant } = req.body;

      let trimmed = variant.trim();
      const dashedMatch = trimmed.match(DASHED_GENOMIC_PATTERN);
      if (dashedMatch) {
        trimmed = `chr${dashedMatch[1]}:g.${dashedMatch[2]}${dashedMatch[3].toUpperCase()}>${dashedMatch[4].toUpperCase()}`;
      }

      if (!VCF_GENOMIC_PATTERN.test(trimmed) && !CDNA_PATTERN.test(trimmed)) {
        sendError(res, 400, "BAD_REQUEST", `Invalid notation format: "${variant}". Must be genomic VCF (e.g., chr7:g.140753336A>T), transcript cDNA (e.g., NM_004333.6:c.1799T>A), or genomic coordinates (e.g., 20-23365054-G-A).`);
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        console.log(`[VEP Translator] Translating notation: "${trimmed}" via Ensembl REST API...`);
      } else {
        console.log("[VEP Translator] Translating notation via Ensembl REST API...");
      }

      await AuditLogger.log("TRANSLATE_VARIANT", {
        variant: trimmed
      });

      const url = `https://rest.ensembl.org/vep/human/hgvs/${encodeURIComponent(trimmed)}?content-type=application/json&hgvs=1&canonical=1&uniprot=1&mane=1`;
      const response = await fetchWithRetry(url, {
        headers: { "Accept": "application/json" },
        timeout: 15000
      });

      if (!response.ok) {
        const text = await response.text();
        sendError(res, response.status === 400 ? 400 : 502, "TRANSLATION_FAILED", `Ensembl VEP API returned status ${response.status}: ${text.slice(0, 300)}`);
        return;
      }

      const rawData = await response.json();
      const parseResult = ensemblResponseSchema.safeParse(rawData);
      if (!parseResult.success) {
        sendError(res, 502, "BAD_GATEWAY", "Ensembl VEP API returned an invalid response structure.");
        return;
      }
      const data = parseResult.data;
      if (data.length === 0 || !data[0].transcript_consequences) {
        sendError(res, 404, "NOT_FOUND", "No transcript consequences found for the provided variant.");
        return;
      }

      const chr = data[0].seq_region_name;
      const startPos = data[0].start;
      const alleleStr = data[0].allele_string;
      let genomicCoordinates: string | null = null;
      if (chr && startPos && typeof alleleStr === "string") {
        const parts = alleleStr.split("/");
        if (parts.length >= 2) {
          genomicCoordinates = `${chr}-${startPos}-${parts[0]}-${parts[1]}`;
        }
      }

      const consequences = data[0].transcript_consequences;
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
        const isNonMissense = valErr.message.includes("Nonsense") ||
          valErr.message.includes("Frameshift") ||
          valErr.message.includes("Insertion/deletion") ||
          valErr.message.includes("Synonymous");

        const errorCode = isNonMissense ? "NON_MISSENSE_VARIANT" : "UNPROCESSABLE_ENTITY";
        const errorMsg = isNonMissense
          ? `Genomic coordinate translated to non-missense consequence (${selectedTc.gene_symbol || "Gene"} ${selectedTc.hgvsp.split(":")[1] || selectedTc.hgvsp}): ${valErr.message}`
          : `Resolved variant values are invalid: ${valErr.message}`;

        sendError(res, 422, errorCode, errorMsg, {
          gene: selectedTc.gene_symbol,
          hgvsp: selectedTc.hgvsp,
          consequence: (selectedTc as any).consequence_terms,
          uniprotId: selectedTc.swissprot?.[0]?.split(".")[0]
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
      if (typeof selectedTc.mane_select === "string") {
        maneRefSeqId = selectedTc.mane_select;
      } else if (selectedTc.mane_select && typeof selectedTc.mane_select === "object") {
        maneRefSeqId = selectedTc.mane_select.refseq_match || selectedTc.mane_select.id || undefined;
      } else if (typeof selectedTc.mane_plus_clinical === "string") {
        maneRefSeqId = selectedTc.mane_plus_clinical;
      } else if (selectedTc.mane_plus_clinical && typeof selectedTc.mane_plus_clinical === "object") {
        maneRefSeqId = selectedTc.mane_plus_clinical.refseq_match || selectedTc.mane_plus_clinical.id || undefined;
      }

      let transcriptWarning: string | undefined = undefined;
      if (!isManeSelect && !isManePlusClinical && !isCanonical) {
        transcriptWarning = "Non-canonical transcript used — disease isoform may differ. Verify transcript against MANE Select or RefSeq clinical.";
      } else if (!isManeSelect && !isManePlusClinical && isCanonical) {
        transcriptWarning = "Ensembl canonical transcript used (not explicitly tagged MANE Select). Verify isoform against clinical databases.";
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
        ...(transcriptWarning ? { transcriptWarning } : {}),
      });
    } catch (err: any) {
      console.error(`[VEP Translator Crash]:`, err);
      if (err.name === "AbortError" || err.message.includes("timeout")) {
        sendError(res, 504, "TIMEOUT", "Ensembl VEP query timed out. Please try again.");
        return;
      }
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "An error occurred during coordinate translation.");
    }
  });
}

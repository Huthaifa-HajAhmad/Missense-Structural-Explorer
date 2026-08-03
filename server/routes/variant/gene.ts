import { type Router } from "express";
import { z } from "zod";

import {
  validateGene,
  sendError,
  formatZodError,
} from "../../utils.ts";
import {
  resolveGeneToUniprot,
  fetchAlphafoldPdb,
} from "../../services/external.ts";

const resolveGeneSchema = z.object({
  gene: z.string(),
});

export function registerGeneRoutes(apiRouter: Router, jsonParserRegular: any): void {

  apiRouter.post("/resolve-gene", jsonParserRegular, async (req, res) => {
    const parseResult = resolveGeneSchema.safeParse(req.body);
    if (!parseResult.success) {
      sendError(res, 400, "BAD_REQUEST", formatZodError(parseResult.error));
      return;
    }
    try {
      const { gene } = req.body;
      let validatedGeneSymbol: string;
      try {
        validatedGeneSymbol = validateGene(gene);
      } catch (err: any) {
        sendError(res, 400, "BAD_REQUEST", err.message);
        return;
      }

      const uniprotId = await resolveGeneToUniprot(validatedGeneSymbol);
      if (!uniprotId) {
        sendError(res, 404, "NOT_FOUND", `Gene '${validatedGeneSymbol}' could not be mapped to a canonical UniProt accession. Please check the spelling or provide a different gene symbol.`);
        return;
      }

      const hasPdb = await fetchAlphafoldPdb(uniprotId);
      res.json({
        gene: validatedGeneSymbol,
        uniprotId,
        pdbUrl: hasPdb ? `/api/v1/alphafold-pdb/${uniprotId}` : null
      });

    } catch (err: any) {
      console.error("Resolve gene route failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to resolve gene to AlphaFold structure.");
    }
  });
}

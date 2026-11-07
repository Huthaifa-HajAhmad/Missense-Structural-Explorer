import { type Router } from "express";
import { z } from "zod";

import {
  validateGene,
  sendError,
  formatZodError,
} from "../../utils.ts";
import { resolveGeneToUniprot } from "../../services/external.ts";
import { GENE_RESOLVE_BUDGET_MS } from "../../../src/shared/structureLookupBudgets.ts";

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

      const budget = AbortSignal.timeout(GENE_RESOLVE_BUDGET_MS);
      const uniprotId = await resolveGeneToUniprot(validatedGeneSymbol, { signal: budget, cappedByCaller: true });
      if (!uniprotId && budget.aborted) {
        sendError(res, 504, "TIMEOUT", "Gene lookup timed out. Please try again.");
        return;
      }
      if (!uniprotId) {
        sendError(res, 404, "NOT_FOUND", `Gene '${validatedGeneSymbol}' could not be mapped to a canonical UniProt accession. Please check the spelling or provide a different gene symbol.`);
        return;
      }

      res.json({ gene: validatedGeneSymbol, uniprotId });

    } catch (err: any) {
      console.error("Resolve gene route failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to resolve gene to a UniProt accession.");
    }
  });
}

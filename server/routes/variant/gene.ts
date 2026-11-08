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

      // The lookup's own fill must not be cancelled by this route's deadline: the same cached fill is
      // shared with other requests. Race the promise against a timer instead. The fill keeps its own 15 s
      // timeout, which is a limit on UniProt and not on this caller, so it is not flagged `cappedByCaller`:
      // a UniProt that hangs that long must count against the per-host breaker.
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>(resolve => {
        timer = setTimeout(() => { timedOut = true; resolve(null); }, GENE_RESOLVE_BUDGET_MS);
      });
      let uniprotId: string | null;
      try {
        uniprotId = await Promise.race([
          resolveGeneToUniprot(validatedGeneSymbol),
          deadline,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!uniprotId && timedOut) {
        sendError(res, 504, "TIMEOUT", "Gene lookup timed out. Please try again.");
        return;
      }
      if (!uniprotId) {
        sendError(res, 404, "NOT_FOUND", `No reviewed human UniProt entry matched '${validatedGeneSymbol}'. Check the spelling or provide a different gene symbol; if UniProt was unreachable, try again.`);
        return;
      }

      res.json({ gene: validatedGeneSymbol, uniprotId });

    } catch (err: any) {
      console.error("Resolve gene route failure:", err);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to resolve gene to a UniProt accession.");
    }
  });
}

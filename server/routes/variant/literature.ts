import { type Router } from "express";
import { sendError } from "../../utils.ts";
import { getGeneCitations, syncLiteratureForGene, searchGeneLiterature } from "../../services/literature-rag.ts";

export function registerLiteratureRoutes(apiRouter: Router): void {
  apiRouter.get("/literature/:gene", async (req, res) => {
    const { gene } = req.params;
    const force = req.query.force === "true";
    const customQuery = typeof req.query.query === "string" && req.query.query.trim().length > 0 
      ? req.query.query.trim() 
      : undefined;

    if (!gene || gene.trim() === "") {
      sendError(res, 400, "BAD_REQUEST", "Gene parameter is required.");
      return;
    }
    
    try {
      const customApiKey = req.headers["x-gemini-session-id"] as string | undefined;
      let citations;

      if (customQuery) {
        citations = await searchGeneLiterature(gene, customApiKey, undefined, customQuery);
      } else {
        citations = await getGeneCitations(gene);
        if (force || citations.length === 0) {
          console.log(`[RAG Route] Syncing default literature for gene: ${gene} (force=${force})`);
          try {
            await syncLiteratureForGene(gene, customApiKey);
          } catch (syncErr: any) {
            console.warn(`[RAG Route Warning] Sync error for ${gene}:`, syncErr.message);
          }
          citations = await getGeneCitations(gene);
        }
      }

      res.json({
        gene: gene.toUpperCase(),
        citations
      });
    } catch (err: any) {
      console.error(`[Route Error] Failed to fetch literature for ${gene}:`, err.message);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to fetch gene literature.");
    }
  });
}

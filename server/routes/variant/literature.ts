import { type Router } from "express";
import { sendError } from "../../utils.ts";
import { getGeneCitations, syncLiteratureForGene } from "../../services/literature-rag.ts";

export function registerLiteratureRoutes(apiRouter: Router): void {
  apiRouter.get("/literature/:gene", async (req, res) => {
    const { gene } = req.params;
    const force = req.query.force === "true";
    if (!gene || gene.trim() === "") {
      sendError(res, 400, "BAD_REQUEST", "Gene parameter is required.");
      return;
    }
    
    try {
      const customApiKey = req.headers["x-gemini-session-id"] as string | undefined;
      if (force) {
        console.log(`[RAG Route] Forcing literature sync for gene: ${gene}`);
        await syncLiteratureForGene(gene, customApiKey);
      }
      let citations = await getGeneCitations(gene);
      if (citations.length === 0) {
        // First-time sync: await background RAG synchronization with a 10s timeout limit so that the first load receives data
        try {
          await Promise.race([
            syncLiteratureForGene(gene, customApiKey),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Literature sync timeout")), 10000))
          ]);
          citations = await getGeneCitations(gene);
        } catch (syncErr: any) {
          console.warn(`[RAG Route Sync Warning] Sync failed or timed out for ${gene}:`, syncErr.message);
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

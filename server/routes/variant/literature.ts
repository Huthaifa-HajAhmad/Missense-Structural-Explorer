import { type Router } from "express";
import { sendError, getApiKeyFromSession } from "../../utils.ts";
import {
  getGeneCitations,
  syncLiteratureForGene,
  searchGeneLiterature,
  literatureCacheKey,
  isLiteratureCacheStale,
  getLiteratureHitCount,
  getLastLiteratureSync,
  formatQueryForEuropePmc,
  EUROPE_PMC_PAGE_SIZE
} from "../../services/literature-rag.ts";

export function registerLiteratureRoutes(apiRouter: Router): void {
  apiRouter.get("/literature/:gene", async (req, res) => {
    // Normalize the gene once, up front: the raw param may carry surrounding whitespace
    // (e.g. `%20TP53%20`), and the cache key joins gene and query with `::` — a gene
    // containing `:` (or anything outside the HGNC symbol charset) could collide with
    // another query's key identity, so it is rejected instead of served.
    const cleanGene = (req.params.gene ?? "").trim();
    const force = req.query.force === "true";
    const customQuery = typeof req.query.query === "string" && req.query.query.trim().length > 0 
      ? req.query.query.trim() 
      : undefined;

    if (!cleanGene || !/^[A-Za-z0-9\-.]+$/.test(cleanGene)) {
      sendError(res, 400, "BAD_REQUEST", "Gene parameter is required.");
      return;
    }
    
    try {
      const customSessionId = req.headers["x-gemini-session-id"] as string | undefined;
      let customApiKey: string | undefined;
      if (customSessionId) {
        try {
          customApiKey = getApiKeyFromSession(customSessionId);
        } catch (_) {
          // If session is invalid/expired, fall through to server-side GEMINI_API_KEY
        }
      }

      // Abort upstream work when the client goes away: the live search used to receive
      // no signal at all, so a stalled Europe PMC call hung the request indefinitely.
      const aborter = new AbortController();
      req.on("close", () => aborter.abort());
      const signal = aborter.signal;

      const gene = cleanGene.toUpperCase();
      const cacheKey = literatureCacheKey(gene, customQuery);
      let citations;
      let degraded = false;

      if (customQuery) {
        // Handles its own cache: a fresh entry is served without going upstream, so
        // re-running the same query is instant. `force` (the Sync button) is passed
        // through so an explicit refresh bypasses the cache instead of silently
        // doing nothing while a query is in the search box. `degraded` marks an
        // upstream failure whose results came from the gene's cached default set.
        const result = await searchGeneLiterature(gene, customApiKey, signal, customQuery, force);
        citations = result.citations;
        degraded = result.degraded;
      } else {
        citations = await getGeneCitations(gene, signal);

        // Refresh on an explicit sync or once the entry has aged past its TTL. The old
        // `citations.length === 0` arm conflated "synced, zero hits" with "never synced"
        // and re-queried Europe PMC on every request for genes with no literature; a cold
        // cache is already reported as stale by `isLiteratureCacheStale`, so it needs no
        // special case. (A cold start also triggers getGeneCitations' own background
        // pre-warm — syncLiteratureForGene reuses that in-flight promise instead of
        // issuing a second upstream query.)
        if (force || isLiteratureCacheStale(cacheKey)) {
          console.log(`[RAG Route] Syncing default literature for gene: ${gene} (force=${force})`);
          try {
            await syncLiteratureForGene(gene, customApiKey, signal);
          } catch (syncErr: any) {
            console.warn(`[RAG Route Warning] Sync error for ${gene}:`, syncErr.message);
          }
          citations = await getGeneCitations(gene, signal);
        }
      }

      // `hitCount` is how many records Europe PMC matched, which is normally larger than
      // the single page we store. Returning it lets the UI explain the difference instead
      // of looking like it dropped results. On a degraded fallback the citations came from
      // the gene's default set rather than this key's own sweep, so this key's hit count
      // — and its query label — would belong to a different result set: report null for
      // both instead of a lying pair.
      const hitCount = degraded ? null : getLiteratureHitCount(cacheKey);

      res.json({
        gene,
        citations,
        hitCount,
        returnedCount: Array.isArray(citations) ? citations.length : 0,
        query: degraded ? null : (customQuery ?? null),
        /*
         * Provenance the Literature tab prints instead of guessing at.
         *
         * `europePmcQuery` is the string this request sent (or, when `degraded`, tried to send): the
         * tab and its rail used to show a client-built default that was never the query that ran.
         * `degraded` says the rows are the gene's cached set because Europe PMC did not answer, which the
         * client could previously only infer from a null hit count. `fetchedAt` is when the query's own
         * sweep last completed, so a cached list is dated rather than presented as live.
         */
        europePmcQuery: formatQueryForEuropePmc(customQuery, gene),
        degraded,
        fetchedAt: degraded ? null : getLastLiteratureSync(cacheKey),
        pageSize: EUROPE_PMC_PAGE_SIZE
      });
    } catch (err: any) {
      console.error(`[Route Error] Failed to fetch literature for ${cleanGene}:`, err.message);
      sendError(res, 500, "INTERNAL_SERVER_ERROR", err.message || "Failed to fetch gene literature.");
    }
  });
}
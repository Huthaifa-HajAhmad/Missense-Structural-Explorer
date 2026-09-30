import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRouter } from "../../routes.ts";

// The behaviour under test is how the route *orchestrates* the service — force
// pass-through, sync conditions, degraded hit counts — so the service is mocked to make
// those decisions observable without touching Europe PMC or the shared database. The
// real `literatureCacheKey` stays in play (via importOriginal spread) so key construction
// is asserted end to end.
vi.mock("../../services/literature-rag.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/literature-rag.ts")>();
  return {
    ...actual,
    getGeneCitations: vi.fn(),
    syncLiteratureForGene: vi.fn(),
    searchGeneLiterature: vi.fn(),
    isLiteratureCacheStale: vi.fn(),
    getLiteratureHitCount: vi.fn(),
    // Mocked so reading a sync time never opens the real shared database.
    getLastLiteratureSync: vi.fn()
  };
});

import {
  getGeneCitations,
  syncLiteratureForGene,
  searchGeneLiterature,
  isLiteratureCacheStale,
  getLiteratureHitCount,
  getLastLiteratureSync
} from "../../services/literature-rag.ts";

function getLiteratureHandler(): any {
  const route: any = (apiRouter as any).stack.find(
    (layer: any) => layer.route && layer.route.path === "/literature/:gene"
  );
  expect(route).toBeDefined();
  return route.route.stack[route.route.stack.length - 1].handle;
}

function makeHarness(query: Record<string, string> = {}, gene = "TP53") {
  const req: any = { params: { gene }, query, headers: {}, on: () => req };
  const res: any = {
    body: undefined as any,
    json(payload: any) {
      this.body = payload;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    getHeader: () => undefined,
    on: () => res
  };
  return { req, res };
}

const citation = {
  id: "123456",
  title: "T",
  abstract: "A",
  authors: "X",
  journal: "J",
  year: 2024,
  url: "https://pubmed.ncbi.nlm.nih.gov/123456/"
};

describe("GET /literature/:gene orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isLiteratureCacheStale).mockReturnValue(false);
    vi.mocked(getLiteratureHitCount).mockReturnValue(1204);
    vi.mocked(getLastLiteratureSync).mockReturnValue(1_700_000_000_000);
    vi.mocked(getGeneCitations).mockResolvedValue([citation]);
    vi.mocked(syncLiteratureForGene).mockResolvedValue(1);
    vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [], degraded: false });
  });

  it("does not re-sync a fresh cache even when it contains zero citations", async () => {
    // Regression: the old `citations.length === 0` arm treated "synced, zero hits" as
    // "never synced" and hit Europe PMC on every request for genes with no literature.
    vi.mocked(getGeneCitations).mockResolvedValue([]);

    const { req, res } = makeHarness();
    await getLiteratureHandler()(req, res);

    expect(syncLiteratureForGene).not.toHaveBeenCalled();
    expect(res.body.citations).toEqual([]);
    expect(res.body.hitCount).toBe(1204);
  });

  it("syncs when the cache is stale", async () => {
    vi.mocked(isLiteratureCacheStale).mockReturnValue(true);
    vi.mocked(getGeneCitations)
      .mockResolvedValueOnce([citation]) // first read: pre-sync contents
      .mockResolvedValueOnce([citation]); // second read: post-sync

    const { req, res } = makeHarness();
    await getLiteratureHandler()(req, res);

    expect(syncLiteratureForGene).toHaveBeenCalledTimes(1);
    expect(getGeneCitations).toHaveBeenCalledTimes(2);
    expect(res.body.citations).toEqual([citation]);
  });

  it("passes force=true through to a custom-query search instead of dropping it", async () => {
    // Regression: force used to be ignored on the custom-query branch, so Sync with a
    // query in the box silently served the cache.
    vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [citation], degraded: false });

    const { req, res } = makeHarness({ query: "tp53 and custom", force: "true" });
    await getLiteratureHandler()(req, res);

    expect(searchGeneLiterature).toHaveBeenCalledWith(
      "TP53",
      undefined,
      expect.any(AbortSignal),
      "tp53 and custom",
      true
    );
    expect(getGeneCitations).not.toHaveBeenCalled();
    expect(getLiteratureHitCount).toHaveBeenCalledWith("TP53::tp53 and custom");
    expect(res.body.hitCount).toBe(1204);
    expect(res.body.returnedCount).toBe(1);
    expect(res.body.query).toBe("tp53 and custom");
    expect(res.body.gene).toBe("TP53");
  });

  it("reports hitCount=null on a degraded fallback instead of a mismatched number", async () => {
    vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [citation], degraded: true });

    const { req, res } = makeHarness({ query: "tp53 and custom" });
    await getLiteratureHandler()(req, res);

    expect(res.body.hitCount).toBeNull();
    expect(getLiteratureHitCount).not.toHaveBeenCalled();
    expect(res.body.citations).toEqual([citation]);
    // The citations came from the gene's default set, not this query's sweep, so the
    // query label must not claim otherwise either.
    expect(res.body.query).toBeNull();
  });

  it("trims a padded gene symbol instead of missing the cache", async () => {
    const { req, res } = makeHarness({}, "  tp53  ");
    await getLiteratureHandler()(req, res);

    expect(res.body.gene).toBe("TP53");
    expect(getGeneCitations).toHaveBeenCalledWith("TP53", expect.any(AbortSignal));
  });

  it("rejects a gene outside the symbol charset instead of serving a colliding key", async () => {
    // `::` joins gene and query in the cache key — a gene containing it could alias
    // another query's result set.
    for (const bad of ["", "   ", "TP53::custom", "TP53;DROP", "BRCA 1"]) {
      const { req, res } = makeHarness({}, bad);
      await getLiteratureHandler()(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toBeDefined();
    }
    expect(getGeneCitations).not.toHaveBeenCalled();
    expect(searchGeneLiterature).not.toHaveBeenCalled();
  });
  describe("provenance the Literature tab prints", () => {
    it("names the Europe PMC query the default list actually ran, not a client-built one", async () => {
      const { req, res } = makeHarness({}, "NAE1");
      await getLiteratureHandler()(req, res);

      // The tab and rail used to show `(NAE1[Gene]) AND ("missense"…)`; the list came from this.
      expect(res.body.europePmcQuery).toBe('NAE1 AND (mutation OR variant OR functional OR "pathogenic")');
      expect(res.body.degraded).toBe(false);
      expect(res.body.pageSize).toBe(25);
      expect(res.body.fetchedAt).toBe(1_700_000_000_000);
    });

    it("reports the gene-scoped form of a custom query, as sent", async () => {
      vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [citation], degraded: false });
      const { req, res } = makeHarness({ query: 'cancer[All Fields]' }, "TP53");
      await getLiteratureHandler()(req, res);

      expect(res.body.europePmcQuery).toBe("(cancer) AND TP53");
    });

    it("marks a degraded fallback explicitly and withholds its sync time", async () => {
      vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [citation], degraded: true });
      const { req, res } = makeHarness({ query: "tp53 and custom" });
      await getLiteratureHandler()(req, res);

      expect(res.body.degraded).toBe(true);
      expect(res.body.fetchedAt).toBeNull();
      expect(getLastLiteratureSync).not.toHaveBeenCalled();
    });
  });
});

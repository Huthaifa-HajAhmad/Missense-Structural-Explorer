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

// Phase 1b curation is orchestrated here but implemented and tested in its own module; the route test
// only needs to observe the orchestration (context pass-through, coverage, separate curated additions).
vi.mock("../../services/llm/curated-literature.ts", () => ({ getCuratedVariantCitations: vi.fn() }));

import {
  getGeneCitations,
  syncLiteratureForGene,
  searchGeneLiterature,
  isLiteratureCacheStale,
  getLiteratureHitCount,
  getLastLiteratureSync,
  literatureCacheKey
} from "../../services/literature-rag.ts";
import { getCuratedVariantCitations } from "../../services/llm/curated-literature.ts";

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
    vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [citation], degraded: false });
    vi.mocked(getCuratedVariantCitations).mockResolvedValue({ citations: [], state: "complete" });
  });

  it("does not re-sync a fresh cache even when it contains zero citations", async () => {
    // Regression: the old `citations.length === 0` arm treated "synced, zero hits" as
    // "never synced" and hit Europe PMC on every request for genes with no literature.
    vi.mocked(getGeneCitations).mockResolvedValue([]);
    vi.mocked(searchGeneLiterature).mockResolvedValue({ citations: [], degraded: false });

    const { req, res } = makeHarness();
    await getLiteratureHandler()(req, res);

    expect(syncLiteratureForGene).not.toHaveBeenCalled();
    expect(res.body.citations).toEqual([]);
    expect(res.body.hitCount).toBe(1204);
  });

  it("cancels upstream only when the response disconnects, not when the request completes", async () => {
    const { req, res } = makeHarness({ query: "TP53" });
    const requestListeners = new Map<string, () => void>();
    const responseListeners = new Map<string, () => void>();
    req.on = (event: string, listener: () => void) => requestListeners.set(event, listener);
    res.on = (event: string, listener: () => void) => responseListeners.set(event, listener);
    await getLiteratureHandler()(req, res);
    const signal = vi.mocked(searchGeneLiterature).mock.calls[0][2]!;
    requestListeners.get("close")?.();
    expect(signal.aborted).toBe(false);
    res.writableEnded = true;
    responseListeners.get("close")?.();
    expect(signal.aborted).toBe(false);
    res.writableEnded = false;
    responseListeners.get("close")?.();
    expect(signal.aborted).toBe(true);
  });

  it("uses the shared search for stale default reads without embedding sync", async () => {
    vi.mocked(isLiteratureCacheStale).mockReturnValue(true);
    vi.mocked(getGeneCitations)
      .mockResolvedValueOnce([citation]) // first read: pre-sync contents
      .mockResolvedValueOnce([citation]); // second read: post-sync

    const { req, res } = makeHarness();
    await getLiteratureHandler()(req, res);

    expect(syncLiteratureForGene).not.toHaveBeenCalled();
    expect(searchGeneLiterature).toHaveBeenCalledWith("TP53", undefined, expect.any(AbortSignal), undefined, false);
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
    expect(getLiteratureHitCount).toHaveBeenCalledWith(literatureCacheKey("TP53", "tp53 and custom"));
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
    expect(searchGeneLiterature).toHaveBeenCalledWith("TP53", undefined, expect.any(AbortSignal), undefined, false);
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

  describe("Phase 1b curated variant citations", () => {
    const curatedLink = {
      provider: "uniprot" as const,
      featureId: "VAR_088123",
      accession: "Q13564",
      variant: "L49F",
      variantDescription: "in NEDFIH",
      evidenceCode: "ECO:0000269",
      pmid: "999",
      source: "PubMed",
      sourceUrl: "https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_088123",
      retrievedAt: "2026-10-05T00:00:00.000Z",
    };
    const curatedOnly = {
      id: "999",
      title: "Curated only",
      abstract: "",
      authors: "X",
      journal: "J",
      year: 2020,
      url: "https://pubmed.ncbi.nlm.nih.gov/999/",
      curatedLinks: [curatedLink],
    };

    it("passes the variant/accession context through and returns curated-only records separately", async () => {
      vi.mocked(getCuratedVariantCitations).mockResolvedValue({ citations: [curatedOnly], state: "complete" });

      const { req, res } = makeHarness({ variant: "p.Leu49Phe", uniprot: "Q13564" }, "NAE1");
      await getLiteratureHandler()(req, res);

      expect(getCuratedVariantCitations).toHaveBeenCalledWith("NAE1", "p.Leu49Phe", "Q13564", expect.any(AbortSignal));
      expect(res.body.curated).toEqual({ state: "complete", linked: 1 });
      // The curated record is shown but is NOT query membership, so `citations` and its count are unchanged.
      expect(res.body.citations.map((c: any) => c.id)).toEqual(["123456"]);
      expect(res.body.returnedCount).toBe(1);
      expect(res.body.curatedCitations.map((c: any) => c.id)).toEqual(["999"]);
      expect(res.body.curatedCitations[0].curatedLinks).toHaveLength(1);
    });

    it("annotates an ordinary record in place and adds nothing when the query already matched it", async () => {
      vi.mocked(getCuratedVariantCitations).mockResolvedValue({
        citations: [{ ...citation, curatedLinks: [{ ...curatedLink, pmid: "123456" }] }],
        state: "complete",
      });

      const { req, res } = makeHarness({ variant: "p.Leu49Phe", uniprot: "Q13564" }, "NAE1");
      await getLiteratureHandler()(req, res);

      expect(res.body.citations).toHaveLength(1);
      expect(res.body.citations[0].curatedLinks).toHaveLength(1);
      expect(res.body.curatedCitations).toEqual([]);
    });

    it("does not run a curated lookup without both context values", async () => {
      for (const query of [{}, { variant: "p.Leu49Phe" }, { uniprot: "Q13564" }] as Array<Record<string, string>>) {
        const { req, res } = makeHarness(query, "NAE1");
        await getLiteratureHandler()(req, res);
        expect(res.body.curated).toBeNull();
        expect(res.body.curatedCitations).toEqual([]);
      }
      expect(getCuratedVariantCitations).not.toHaveBeenCalled();
    });

    it("reports a curated failure explicitly while the ordinary list is unaffected", async () => {
      vi.mocked(getCuratedVariantCitations).mockResolvedValue({ citations: [], state: "error", reason: "UniProt answered 503." });

      const { req, res } = makeHarness({ variant: "p.Leu49Phe", uniprot: "Q13564" }, "NAE1");
      await getLiteratureHandler()(req, res);

      expect(res.body.curated).toEqual({ state: "error", reason: "UniProt answered 503.", linked: 0 });
      expect(res.body.citations).toHaveLength(1);
      expect(res.body.curatedCitations).toEqual([]);
    });

    it("turns a thrown curated lookup into an error state rather than failing the request", async () => {
      vi.mocked(getCuratedVariantCitations).mockRejectedValue(new Error("boom"));

      const { req, res } = makeHarness({ variant: "p.Leu49Phe", uniprot: "Q13564" }, "NAE1");
      await getLiteratureHandler()(req, res);

      expect(res.body.curated).toMatchObject({ state: "error", linked: 0 });
      expect(res.body.citations).toHaveLength(1);
    });
  });
});

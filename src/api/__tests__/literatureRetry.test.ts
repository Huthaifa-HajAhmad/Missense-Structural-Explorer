import { describe, it, expect, vi } from "vitest";

import { createClinicalApi, LITERATURE_CLIENT_TIMEOUT_MS } from "../clinicalApi";

/**
 * Regression guard for the literature fetch failure seen in production.
 *
 * 2026-09-27T19:24:01Z, revision f194815: the deployed app reported `[Literature Fetch Error]:
 * Failed to fetch` with a stack of exactly one frame, `Object.pull` in the client body-stall
 * watchdog (`bindWatchdogToBody`). That frame is only reachable from `reader.read()`, so the
 * response headers HAD arrived and the body was severed — the image had been built at 19:06:22Z
 * and the container was being replaced by that deploy.
 *
 * `fetchWithRetry` only guards the connection phase, so the read that failed had no retry at all.
 * These tests pin the retry of the whole operation (request AND body) and the cases that must
 * still fail on the first attempt.
 */
describe("createClinicalApi().getLiterature", () => {
  const payload = {
    gene: "TP53",
    citations: [
      {
        id: "42693633",
        title: "A Novel BRCA1 Pathogenic Variant",
        abstract: "Background",
        authors: "Smith J",
        journal: "Cancers",
        year: 2026,
        url: "https://pubmed.ncbi.nlm.nih.gov/42693633/",
      },
    ],
    hitCount: 12,
    returnedCount: 1,
    query: null,
  };

  /** A response whose headers arrived and whose body then died — the production shape. */
  const severedBody = () =>
    ({
      ok: true,
      status: 200,
      json: async () => {
        throw new TypeError("Failed to fetch");
      },
    }) as any;

  const goodResponse = () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("preserves structured screening metadata through client validation", async () => {
    const citation = { ...payload.citations[0], publicationTypes: ["Review"], meshHeadings: ["Proteins"], authorKeywords: ["TP53"] };
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...payload, citations: [citation] })));
    const data = await createClinicalApi(fetchWithAuth as any).getLiterature("TP53");
    expect(data.citations[0]).toEqual(citation);
  });

  it("sends the variant/accession context and preserves curated links and coverage", async () => {
    const curatedLink = {
      provider: "uniprot",
      featureId: "VAR_088123",
      accession: "Q13564",
      variant: "L49F",
      variantDescription: "in NEDFIH",
      evidenceCode: "ECO:0000269",
      pmid: "36608681",
      source: "PubMed",
      sourceUrl: "https://www.uniprot.org/uniprotkb/Q13564/variant/VAR_088123",
      retrievedAt: "2026-10-05T00:00:00.000Z",
    };
    const withLinks = { ...payload.citations[0], curatedLinks: [curatedLink] };
    const curatedOnly = { ...payload.citations[0], id: "999", title: "Curated only", curatedLinks: [curatedLink] };
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...payload,
      citations: [withLinks],
      curatedCitations: [curatedOnly],
      curated: { state: "complete", linked: 1 },
    })));

    const data = await createClinicalApi(fetchWithAuth as any)
      .getLiterature("NAE1", false, undefined, undefined, { variant: "p.Leu49Phe", uniprot: "Q13564" });

    expect(fetchWithAuth.mock.calls[0][0]).toBe("/api/v1/literature/NAE1?variant=p.Leu49Phe&uniprot=Q13564");
    expect(data.citations[0].curatedLinks?.[0]).toMatchObject({ provider: "uniprot", pmid: "36608681", featureId: "VAR_088123" });
    expect(data.curatedCitations?.[0].id).toBe("999");
    expect(data.curated).toEqual({ state: "complete", linked: 1 });
  });

  it("rejects a malformed curated link instead of passing it to the screening code", async () => {
    const bad = { ...payload.citations[0], curatedLinks: [{ provider: "uniprot" }] };
    const fetchWithAuth = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...payload, citations: [bad] })));
    await expect(createClinicalApi(fetchWithAuth as any).getLiterature("TP53")).rejects.toBeTruthy();
  });

  it("retries a body severed after the headers and returns the retry's citations", async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValueOnce(severedBody())
      .mockResolvedValueOnce(goodResponse());

    const data = await createClinicalApi(fetchWithAuth as any).getLiterature("TP53");

    expect(data.citations).toHaveLength(1);
    expect(data.hitCount).toBe(12);
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(fetchWithAuth.mock.calls[0][0]).toBe("/api/v1/literature/TP53");
  });

  it("surfaces the raw network error when every attempt is severed", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(severedBody());

    const err: any = await createClinicalApi(fetchWithAuth as any)
      .getLiterature("TP53")
      .catch((e) => e);

    // 1 attempt + 2 retries, and the untouched TypeError (with its body-read stack) is what the
    // console report records — the banner, not the error, is what gets humanised.
    expect(fetchWithAuth).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("Failed to fetch");
  });

  it("does not retry a refusal the server actually sent", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Gene parameter is required." } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const err: any = await createClinicalApi(fetchWithAuth as any)
      .getLiterature("")
      .catch((e) => e);

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(err.message).toBe("Gene parameter is required.");
  });

  it("does not retry the caller's own watchdog timeout", async () => {
    const fetchWithAuth = vi.fn().mockRejectedValue(
      new DOMException(`Response body stalled for ${LITERATURE_CLIENT_TIMEOUT_MS}ms`, "TimeoutError")
    );

    const err: any = await createClinicalApi(fetchWithAuth as any)
      .getLiterature("TP53")
      .catch((e) => e);

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(err.name).toBe("TimeoutError");
  });

  it("keeps every attempt inside the one budget the spinner promised", async () => {
    const fetchWithAuth = vi.fn().mockResolvedValue(severedBody());
    const startedAt = Date.now();

    await createClinicalApi(fetchWithAuth as any).getLiterature("TP53").catch(() => {});

    // Two backoff waits (base 500ms, doubling) plus three immediate failures — nowhere near a
    // fresh 45s per attempt, which is what a per-attempt timeout would have allowed.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});

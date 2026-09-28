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

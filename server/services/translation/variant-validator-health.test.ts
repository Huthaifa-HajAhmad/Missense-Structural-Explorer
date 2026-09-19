import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkVariantValidatorHealth,
  fetchVariantValidatorConsequence,
  VARIANT_VALIDATOR_PROBE,
} from "./variant-validator.ts";
import * as httpClient from "../infra/http-client.ts";

/**
 * Readiness-probe coverage for the coordinate-translation fallback tier.
 *
 * Three properties matter here, and each was wrong in an earlier version:
 *
 *   1. Readiness is defined as what the LIVE path needs — the shared mapper producing a usable
 *      protein consequence — not as a specific gene symbol. Asserting the symbol tested upstream
 *      annotation stability, so a rename or a reference-DB rotation would report a healthy
 *      provider as permanently down.
 *   2. The probe issues the SAME request as the live path. It used to append a `content-type`
 *      query parameter the live path lacked, so it could report the fallback ready while every
 *      real query received XML and failed at `response.json()`.
 *   3. A probe cannot move the circuit breaker that guards real resolutions, and a failure to
 *      determine anything reports `unknown` — never a definite outage, which would tell a
 *      clinician to abandon coordinate notation for a provider that may answer fine.
 */

/** Captured live from VariantValidator for the probe coordinate (MACO1). */
const MACO1_RESPONSE = {
  "NM_018202.6:c.1297G>A": {
    gene_symbol: "MACO1",
    hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
    annotations: { chromosome: "1", mane_select: true, ensembl_select: false },
    primary_assembly_loci: { grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } } },
  },
  flag: "gene_variant",
};

/** The documented silent failure: HTTP 200, `intergenic`, no resolvable consequence. */
const INTERGENIC_RESPONSE = {
  flag: "intergenic",
  intergenic_variant_1: {
    gene_symbol: "",
    hgvs_predicted_protein_consequence: {},
    annotations: {},
    primary_assembly_loci: {},
  },
};

/**
 * Resolves cleanly under a DIFFERENT gene symbol. This must still count as ready: the locus is
 * unchanged, and the symbol is upstream annotation the provider is free to update.
 */
const RENAMED_GENE_RESPONSE = {
  "NM_018202.6:c.1297G>A": {
    gene_symbol: "TMEM57",
    hgvs_predicted_protein_consequence: { tlr: "NP_060672.2:p.(Glu433Lys)" },
    annotations: { chromosome: "1", ensembl_select: false },
    primary_assembly_loci: { grch38: { vcf: { alt: "A", chr: "1", pos: "25484258", ref: "G" } } },
  },
  flag: "gene_variant",
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

describe("checkVariantValidatorHealth", () => {
  let probeFetch: any;

  beforeEach(() => {
    // Per-host breaker and semaphore state is module-global, so without a reset this suite
    // inherits failures recorded by earlier cases (and can leave the breaker open for others).
    httpClient.resetHostStateForTests();
    probeFetch = vi.spyOn(httpClient, "fetchWithRetry");
  });

  afterEach(() => {
    probeFetch?.mockRestore();
    httpClient.resetHostStateForTests();
    vi.restoreAllMocks();
  });

  it("reports ready when the probe coordinate resolves", async () => {
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("ready");
    expect(health.healthy).toBe(true);
    expect(health.message).toContain("MACO1");
  });

  it("stays ready when the provider renames the gene, because readiness is not a symbol check", async () => {
    // The regression this pins: an exact-gene assertion made a healthy provider report as
    // permanently down after an upstream rename (MACO1 was itself formerly TMEM57).
    probeFetch.mockResolvedValue(jsonResponse(RENAMED_GENE_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("ready");
    expect(health.healthy).toBe(true);
    expect(health.message).toContain("TMEM57");
  });

  it("issues exactly the request the live resolution path issues", async () => {
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));
    await checkVariantValidatorHealth();
    const probeUrl = String(probeFetch.mock.calls[0][0]);

    probeFetch.mockClear();
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));
    await fetchVariantValidatorConsequence(VARIANT_VALIDATOR_PROBE.notation, VARIANT_VALIDATOR_PROBE.assembly);
    const liveUrl = String(probeFetch.mock.calls[0][0]);

    expect(probeUrl).toBe(liveUrl);
    // Asserted through the parsed query rather than URL spelling: an equivalent refactor to
    // `searchParams.set` percent-encodes the slash and would fail a substring check while
    // sending byte-identical requests.
    expect(new URL(probeUrl).searchParams.get("content-type")).toBe("application/json");
    expect(probeFetch.mock.calls[0][1].headers.Accept).toBe("application/json");
  });

  it("uses the live path's transport budget, so a slow provider is not scored dead", async () => {
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));
    await checkVariantValidatorHealth();
    const probeInit = probeFetch.mock.calls[0][1];
    const probeAttempts = probeFetch.mock.calls[0][2];

    probeFetch.mockClear();
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));
    await fetchVariantValidatorConsequence(VARIANT_VALIDATOR_PROBE.notation, VARIANT_VALIDATOR_PROBE.assembly);
    const liveInit = probeFetch.mock.calls[0][1];
    const liveAttempts = probeFetch.mock.calls[0][2];

    expect(probeInit.timeout).toBe(liveInit.timeout);
    expect(probeAttempts).toBe(liveAttempts);
  });

  it("marks itself as probe traffic so it cannot trip the breaker guarding real queries", async () => {
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));

    await checkVariantValidatorHealth();

    expect(probeFetch.mock.calls[0][1].probe).toBe(true);
  });

  it("reports unavailable when the provider answers with the silent intergenic failure", async () => {
    probeFetch.mockResolvedValue(jsonResponse(INTERGENIC_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("unavailable");
    expect(health.healthy).toBe(false);
  });

  it("reports unavailable when the body is not JSON", async () => {
    probeFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
      text: async () => "<root/>",
    } as any);

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("unavailable");
  });

  it("reports unavailable for a definitive rejection status", async () => {
    probeFetch.mockResolvedValue(jsonResponse({ error: "nope" }, 400));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("unavailable");
    expect(health.message).toContain("400");
  });

  it("reports UNKNOWN, not an outage, when the provider is unreachable", async () => {
    // The distinction is the point: an unreachable provider is not evidence that it cannot serve
    // a real query, and rendering it as an outage produced the wrong clinical advice.
    probeFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("unknown");
    expect(health.healthy).toBe(false);
    expect(health.message).toBeTruthy();
  });

  it("reports unknown when a retryable status exhausts its attempts", async () => {
    probeFetch.mockRejectedValue(new Error("Failed to fetch after 2 attempts"));

    const health = await checkVariantValidatorHealth();

    expect(health.verdict).toBe("unknown");
  });

  it("returns a parseable timestamp rather than merely a string", async () => {
    probeFetch.mockResolvedValue(jsonResponse(MACO1_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(Number.isNaN(new Date(health.timestamp).getTime())).toBe(false);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

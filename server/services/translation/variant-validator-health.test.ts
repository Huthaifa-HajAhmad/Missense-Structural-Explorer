import { describe, it, expect, vi, afterEach } from "vitest";
import { checkVariantValidatorHealth, VARIANT_VALIDATOR_PROBE } from "./variant-validator.ts";

/**
 * Health-probe coverage for the coordinate-translation fallback tier.
 *
 * The point of these tests is that the probe must NOT be a reachability ping. VariantValidator
 * has no `/info` or `/version` endpoint (both 404), and its silent-failure mode is an HTTP 200
 * carrying no resolvable gene — so a status-code check would report a broken fallback as ready.
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

/** The documented silent failure: HTTP 200, `intergenic`, no gene. Looks fine to a ping. */
const INTERGENIC_RESPONSE = {
  flag: "intergenic",
  intergenic_variant_1: {
    gene_symbol: "",
    hgvs_predicted_protein_consequence: {},
    annotations: {},
    primary_assembly_loci: {},
  },
};

/** Resolves cleanly, but at the wrong locus — a wrong answer, not an outage. */
const WRONG_LOCUS_RESPONSE = {
  "NM_000001.1:c.1A>G": {
    gene_symbol: "NOTMACO1",
    hgvs_predicted_protein_consequence: { tlr: "NP_000001.1:p.(Met1Val)" },
    annotations: { chromosome: "9", ensembl_select: false },
    primary_assembly_loci: { grch38: { vcf: { alt: "G", chr: "9", pos: 1, ref: "A" } } },
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
  let fetchSpy: any;

  afterEach(() => {
    fetchSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it("reports healthy when the probe coordinate actually resolves", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(MACO1_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(true);
    expect(health.message).toContain(VARIANT_VALIDATOR_PROBE.expectedGene);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof health.timestamp).toBe("string");
  });

  it("requests JSON by both the Accept header and the content-type parameter", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(MACO1_RESPONSE));

    await checkVariantValidatorHealth();

    // Without an Accept header this endpoint answers XML, so the probe must not depend on
    // header negotiation alone.
    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("content-type=application/json");
    expect(String(url)).toContain(encodeURIComponent(VARIANT_VALIDATOR_PROBE.notation));
    expect((options as any)?.headers?.Accept).toBe("application/json");
  });

  it("reports unhealthy for the intergenic silent failure despite HTTP 200", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(INTERGENIC_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/no consequence/i);
  });

  it("reports unhealthy when the probe resolves a different gene", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse(WRONG_LOCUS_RESPONSE));

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(false);
    expect(health.message).toContain("NOTMACO1");
  });

  it("reports unhealthy on a non-retryable error status", async () => {
    // 400 is returned by fetchWithRetry rather than thrown, so this exercises the probe's own
    // status branch.
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 400));

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(false);
    expect(health.message).toContain("400");
  });

  it("reports unhealthy when the provider answers with a retryable failure", async () => {
    // 429/5xx are thrown by fetchWithRetry after its attempts are exhausted, so this lands in
    // the probe's catch rather than its status branch.
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 503));

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(false);
    expect(health.message).toBeTruthy();
  });

  it("never throws when the provider is unreachable", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("ETIMEDOUT"));

    const health = await checkVariantValidatorHealth();

    // A fallback that cannot be reached must be reportable, not fatal: the caller is already
    // rendering a degraded primary.
    expect(health.healthy).toBe(false);
    expect(health.message).toBeTruthy();
  });

  it("reports unhealthy rather than throwing on malformed JSON", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
      text: async () => "<root/>",
    } as any);

    const health = await checkVariantValidatorHealth();

    expect(health.healthy).toBe(false);
    expect(health.message).toBeTruthy();
  });
});

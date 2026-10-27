/**
 * gnomadFrequency.test.ts — what the gnomAD variant fetcher reports, on the shape gnomAD r4 actually
 * returns for UROD p.Gly318Arg (1-45015346-G-A), trimmed.
 *
 * Pins three corrections:
 *   • the grouped maximum is taken over gnomAD's grpmax groups from JOINT counts, never over sex
 *     splits, founder groups or `remaining`;
 *   • FAF95 is carried, as the BA1/BS1 input;
 *   • an outage THROWS (and becomes `error`, which withholds PM2) — only gnomAD's own
 *     "Variant not found" is an absence. It used to return null for both, which read as `not_found`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWithRetry = vi.fn();
vi.mock("../infra/http-client.ts", () => ({ fetchWithRetry: (...args: unknown[]) => fetchWithRetry(...args) }));
vi.mock("../infra/cache.ts", () => ({ gnomadFreqCache: undefined, getCachedOrFetch: (o: { fetcher: () => Promise<unknown> }) => o.fetcher() }));

import { fetchGnomadVariantFrequency, GnomadUnavailableError } from "./gnomad.ts";

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const UROD = {
  data: {
    variant: {
      variant_id: "1-45015346-G-A",
      exome: { ac: 932, an: 1461706, af: 0.000638, homozygote_count: 7, populations: [{ id: "afr", ac: 570, an: 33466 }, { id: "XX", ac: 525, an: 734532 }] },
      genome: { ac: 742, an: 152292, af: 0.004872, homozygote_count: 8, populations: [{ id: "afr", ac: 702, an: 41552 }, { id: "afr_XY", ac: 356, an: 19388 }] },
      joint: {
        ac: 1674, an: 1613998, homozygote_count: 15,
        faf95: { popmax: 0.01618107, popmax_population: "afr" },
        populations: [
          { id: "afr", ac: 1272, an: 75018 }, { id: "nfe", ac: 267, an: 1179986 }, { id: "fin", ac: 0, an: 64042 },
          { id: "remaining", ac: 60, an: 62492 }, { id: "XX", ac: 893, an: 812362 }, { id: "mid", ac: 5, an: 5978 },
        ],
      },
    },
  },
};

describe("gnomAD variant frequency", () => {
  beforeEach(() => fetchWithRetry.mockReset());

  it("takes the grouped maximum over joint grpmax groups and carries FAF95", async () => {
    fetchWithRetry.mockResolvedValueOnce(json(UROD));
    const r = (await fetchGnomadVariantFrequency("1-45015346-G-A"))!;
    expect(r.groupMaxPopulation).toBe("afr");
    expect(r.groupMaxAF).toBeCloseTo(1272 / 75018, 10);
    expect(r.groupMaxAFIsFallback).toBe(false);
    expect(r.faf95).toBeCloseTo(0.01618107, 8);
    expect(r.faf95Population).toBe("afr");
    expect(r.nHomozygous).toBe(15);
  });

  it("returns null only for gnomAD's own 'Variant not found'", async () => {
    fetchWithRetry.mockResolvedValueOnce(json({ errors: [{ message: "Variant not found" }], data: { variant: null } }));
    expect(await fetchGnomadVariantFrequency("1-45015346-G-GTTTA")).toBeNull();
  });

  it("throws on a non-OK response, a transport failure, or an empty answer that is not 'not found'", async () => {
    fetchWithRetry.mockResolvedValueOnce(json({}, 503));
    await expect(fetchGnomadVariantFrequency("1-1-A-G")).rejects.toBeInstanceOf(GnomadUnavailableError);
    fetchWithRetry.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(fetchGnomadVariantFrequency("1-1-A-G")).rejects.toBeInstanceOf(GnomadUnavailableError);
    fetchWithRetry.mockResolvedValueOnce(json({ errors: [{ message: "Rate limited" }], data: { variant: null } }));
    await expect(fetchGnomadVariantFrequency("1-1-A-G")).rejects.toBeInstanceOf(GnomadUnavailableError);
  });
});

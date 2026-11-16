import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../infra/http-client.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../infra/http-client.ts")>(), fetchWithRetry: fetchMock,
}));

import { fetchProtVarProteinAlleles } from "./protvar-protein.ts";

/** Trimmed from ProtVar's live answer to `GET /ProtVar/api/mapping?q=P22607 G380R` (2026-11-16). */
const derived = (alt: string, cadd: number, overrides: Record<string, unknown> = {}) => ({
  chromosome: "4", position: 1804392, refBase: "G", altBase: alt,
  genes: [{
    geneName: "FGFR3", caddScore: cadd,
    isoforms: [
      { accession: "P22607", canonical: true, isoformPosition: 380, refAA: "Gly", variantAA: "Arg", refCodon: "Ggg", transcripts: [{ enst: "ENST00000440486.8" }], ...overrides },
      { accession: "P22607-2", canonical: false, isoformPosition: 382, refAA: "Gly", variantAA: "Arg" },
    ],
  }],
});
const body = (variants: unknown[], last = true) => ({ content: { inputs: [{ type: "PROTEIN", messages: [], derivedGenomicVariants: variants }], last } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeEach(() => { fetchMock.mockReset(); });

describe("fetchProtVarProteinAlleles", () => {
  it("lists every GRCh38 allele that gives the change on the canonical isoform, with its CADD", async () => {
    fetchMock.mockResolvedValue(json(body([derived("C", 24.5), derived("A", 25.7)])));
    const result = await fetchProtVarProteinAlleles("P22607", 380, "G", "R");
    expect(String(fetchMock.mock.calls[0][0])).toContain(`mapping?q=${encodeURIComponent("P22607 G380R")}`);
    expect(result).toEqual({
      status: "found",
      alleles: [
        { id: "4-1804392-G-C", caddPhred: 24.5, transcript: "ENST00000440486.8" },
        { id: "4-1804392-G-A", caddPhred: 25.7, transcript: "ENST00000440486.8" },
      ],
    });
  });

  it("ignores an allele that does not give this change on the requested canonical protein", async () => {
    fetchMock.mockResolvedValue(json(body([derived("C", 24.5), derived("T", 20, { variantAA: "Trp" }), derived("A", 25.7, { isoformPosition: 381 })])));
    const result = await fetchProtVarProteinAlleles("P22607", 380, "G", "R");
    expect(result.status === "found" && result.alleles.map(a => a.id)).toEqual(["4-1804392-G-C"]);
  });

  it("reports an incomplete answer instead of a partial list", async () => {
    fetchMock.mockResolvedValue(json(body([derived("C", 24.5)], false)));
    expect(await fetchProtVarProteinAlleles("P22607", 380, "G", "R")).toMatchObject({ status: "incomplete" });
  });

  it("reports no allele as absent, and throws on a transport failure", async () => {
    fetchMock.mockResolvedValueOnce(json(body([])));
    expect(await fetchProtVarProteinAlleles("P22607", 380, "G", "R")).toMatchObject({ status: "absent" });
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(fetchProtVarProteinAlleles("P22607", 380, "G", "R")).rejects.toThrow(/503/);
  });
});

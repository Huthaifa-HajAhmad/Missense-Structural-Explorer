import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../infra/http-client.ts", async (importOriginal) => ({
  ...await importOriginal<typeof import("../infra/http-client.ts")>(), fetchWithRetry: fetchMock,
}));

import { fetchProtVarProteinAlleles } from "./protvar-protein.ts";

/** Trimmed from ProtVar's live answer to `GET /ProtVar/api/mapping?q=P22607 G380R` (2026-11-16). */
const derived = (alt: string, cadd: number, overrides: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) => ({
  chromosome: "4", position: 1804392, refBase: "G", altBase: alt, ...variant,
  genes: [{
    geneName: "FGFR3", caddScore: cadd,
    isoforms: [
      { accession: "P22607", canonical: true, isoformPosition: 380, refAA: "Gly", variantAA: "Arg", refCodon: "Ggg", variantCodon: `${alt === "A" ? "A" : "C"}gg`, codonPosition: 1, transcripts: [{ enst: "ENST00000440486.8" }], ...overrides },
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
        { id: "4-1804392-G-C", caddPhred: 24.5, transcript: "ENST00000440486.8", cdna: "ENST00000440486.8:c.1138G>C" },
        { id: "4-1804392-G-A", caddPhred: 25.7, transcript: "ENST00000440486.8", cdna: "ENST00000440486.8:c.1138G>A" },
      ],
    });
  });

  it("ignores an allele that does not give this change on the requested canonical protein", async () => {
    fetchMock.mockResolvedValue(json(body([derived("C", 24.5), derived("T", 20, { variantAA: "Trp" }), derived("A", 25.7, { isoformPosition: 381 })])));
    const result = await fetchProtVarProteinAlleles("P22607", 380, "G", "R");
    expect(result.status === "found" && result.alleles.map(a => a.id)).toEqual(["4-1804392-G-C"]);
  });

  it("writes the cDNA change from the transcript-strand codons, on a reverse-strand gene too", async () => {
    // Genomic C>T on a reverse-strand gene is G>A on the transcript: the codons carry that strand.
    fetchMock.mockResolvedValue(json(body([derived("T", 20, { refCodon: "gGg", variantCodon: "gAg", codonPosition: 2, isoformPosition: 12 }, { refBase: "C" })])));
    const result = await fetchProtVarProteinAlleles("P22607", 12, "G", "R");
    expect(result).toMatchObject({ status: "found", alleles: [{ id: "4-1804392-C-T", cdna: "ENST00000440486.8:c.35G>A" }] });
  });

  it("gives no cDNA rather than a guess when the codon data is missing or inconsistent", async () => {
    fetchMock.mockResolvedValue(json(body([derived("C", 24.5, { refCodon: undefined, codonPosition: undefined })])));
    const result = await fetchProtVarProteinAlleles("P22607", 380, "G", "R");
    expect(result.status === "found" && result.alleles[0].cdna).toBeNull();
  });

  it("accepts a chr-prefixed contig and lower-case bases", async () => {
    fetchMock.mockResolvedValue(json(body([derived("c", 24.5, {}, { chromosome: "chr4", refBase: "g" })])));
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

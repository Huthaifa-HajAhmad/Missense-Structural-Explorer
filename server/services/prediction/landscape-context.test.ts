import { describe, expect, it, vi } from "vitest";

vi.mock("../external-api/gnomad.ts", () => ({
  fetchGnomadGeneConstraint: vi.fn(async () => ({ hasRegionalData: true }))
}));
vi.mock("./splice_resolver.ts", () => ({ fetchTranscriptExons: vi.fn() }));

import { fetchGnomadGeneConstraint } from "../external-api/gnomad.ts";
import { fetchTranscriptExons } from "./splice_resolver.ts";
import { classifyClinvar, fetchLandscapeContext, missenseResidue, parseClinvar, parseGnomad } from "./landscape-context.ts";

describe("landscape context parsing", () => {
  it("reads only missense HGVS", () => {
    expect(missenseResidue("p.Asp116Gly")).toBe(116);
    expect(missenseResidue("p.Asp116=")).toBeNull();
    expect(missenseResidue("p.Asp116Asp")).toBeNull();
    expect(missenseResidue("p.Arg12Ter")).toBeNull();
    expect(missenseResidue("p.Gly5fs")).toBeNull();
  });

  it("classifies ClinVar significance without promoting conflicts", () => {
    expect(classifyClinvar("Pathogenic/Likely pathogenic")).toBe("plp");
    expect(classifyClinvar("Likely benign")).toBe("blb");
    expect(classifyClinvar("Conflicting classifications of pathogenicity")).toBe("other");
    expect(classifyClinvar("Uncertain significance")).toBe("other");
  });

  it("keeps canonical-transcript missense rows and counts gnomAD variants per residue", () => {
    const cv = parseClinvar(
      [
        { hgvsp: "p.Arg131Trp", clinical_significance: "Pathogenic", gold_stars: 2, transcript_id: "ENST1.4" },
        { hgvsp: "p.Arg98Trp", clinical_significance: "Pathogenic", transcript_id: "ENST2" },
        { hgvsp: "p.Arg131=", clinical_significance: "Benign", transcript_id: "ENST1" }
      ],
      "ENST1"
    );
    expect(cv).toEqual([{ pos: 131, cls: "plp", significance: "Pathogenic", stars: 2, hgvsp: "p.Arg131Trp" }]);

    const gn = parseGnomad(
      [
        { consequence: "missense_variant", hgvsp: "p.Asp116Asn", transcript_id: "ENST1", exome: { ac: 3 }, genome: { ac: 1 } },
        { consequence: "missense_variant", hgvsp: "p.Asp116Glu", transcript_id: "ENST1", exome: { ac: 10 }, genome: null },
        { consequence: "synonymous_variant", hgvsp: "p.Asp116=", transcript_id: "ENST1", exome: { ac: 50 } },
        { consequence: "missense_variant", hgvsp: "p.Ser101Pro", transcript_id: "ENST1", exome: { ac: 0 }, genome: { ac: 0 } }
      ],
      "ENST1"
    );
    expect(gn).toEqual([{ pos: 116, variants: 2, maxAc: 10 }]);
  });

  it("withholds the regional map, naming the missing CDS model, when the transcript has intervals", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce(null);
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const ctx = await fetchLandscapeContext("WITHHELDGENE");
    expect(ctx.regions).toBeNull();
    expect(ctx.regionsStatus).toBe("withheld-mapping");
    expect(ctx.errors.join(" ")).toMatch(/Regional map withheld.*CDS model/i);
    spy.mockRestore();
  });

  it("projects the released intervals onto protein residues when the CDS model verifies", async () => {
    // ARF5 (ENST00000000233) has three released genomic intervals; the model covers them all.
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce({
      strand: 1, seqRegionName: "7", cdsStart: 127588499, cdsEnd: 127591296, proteinLength: 933,
      exons: [{ start: 127588499, end: 127591296 }]
    } as any);
    const gene = { canonical_transcript_id: "ENST00000000233", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const ctx = await fetchLandscapeContext("MAPPEDGENE");
    expect(ctx.regionsStatus).toBe("available");
    expect(ctx.regions?.length).toBe(3);
    expect(ctx.regions?.[0]).toMatchObject({ start: 1, end: 21 });
    expect(ctx.regions?.at(-1)).toMatchObject({ start: 340, end: 933 });
    expect(ctx.regionsBasis).toMatch(/protein residues/i);
    spy.mockRestore();
  });

  it("refuses to project intervals numbered on a different transcript than the axis", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233" } } as any);
    const gene = { canonical_transcript_id: "ENST99999999999", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const ctx = await fetchLandscapeContext("MISMATCHGENE");
    expect(ctx.regionsStatus).toBe("withheld-mapping");
    expect(ctx.regions).toBeNull();
    expect(ctx.errors.join(" ")).toMatch(/does not match the landscape transcript/i);
    spy.mockRestore();
  });

  it("reports a transcript with no regional interval as no call, not as withheld", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: false } as any);
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const ctx = await fetchLandscapeContext("NOREGIONGENE");
    expect(ctx.regions).toEqual([]);
    expect(ctx.regionsStatus).toBe("none");
    expect(ctx.errors.join(" ")).not.toMatch(/withheld/i);
    spy.mockRestore();
  });

  it("caches a complete answer and does not re-fetch it on the next call", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: false } as any);
    const gene = { canonical_transcript_id: "ENST1", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { gene } })
    } as any);
    const first = await fetchLandscapeContext("CACHEGENE");
    const calls = spy.mock.calls.length;
    const second = await fetchLandscapeContext("CACHEGENE");
    expect(second).toBe(first);
    expect(spy.mock.calls.length).toBe(calls);
    expect(first.regionsStatus).toBe("none");
    spy.mockRestore();
  });

  it("treats a gene absent from constraint as no call, not an outage, and caches it", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce(null);
    const gene = { canonical_transcript_id: "ENST1", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const first = await fetchLandscapeContext("ABSENTGENE");
    expect(first.regionsStatus).toBe("none");
    expect(first.regions).toEqual([]);
    const calls = spy.mock.calls.length;
    const second = await fetchLandscapeContext("ABSENTGENE");
    expect(second).toBe(first);
    expect(spy.mock.calls.length).toBe(calls);
    spy.mockRestore();
  });

  it("reports a failed source as not loaded, not as empty", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockRejectedValueOnce(new Error("constraint down"));
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const ctx = await fetchLandscapeContext("FAILEDGENE");
    expect(ctx.clinvar).toBeNull();
    expect(ctx.gnomad).toBeNull();
    expect(ctx.regions).toBeNull();
    expect(ctx.regionsStatus).toBe("unavailable");
    expect(ctx.regionsBasis).toContain("v4.1.1");
    expect(ctx.errors.length).toBe(3);
    spy.mockRestore();
  });
});

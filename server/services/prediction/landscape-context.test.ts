import { describe, expect, it, vi } from "vitest";

vi.mock("../external-api/gnomad.ts", () => ({
  fetchGnomadGeneConstraint: vi.fn(async () => ({ hasRegionalData: true }))
}));
vi.mock("./splice_resolver.ts", () => ({ fetchTranscriptExons: vi.fn() }));

import { fetchGnomadGeneConstraint } from "../external-api/gnomad.ts";
import { fetchTranscriptExons } from "./splice_resolver.ts";
import { fetchRegionalConstraint } from "./regional-constraint.ts";
import { classifyClinvar, fetchGeneMissenseRows, fetchLandscapeContext, missenseResidue, parseClinvar, parseGnomad } from "./landscape-context.ts";

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
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233", transcriptVersion: "10" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce(null);
    const spy = vi.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
    const ctx = await fetchLandscapeContext("WITHHELDGENE", "ENST00000000233");
    expect(ctx.regions).toBeNull();
    expect(ctx.regionsStatus).toBe("withheld-mapping");
    expect(ctx.errors.join(" ")).toMatch(/Regional map withheld.*CDS model/i);
    spy.mockRestore();
  });

  it("projects the released intervals onto protein residues when the CDS model verifies", async () => {
    // ARF5 (ENST00000000233): three released genomic intervals over the real 6-exon, 180-aa model.
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233", transcriptVersion: "10" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce({
      strand: 1, seqRegionName: "7", cdsStart: 127588499, cdsEnd: 127591299, proteinLength: 180, transcriptVersion: "10",
      exons: [
        { start: 127588411, end: 127588565 }, { start: 127589083, end: 127589163 }, { start: 127589485, end: 127589594 },
        { start: 127590066, end: 127590137 }, { start: 127590963, end: 127591088 }, { start: 127591213, end: 127591700 }
      ]
    } as any);
    const gene = { canonical_transcript_id: "ENST00000000233", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const ctx = await fetchLandscapeContext("MAPPEDGENE", "ENST00000000233");
    expect(ctx.regionsStatus).toBe("available");
    expect(ctx.regions).toEqual([
      { start: 1, end: 21, oe: 0.81832, pValue: 0.31528 },
      { start: 21, end: 60, oe: 0.16758, pValue: 8.8515e-9 },
      { start: 60, end: 180, oe: 0.63385, pValue: 0.0000034042 }
    ]);
    expect(ctx.regionsBasis).toMatch(/protein residues/i);
    spy.mockRestore();
  });

  it("refuses to project intervals numbered on a different transcript than the axis", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233" } } as any);
    const gene = { canonical_transcript_id: "ENST00000000233", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const ctx = await fetchLandscapeContext("MISMATCHGENE", "ENST99999999999");
    expect(ctx.regionsStatus).toBe("withheld-mapping");
    expect(ctx.regions).toBeNull();
    expect(ctx.errors.join(" ")).toMatch(/does not match the landscape axis transcript/i);
    spy.mockRestore();
  });

  it("refuses to project through a transcript version that differs from the pinned release", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233", transcriptVersion: "10" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce({
      strand: 1, seqRegionName: "7", cdsStart: 127588499, cdsEnd: 127591299, proteinLength: 180, transcriptVersion: "11",
      exons: [{ start: 127588499, end: 127591299 }]
    } as any);
    const gene = { canonical_transcript_id: "ENST00000000233", clinvar_variants: [], variants: [] };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: { gene } }) } as any);
    const ctx = await fetchLandscapeContext("VERSIONGENE", "ENST00000000233");
    expect(ctx.regionsStatus).toBe("withheld-mapping");
    expect(ctx.errors.join(" ")).toMatch(/transcript version 11 differs from the pinned 10/i);
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

/**
 * ABCG1 is the case that broke: gnomAD's gene-level rows are on ENST00000398449 (666 residues), while the run
 * models ENST00000361802 (678 residues, UniProt P45844). From residue 375 the two number the same amino acid
 * 12 apart, so rows must be read on the run's own transcript.
 */
describe("fetchGeneMissenseRows — which transcript the rows are numbered on", () => {
  const reply = (data: unknown) => ({ ok: true, json: async () => ({ data }) }) as any;
  const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as { body: string }).body));
  const TX_ROWS = { transcript_id: "ENST00000361802", clinvar_variants: [{ hgvsp: "p.Gly358Arg" }], variants: [] };

  it("reads on the requested transcript, without its version, and names that transcript", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) =>
      reply(String((init as { body: string }).body).includes("transcript(") ? { transcript: TX_ROWS } : { gene: { canonical_transcript_id: "ENST00000398449" } }));
    const [clinvar, gnomad] = await fetchGeneMissenseRows("TXGENE", "ENST00000361802.9");
    expect(clinvar).toMatchObject({ status: "fulfilled", value: { transcript_id: "ENST00000361802", clinvar_variants: TX_ROWS.clinvar_variants } });
    expect(gnomad).toMatchObject({ status: "fulfilled", value: { transcript_id: "ENST00000361802" } });
    expect(spy.mock.calls.map((c) => bodyOf(c).variables)).toEqual([{ transcript: "ENST00000361802" }, { transcript: "ENST00000361802" }]);
    spy.mockRestore();
  });

  /** gnomAD's real answer for a transcript it does not hold: HTTP 200 with an error and a null transcript. */
  const NOT_FOUND = { errors: [{ message: "Transcript not found" }], data: { transcript: null } };
  const GENE_ROWS = { data: { gene: { canonical_transcript_id: "ENST00000398449", clinvar_variants: [], variants: [] } } };
  const answerFor = (onTranscript: unknown) => async (_url: unknown, init: unknown) =>
    ({ ok: true, json: async () => (String((init as { body: string }).body).includes("transcript(") ? onTranscript : GENE_ROWS) }) as any;

  it("falls back to the gene's canonical rows, named as such, when gnomAD does not know the transcript", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(answerFor(NOT_FOUND));
    const [clinvar, gnomad] = await fetchGeneMissenseRows("UNKNOWNTXGENE", "ENST00000000001");
    expect(clinvar).toMatchObject({ status: "fulfilled", value: { transcript_id: "ENST00000398449" } });
    expect(gnomad).toMatchObject({ status: "fulfilled", value: { transcript_id: "ENST00000398449" } });
    spy.mockRestore();
  });

  it("reports any other transcript-query error as a failed read, never as the gene's rows", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(answerFor({ errors: [{ message: "Query rate limit exceeded" }], data: { transcript: null } }));
    const [clinvar] = await fetchGeneMissenseRows("ERRORTXGENE", "ENST00000000002");
    expect(clinvar).toMatchObject({ status: "rejected" });
    expect(spy.mock.calls.length).toBe(2);
    spy.mockRestore();
  });

  it("reads the gene's rows for a RefSeq id, which gnomAD cannot look up, and names their transcript", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(answerFor(NOT_FOUND));
    const [clinvar] = await fetchGeneMissenseRows("REFSEQGENE", "NM_016818.3");
    expect(clinvar).toMatchObject({ value: { transcript_id: "ENST00000398449" } });
    expect(spy.mock.calls.map((c) => bodyOf(c).variables)).toEqual([{ gene: "REFSEQGENE" }, { gene: "REFSEQGENE" }]);
    spy.mockRestore();
  });

  it("keeps one cache entry per transcript, so two runs of one gene never share rows", async () => {
    const spy = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) =>
      reply(String((init as { body: string }).body).includes("transcript(") ? { transcript: TX_ROWS } : { gene: { canonical_transcript_id: "ENST00000398449", clinvar_variants: [], variants: [] } }));
    const [onTx] = await fetchGeneMissenseRows("TWOTXGENE", "ENST00000361802");
    const [onGene] = await fetchGeneMissenseRows("TWOTXGENE", null);
    expect(onTx).toMatchObject({ value: { transcript_id: "ENST00000361802" } });
    expect(onGene).toMatchObject({ value: { transcript_id: "ENST00000398449" } });
    spy.mockRestore();
  });

  it("numbers the Landscape lanes on the axis transcript", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: false } as any);
    const spy = vi.spyOn(global, "fetch").mockImplementation(async () => reply({ transcript: { ...TX_ROWS, clinvar_variants: [{ hgvsp: "p.Gly358Arg", clinical_significance: "Benign", transcript_id: "ENST00000361802" }] } }));
    const ctx = await fetchLandscapeContext("AXISGENE", "ENST00000361802");
    expect(ctx.transcript).toBe("ENST00000361802");
    expect(ctx.clinvar?.map((c) => c.pos)).toEqual([358]);
    spy.mockRestore();
  });
});

describe("fetchRegionalConstraint — regional intervals on one protein axis", () => {
  it("reads no variant rows, and takes a padded, versioned axis transcript as the same transcript", async () => {
    vi.mocked(fetchGnomadGeneConstraint).mockResolvedValueOnce({ hasRegionalData: true, provenance: { transcriptId: "ENST00000000233", transcriptVersion: "10" } } as any);
    vi.mocked(fetchTranscriptExons).mockResolvedValueOnce(null);
    const spy = vi.spyOn(global, "fetch");
    const regional = await fetchRegionalConstraint("PADDEDGENE", "  ENST00000000233.10 ");
    expect(regional).toMatchObject({ status: "withheld-mapping", sourceFailed: true });
    expect(regional.reason).toMatch(/no verified CDS model for ENST00000000233/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

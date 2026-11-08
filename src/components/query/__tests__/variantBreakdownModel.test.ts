import { describe, it, expect } from "vitest";
import { buildVariantBreakdown, type BreakdownCell } from "../variantBreakdownModel";
import type { AnalysisResult } from "../../../types";

const typed = { gene: "PAH", change: "p.Arg408Trp", uniprot: "" };

const resolved = {
  metadata: {
    gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", residueIndex: 408,
    wildType: "R", mutant: "W", sequence: "M".repeat(452),
  },
  transcriptId: "ENST00000553106",
  maneRefSeqId: "NM_000277.3",
  isManeSelect: true,
  numberingBasis: "canonical",
  numberingVerified: true,
  assembly: "GRCh38",
  resolvedAssembly: "GRCh38",
  predictorData: { gnomadVariantId: "12-102840401-C-T", gnomadVariantAssembly: "GRCh38" },
} as unknown as AnalysisResult;

const cell = (cells: BreakdownCell[], id: BreakdownCell["id"]) => cells.find(c => c.id === id)!;

describe("variant breakdown, before anything has resolved", () => {
  it("reads the residue from the typed protein change and marks the rest as still resolving", () => {
    const { cells } = buildVariantBreakdown({ typed, result: null, settled: false });
    expect(cells.map(c => c.id)).toEqual(["gene", "change", "residue", "uniprot", "transcript", "build", "coordinate", "numbering"]);
    expect(cell(cells, "gene")).toMatchObject({ value: "PAH", state: "known" });
    expect(cell(cells, "change")).toMatchObject({ value: "p.Arg408Trp", state: "known" });
    expect(cell(cells, "residue")).toMatchObject({ value: "408", sub: "Arg → Trp", state: "known" });
    for (const id of ["uniprot", "transcript", "build", "coordinate", "numbering"] as const) {
      expect(cell(cells, id)).toMatchObject({ value: null, state: "pending" });
    }
  });

  it("does not guess a residue from a coordinate", () => {
    const { cells } = buildVariantBreakdown({
      typed: { gene: "", change: "Chr12(GRCh38):g.102840401C>T", uniprot: "" }, result: null, settled: false,
    });
    expect(cell(cells, "residue")).toMatchObject({ value: null, state: "pending" });
    expect(cell(cells, "change")).toMatchObject({ value: "Chr12(GRCh38):g.102840401C>T", state: "known" });
    expect(cell(cells, "gene")).toMatchObject({ value: null, state: "pending" });
  });
});

describe("variant breakdown, once the run has resolved", () => {
  const { cells, notes } = buildVariantBreakdown({ typed, result: resolved, settled: true });

  it("names the protein, its residue position and length, and its accession", () => {
    expect(cell(cells, "change")).toMatchObject({ value: "p.Arg408Trp", sub: "R408W" });
    expect(cell(cells, "residue")).toMatchObject({ value: "408 of 452", sub: "Arg → Trp" });
    expect(cell(cells, "uniprot")).toMatchObject({ value: "P00439", sub: null });
  });

  it("leads with the RefSeq transcript and its tier, and keeps the Ensembl id beside it", () => {
    expect(cell(cells, "transcript")).toMatchObject({
      value: "NM_000277.3", sub: "Ensembl ENST00000553106", tag: { label: "MANE Select", tone: "good" },
    });
  });

  it("states the build, the genomic coordinate and the numbering basis", () => {
    expect(cell(cells, "build")).toMatchObject({ value: "GRCh38 / hg38", sub: null });
    expect(cell(cells, "coordinate")).toMatchObject({ value: "12-102840401-C-T" });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Canonical", tag: { label: "verified", tone: "good" } });
    expect(notes).toEqual([]);
  });
});

describe("variant breakdown, progress", () => {
  it("counts the cells that hold a value, and those a finished run left empty", () => {
    expect(buildVariantBreakdown({ typed, result: null, settled: false }).progress).toEqual({ known: 3, absent: 0, total: 8 });
    expect(buildVariantBreakdown({ typed, result: resolved, settled: true }).progress).toEqual({ known: 8, absent: 0, total: 8 });
    const sparse = { metadata: { ...resolved.metadata, sequence: undefined } } as unknown as AnalysisResult;
    expect(buildVariantBreakdown({ typed, result: sparse, settled: true }).progress).toEqual({ known: 4, absent: 4, total: 8 });
  });
});

describe("variant breakdown, provenance", () => {
  it("says which notation a coordinate was read from", () => {
    const { cells } = buildVariantBreakdown({
      typed: { gene: "", change: "Chr12(GRCh38):g.102840401C>T", uniprot: "" }, result: resolved, settled: true,
    });
    expect(cell(cells, "change").sub).toBe("R408W · read from Chr12(GRCh38):g.102840401C>T");
  });

  it("shows a lifted coordinate's submitted build and explains the lift", () => {
    const lifted = {
      ...resolved, assembly: "GRCh37", resolvedAssembly: "GRCh38", liftedGenomicCoordinates: "12-102840401-C-T",
      coordinateLift: { status: "lifted", fromAssembly: "GRCh37", toAssembly: "GRCh38", toCoordinates: "12-102840401-C-T" },
    } as unknown as AnalysisResult;
    const { cells, notes } = buildVariantBreakdown({ typed, result: lifted, settled: true });
    expect(cell(cells, "build")).toMatchObject({ value: "GRCh38 / hg38", sub: "submitted as GRCh37 / hg19" });
    expect(notes.map(n => n.id)).toEqual(["build"]);
    expect(notes[0]).toMatchObject({ tone: "info" });
  });

  it("warns when a coordinate could not be lifted", () => {
    const unlifted = {
      ...resolved, assembly: "GRCh37", resolvedAssembly: "GRCh37",
      coordinateLift: { status: "unavailable", fromAssembly: "GRCh37", toAssembly: "GRCh37", reason: "assembly map did not answer", reasonCode: "map-unavailable" },
    } as unknown as AnalysisResult;
    const { notes } = buildVariantBreakdown({ typed, result: unlifted, settled: true });
    expect(notes.find(n => n.id === "build")).toMatchObject({ tone: "warn" });
  });

  it("shows a renumbered notation with both numberings", () => {
    const remapped = {
      ...resolved, numberingBasis: "remapped",
      metadata: { ...resolved.metadata, variant: "p.Lys272Asn", residueIndex: 272 },
      numberingRemap: { reason: "MANE to canonical", from: { hgvsp: "NP_001032248.1:p.Lys281Asn" }, to: { hgvsp: "p.Lys272Asn" } },
    } as unknown as AnalysisResult;
    const { cells } = buildVariantBreakdown({ typed: { gene: "ACOT9", change: "p.Lys281Asn", uniprot: "" }, result: remapped, settled: true });
    expect(cell(cells, "change").value).toBe("p.Lys281Asn");
    expect(cell(cells, "residue").value).toBe("272 of 452");
    expect(cell(cells, "numbering")).toMatchObject({ value: "Renumbered", sub: "reported p.Lys281Asn, modelled p.Lys272Asn" });
  });

  it("flags unverified numbering with the server's reason", () => {
    const unverified = { ...resolved, numberingBasis: "unverified", numberingVerified: false, numberingUnverifiedReason: "provider stated no protein accession" } as unknown as AnalysisResult;
    const { cells } = buildVariantBreakdown({ typed, result: unverified, settled: true });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Unverified", sub: "provider stated no protein accession", tag: { label: "check", tone: "warn" } });
  });

  it("does not say an unverified numbering's reason twice when the transcript warning already does", () => {
    const warned = {
      ...resolved, numberingBasis: "unverified", numberingUnverifiedReason: "provider stated no protein accession",
      transcriptWarning: "Numbering could not be verified: the provider stated no protein accession.",
    } as unknown as AnalysisResult;
    const { cells, notes } = buildVariantBreakdown({ typed, result: warned, settled: true });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Unverified", sub: null });
    expect(notes.map(n => n.id)).toEqual(["transcript"]);
  });

  it("carries a retired gene symbol, how an rsID was read and a transcript warning", () => {
    const rich = {
      ...resolved,
      geneSymbolUpdated: { from: "CPSF3L", to: "INTS11" },
      inputResolution: { method: "dbsnp-rsid", submitted: "rs5030858", resolvedNotation: "12-102840401-C-T", note: "rs5030858 was read as 12-102840401-C-T" },
      transcriptWarning: "Stated transcript version is not current.",
    } as unknown as AnalysisResult;
    const { cells, notes } = buildVariantBreakdown({ typed, result: rich, settled: true });
    expect(cell(cells, "gene").sub).toBe("was CPSF3L");
    expect(notes.map(n => [n.id, n.tone])).toEqual([["input", "info"], ["transcript", "warn"]]);
  });
});

describe("variant breakdown, numbering checked against the protein sequence", () => {
  const withSequence = (sequence: string, extra: object = {}) => ({
    ...resolved, numberingBasis: undefined, ...extra, metadata: { ...resolved.metadata, sequence },
  }) as unknown as AnalysisResult;
  const sequenceWith = (residue: string) => `${"A".repeat(407)}${residue}${"A".repeat(44)}`;

  it("confirms the substituted residue sits at that position", () => {
    const { cells } = buildVariantBreakdown({ typed, result: withSequence(sequenceWith("R")), settled: true });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Canonical", sub: "Arg at 408 in P00439", tag: { label: "checked", tone: "good" } });
  });

  it("flags a position that holds a different residue", () => {
    const { cells } = buildVariantBreakdown({ typed, result: withSequence(sequenceWith("K")), settled: true });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Mismatch", sub: "P00439 has K at 408, not R", tag: { label: "check", tone: "warn" } });
  });

  it("prefers the server's own numbering basis when it states one", () => {
    const { cells } = buildVariantBreakdown({ typed, result: withSequence(sequenceWith("K"), { numberingBasis: "canonical" }), settled: true });
    expect(cell(cells, "numbering")).toMatchObject({ value: "Canonical", tag: { label: "verified" } });
  });
});

describe("variant breakdown, a settled run that did not report a field", () => {
  it("shows it as absent, not as still resolving", () => {
    const sparse = { metadata: { ...resolved.metadata, sequence: undefined } } as unknown as AnalysisResult;
    const { cells } = buildVariantBreakdown({ typed, result: sparse, settled: true });
    for (const id of ["transcript", "build", "coordinate", "numbering"] as const) {
      expect(cell(cells, id)).toMatchObject({ value: null, state: "absent" });
    }
  });
});

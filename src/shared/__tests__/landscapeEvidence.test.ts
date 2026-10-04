import { describe, expect, it } from "vitest";
import {
  agreementClass,
  bandKey,
  bandLabel,
  complementBase,
  conservationLevel,
  displayBase,
  landscapeFinding,
  landscapeKey,
  clinvarIsQuery,
  snvReachableAminoAcids,
  translateCodon,
  legendSteps,
  provenanceLine
} from "../landscapeEvidence";
import type { LandscapeMeta, LandscapeResidueItem } from "../contracts";

const row = (residx: number, amMean: number | null, extra: Partial<LandscapeResidueItem> = {}): LandscapeResidueItem => ({
  residx,
  amMean,
  amMax: amMean,
  amMin: amMean,
  amCount: amMean === null ? 0 : 1,
  revelMean: null,
  gerp: null,
  phylop: null,
  ...extra
});

const meta = (over: Partial<LandscapeMeta> = {}): LandscapeMeta => ({
  source: "myvariant",
  sourceVersion: "dbNSFP 4.4a",
  transcript: "ENST00000290810",
  transcriptBasis: "mane",
  window: { start: 91, end: 141 },
  referenceSequence: "Q13564",
  qualityFlags: [],
  cached: false,
  retrievedAt: "2026-09-29T00:00:00Z",
  ...over
});

describe("calibrated bands", () => {
  it("colours REVEL on the Pejaver 2022 edges, not the old 0.5 / 0.75 breaks", () => {
    expect(bandKey("revel", 0.7)).toBe("pp3-supporting"); // was 'Supporting 0.50–0.75', same colour as 0.51
    expect(bandKey("revel", 0.51)).toBe("indeterminate");
    expect(bandKey("revel", 0.8)).toBe("pp3-moderate"); // was 'Pathogenic'
    expect(bandKey("revel", 0.95)).toBe("pp3-strong");
    expect(bandKey("revel", 0.2)).toBe("bp4-supporting"); // was 'VUS'
    expect(bandKey("revel", 0.001)).toBe("bp4-strong"); // VeryStrong folds into the strongest swatch
    expect(bandKey("revel", null)).toBeNull();
  });

  it("colours AlphaMissense on the Bergquist 2025 edges, not the authors' 0.564 class", () => {
    expect(bandKey("alphaMissense", 0.6)).toBe("indeterminate");
    expect(bandKey("alphaMissense", 0.8)).toBe("pp3-supporting");
    expect(bandLabel("alphaMissense", 0.362)).toBe("Indeterminate");
  });

  it("builds legend ranges from calibration.ts and never uses the word VUS", () => {
    const revel = legendSteps("revel");
    expect(revel.find((s) => s.key === "pp3-supporting")?.range).toBe("0.644–0.773");
    expect(revel.find((s) => s.key === "indeterminate")?.range).toBe("0.29–0.644");
    expect(revel.find((s) => s.key === "bp4-strong")?.range).toBe("≤ 0.016");
    expect(JSON.stringify(revel)).not.toMatch(/VUS/);
    expect(legendSteps("alphaMissense").find((s) => s.key === "pp3-strong")?.range).toBe("≥ 0.99");
  });
});

describe("agreement", () => {
  it("reads agreement on the bands, not on raw equality", () => {
    expect(agreementClass(0.7, 0.8)).toBe("both-pp3");
    // Equal raw values, opposite bands for neither: 0.7 is REVEL PP3 but AM indeterminate.
    expect(agreementClass(0.7, 0.7)).toBe("other");
    expect(agreementClass(0.1, 0.9)).toBe("discordant");
    expect(agreementClass(0.1, 0.05)).toBe("both-bp4");
    expect(agreementClass(null, 0.5)).toBeNull();
  });
});

describe("conservation", () => {
  it("steps phyloP so the darkest shade starts at the ClinGen PP3 edge", () => {
    expect(conservationLevel("phylop", 7.366)).toBe(2);
    expect(conservationLevel("phylop", 7.367)).toBe(3);
    expect(conservationLevel("gerp", 1)).toBe(0);
    expect(conservationLevel("gerp", undefined)).toBeNull();
  });
});

describe("strand", () => {
  it("complements bases on the − strand so codons read as in the mRNA", () => {
    // NAE1 D116G: genomic T>C on the − strand is coding A>G.
    expect(displayBase("T", "-")).toBe("A");
    expect(displayBase("C", "-")).toBe("G");
    expect(displayBase("t", "+")).toBe("T");
    expect(complementBase("N")).toBe("N");
  });
});

describe("landscapeFinding", () => {
  const rows = [row(115, 0.9), row(116, 0.3, { amMin: 0.1, amMax: 0.6, amCount: 7 }), row(117, 0.05), row(118, null)];

  it("states the window and the variant from data, and names no criterion as met", () => {
    const f = landscapeFinding({
      rows,
      window: { start: 115, end: 118 },
      target: { pos: 116, wt: "D", mut: "G" },
      variantRevel: 0.231,
      variantAm: 0.362,
      mode: "mean",
      meta: meta()
    });
    expect(f.empty).toBe(false);
    expect(f.window).toMatch(/Of 3 scored residues in 115–118 \(4 aa\), 1 has a mean AlphaMissense score in the PP3 range and 1 in the BP4 range/);
    expect(f.variant).toBe(
      "D116G: REVEL 0.231 (BP4) · AlphaMissense 0.362 (Indeterminate); among the 7 scored substitutions at residue 116 (AlphaMissense 0.100–0.600) it is within the range."
    );
    expect(`${f.window} ${f.variant}`).not.toMatch(/PM1|met\b/);
    expect(f.cautions).toEqual([]);
  });

  it("surfaces data-quality flags and an unconfirmed transcript as cautions", () => {
    const f = landscapeFinding({
      rows,
      window: { start: 115, end: 118 },
      target: null,
      variantRevel: null,
      variantAm: null,
      mode: "max",
      meta: meta({ transcriptBasis: "most-covered", qualityFlags: ["ref-mismatch:2", "overcount:116"] })
    });
    expect(f.variant).toBeNull();
    expect(f.cautions).toHaveLength(3);
    expect(f.cautions.join(" ")).toMatch(/2 residue\(s\).*different reference/);
    expect(f.cautions.join(" ")).toMatch(/Residue 116 reports more substitutions than one codon admits/);
  });

  it("flags rows cached before provenance existed", () => {
    const f = landscapeFinding({ rows, window: { start: 115, end: 118 }, target: null, variantRevel: null, variantAm: null, mode: "mean", meta: null });
    expect(f.cautions[0]).toMatch(/cached before per-transcript counting/);
  });

  it("says so when the window has no scores", () => {
    const f = landscapeFinding({ rows: [], window: { start: 1, end: 10 }, target: null, variantRevel: null, variantAm: null, mode: "mean", meta: null });
    expect(f.empty).toBe(true);
    expect(f.window).toMatch(/No AlphaMissense residue summaries/);
  });
});

describe("landscapeFinding on the queried residue's own ClinVar record", () => {
  // SOD1 p.Ala5Val: ClinVar lists Ala5Ser, Ala5Thr and Ala5Val itself, all pathogenic.
  const clinvar = [
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 2, hgvsp: "p.Ala5Ser" },
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 2, hgvsp: "p.Ala5Thr" },
    { pos: 5, cls: "plp" as const, significance: "Pathogenic", stars: 3, hgvsp: "p.Ala5Val" }
  ];
  const ctx = { clinvar, gnomad: [], regions: [], transcript: null, regionsBasis: "gnomAD v2", errors: [] };
  const base = {
    rows: [row(5, 0.5, { amCount: 6 })],
    window: { start: 1, end: 31 },
    target: { pos: 5, wt: "A", mut: "V" },
    variantRevel: 0.853,
    variantAm: 0.84,
    mode: "mean" as const,
    meta: meta(),
    context: ctx
  };

  it("does not count the queried variant as one of the pathogenic variants at its own residue", () => {
    const f = landscapeFinding(base);
    expect(f.context).toContain("the queried variant is itself in ClinVar (Pathogenic)");
    expect(f.context).toContain("2 other ClinVar P/LP missense variants at this residue");
    expect(f.context).not.toContain("3 ClinVar P/LP");
  });

  it("recognises the query by residue and alternative, in either letter code", () => {
    expect(clinvarIsQuery(clinvar[2], { pos: 5, mut: "V" })).toBe(true);
    expect(clinvarIsQuery(clinvar[0], { pos: 5, mut: "V" })).toBe(false);
    expect(clinvarIsQuery(clinvar[2], { pos: 6, mut: "V" })).toBe(false);
    expect(clinvarIsQuery(clinvar[2], null)).toBe(false);
  });
});

describe("landscapeFinding on a residue dbNSFP does not score", () => {
  it("names the gap instead of silently skipping it", () => {
    const rows = [row(5, 0.5), row(6, null), row(7, 0.2)];
    const f = landscapeFinding({ rows, window: { start: 5, end: 7 }, target: null, variantRevel: null, variantAm: null, mode: "mean", meta: meta() });
    expect(f.window).toMatch(/Of 2 scored residues/);
    expect(f.window).toContain("No dbNSFP missense record for residue 6.");
  });
});

describe("provenanceLine", () => {
  it("names version, source and transcript basis", () => {
    expect(provenanceLine(meta())).toBe("dbNSFP 4.4a via myvariant.info · ENST00000290810 (MANE Select)");
    expect(provenanceLine(meta({ sourceVersion: null, cached: true }))).toMatch(/dbNSFP version not reported.*cached$/);
    expect(provenanceLine(null)).toBe("Source not reported");
  });
});

describe("genetic code and keys", () => {
  it("translates codons and lists SNV-reachable amino acids", () => {
    expect(translateCodon("GAT")).toBe("D");
    expect(translateCodon("TAA")).toBe("*");
    expect(translateCodon("GAN")).toBeNull();
    // GAT (Asp): one change reaches A, G, V, N, Y, H, E — not W, not the stop, not D itself.
    expect([...snvReachableAminoAcids("GAT")].sort()).toEqual(["A", "E", "G", "H", "N", "V", "Y"]);
  });

  it("keys landscape state by accession too", () => {
    expect(landscapeKey("nae1", "p.Asp116Gly", "q13564")).toBe("NAE1|p.Asp116Gly|Q13564");
    expect(landscapeKey("NAE1", "p.Asp116Gly", "Q13564")).not.toBe(landscapeKey("NAE1", "p.Asp116Gly", "P12345"));
  });
});

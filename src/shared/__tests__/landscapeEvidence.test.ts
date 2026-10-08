import { describe, expect, it } from "vitest";
import {
  agreementClass,
  bandKey,
  bandLabel,
  bandSpans,
  bandTone,
  complementBase,
  conservationLevel,
  displayBase,
  landscapeFinding,
  landscapeKey,
  landscapeVerdict,
  clinvarIsQuery,
  readsAsSentence,
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
    expect(f.window).toMatch(/Of 3 scored residues in 115–118 \(4 aa\), 1 has a mean AlphaMissense score in the PP3 range, 1 in the BP4 range and 1 remains indeterminate/);
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
  const ctx = { clinvar, gnomad: [], regions: [], regionsStatus: "none" as const, transcript: null, regionsBasis: "gnomAD v4.1.1 genomic intervals", errors: [] };
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

  it("names a withheld regional map as withheld, not as a missing value", () => {
    const f = landscapeFinding({ ...base, context: { ...ctx, regions: null, regionsStatus: "withheld-mapping" as const } });
    expect(f.context).toContain("regional constraint withheld pending a verified transcript-to-protein mapping");
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

describe("bandSpans", () => {
  // Source of the numbers: PP3_BP4_CALIBRATION (Pejaver 2022 Table 2 / Bergquist 2025 Table 1).
  it("tiles REVEL's published bands across [0, 1] with no gap and no overlap", () => {
    const spans = bandSpans("revel");
    let pos = 0;
    for (const s of spans) {
      expect(s.lo).toBeCloseTo(pos, 10);
      pos = s.hi;
    }
    expect(pos).toBeCloseTo(1, 10);
    // The folded Strong swatch runs from 0 to the Moderate edge (VeryStrong 0.003 folds in).
    expect(spans.find((s) => s.key === "bp4-strong")).toMatchObject({ lo: 0, hi: 0.016 });
    expect(spans.find((s) => s.key === "bp4-moderate")).toMatchObject({ lo: 0.016, hi: 0.183 });
    expect(spans.find((s) => s.key === "indeterminate")).toMatchObject({ lo: 0.29, hi: 0.644 });
    expect(spans.find((s) => s.key === "pp3-moderate")).toMatchObject({ lo: 0.773, hi: 0.932 });
  });

  it("omits a strength the source does not publish (AlphaMissense BP4 Strong)", () => {
    const spans = bandSpans("alphaMissense");
    expect(spans.find((s) => s.key === "bp4-strong")).toBeUndefined();
    expect(spans.find((s) => s.key === "bp4-moderate")).toMatchObject({ lo: 0, hi: 0.099 });
    let pos = 0;
    for (const s of spans) {
      expect(s.lo).toBeCloseTo(pos, 10);
      pos = s.hi;
    }
    expect(pos).toBeCloseTo(1, 10);
  });
});

describe("bandTone", () => {
  it("maps bands to the design-system chip tones", () => {
    expect(bandTone("PP3")).toBe("danger");
    expect(bandTone("PP3 Moderate")).toBe("danger");
    expect(bandTone("BP4")).toBe("good");
    expect(bandTone("BP4 Strong")).toBe("good");
    expect(bandTone("Indeterminate")).toBe("neutral");
    expect(bandTone(null)).toBe("muted");
  });
});

describe("readsAsSentence", () => {
  it("names the queried substitution and both tools' bands in one plain sentence", () => {
    expect(
      readsAsSentence({
        kind: "variant", label: "A5V", scope: "x", stat: "mean", isQuery: true,
        calls: [
          { tool: "revel", score: 0.853, band: "PP3 Moderate" },
          { tool: "alphaMissense", score: 0.8401, band: "PP3" }
        ]
      })
    ).toBe("The queried substitution A5V reads in the PP3 range for REVEL (0.853 · PP3 Moderate) and in the PP3 range for AlphaMissense (0.840 · PP3).");
  });

  it("says 'indeterminate' and 'no score' in words, never as a number or a blank", () => {
    expect(
      readsAsSentence({
        kind: "variant", label: "D116G", scope: "x", stat: "mean", isQuery: true,
        calls: [
          { tool: "revel", score: 0.231, band: "BP4" },
          { tool: "alphaMissense", score: 0.362, band: "Indeterminate" }
        ]
      })
    ).toBe("The queried substitution D116G reads in the BP4 range for REVEL (0.231 · BP4) and indeterminate for AlphaMissense (0.362).");
    expect(
      readsAsSentence({
        kind: "residue", label: "A5", scope: "x", stat: "mean", isQuery: false,
        calls: [
          { tool: "revel", score: 0.831, band: "PP3 Moderate" },
          { tool: "alphaMissense", score: null, band: null }
        ]
      })
    ).toBe("Residue A5's mean (orientation only) reads in the PP3 range for REVEL (0.831 · PP3 Moderate) and no AlphaMissense score.");
  });
});

describe("landscapeVerdict", () => {
  const row116 = {
    residx: 116,
    amMean: 0.47, amMin: 0.1, amMax: 0.95, amCount: 3,
    revelMean: 0.41, revelMin: 0.1, revelMax: 0.9, revelCount: 3,
    gerp: 4.8, phylop: 7.6, nucleotideCount: 3,
    substitutions: [
      { alt: "G", am: 0.362, revel: 0.231 },
      { alt: "V", am: 0.95, revel: 0.9 },
      { alt: "N", am: 0.1, revel: 0.1 }
    ]
  } as any;

  it("names an off-target residue by dbNSFP's reference letter and never doubles 'Residue'", () => {
    const off = { ...row116, residx: 115, aaref: "K" };
    const picked = landscapeVerdict({ target: { pos: 116, wt: "D", mut: "G" }, residx: 115, row: off, variantRevel: 0.231, variantAm: 0.362, mode: "mean", selectedAlt: "V" });
    expect(picked.label).toBe("K115V");
    const residue = landscapeVerdict({ target: { pos: 116, wt: "D", mut: "G" }, residx: 115, row: off, variantRevel: 0.231, variantAm: 0.362, mode: "mean" });
    expect(readsAsSentence(residue)).toMatch(/^Residue K115's mean/);
    const noRef = landscapeVerdict({ target: { pos: 116, wt: "D", mut: "G" }, residx: 115, row: { ...row116, residx: 115 }, variantRevel: 0.231, variantAm: 0.362, mode: "mean" });
    expect(readsAsSentence(noRef)).toMatch(/^Residue 115's mean/);
    expect(readsAsSentence(noRef)).not.toMatch(/Residue Residue/);
  });

  it("reads the queried variant on the pipeline score when the table's differs", () => {
    const v = landscapeVerdict({ target: { pos: 116, wt: "D", mut: "G" }, residx: 116, row: row116, variantRevel: 0.5, variantAm: 0.6, mode: "mean" });
    expect(v.calls.map((c) => c.score)).toEqual([0.5, 0.6]);
  });

  it("reads a picked substitution at its own dbNSFP scores, variant-level", () => {
    const v = landscapeVerdict({
      target: { pos: 116, wt: "D", mut: "G" },
      residx: 116,
      row: row116,
      variantRevel: 0.231,
      variantAm: 0.362,
      mode: "mean",
      selectedAlt: "V"
    });
    expect(v.kind).toBe("substitution");
    expect(v.label).toBe("D116V");
    // 0.95 sits in Bergquist's +2 bin [0.906, 0.971] → Moderate, not Strong (Strong ≥ 0.99).
    expect(v.calls.find((c) => c.tool === "alphaMissense")).toMatchObject({ score: 0.95, band: "PP3 Moderate" });
    // Rank of the picked substitution among the scored set.
    expect(v.rank).toEqual({ rank: 1, of: 3 });
  });

  it("falls back to the queried variant's own scores when no substitution is picked", () => {
    const v = landscapeVerdict({
      target: { pos: 116, wt: "D", mut: "G" },
      residx: 116,
      row: row116,
      variantRevel: 0.231,
      variantAm: 0.362,
      mode: "mean"
    });
    expect(v.kind).toBe("variant");
    expect(v.label).toBe("D116G");
    expect(v.calls.map((c) => c.band)).toEqual(["BP4", "Indeterminate"]);
    expect(v.scope).toMatch(/variant-level/);
  });

  it("reads a plain residue pick on the residue summary and names it orientation only", () => {
    const v = landscapeVerdict({
      target: { pos: 5, wt: "A", mut: "V" },
      residx: 116,
      row: row116,
      variantRevel: 0.853,
      variantAm: 0.8401,
      mode: "mean"
    });
    expect(v.kind).toBe("residue");
    expect(v.isQuery).toBe(false);
    expect(v.calls.find((c) => c.tool === "alphaMissense")).toMatchObject({ score: 0.47, band: "Indeterminate" });
    expect(v.scope).toMatch(/orientation only/);
    expect(v.rank).toBeNull();
  });
});

describe("a residue with a REVEL record but no AlphaMissense score", () => {
  it("is named as a scoring gap, not as 'no dbNSFP missense record'", () => {
    const rows = [row(5, 0.5), row(6, null, { revelMean: 0.3, revelCount: 6 }), row(7, 0.2)];
    const f = landscapeFinding({ rows, window: { start: 5, end: 7 }, target: null, variantRevel: null, variantAm: null, mode: "mean", meta: meta() });
    expect(f.window).toContain("No AlphaMissense score for residue 6 (dbNSFP has a REVEL record there).");
  });
});

describe("the pipeline's variant score is cross-checked against the dbNSFP table", () => {
  const base = {
    window: { start: 5, end: 5 },
    target: { pos: 5, wt: "A", mut: "V" } as const,
    variantRevel: 0.853,
    variantAm: 0.8401,
    mode: "mean" as const,
    meta: meta()
  };
  const subsRow = (am: number | null, revel: number | null): LandscapeResidueItem =>
    row(5, 0.7, {
      amMin: 0.2,
      amMax: 0.95,
      amCount: 2,
      revelMean: 0.86,
      revelCount: 2,
      substitutions: [
        { alt: "V", am, revel },
        { alt: "T", am: 0.9, revel: 0.87 }
      ] as any
    });

  it("states the rank when the two tables agree at printed precision", () => {
    const f = landscapeFinding({ ...base, rows: [subsRow(0.8401, 0.853)] });
    expect(f.variant).toMatch(/it ranks 2 of the 2 substitutions with an AlphaMissense score at residue 5/);
    expect(f.cautions).toEqual([]);
  });

  it("withholds the rank and names the mismatch when the AlphaMissense readings disagree", () => {
    // dbNSFP cached an older table (0.790) than the pipeline read (0.8401).
    const f = landscapeFinding({ ...base, rows: [subsRow(0.79, 0.853)] });
    expect(f.variant).not.toMatch(/ranks/);
    expect(f.variant).toMatch(/among the 2 scored substitutions at residue 5/);
    expect(f.cautions[0]).toMatch(/disagree on A5V: AlphaMissense 0\.840 from the predictors pipeline vs 0\.790 in dbNSFP/);
    expect(f.cautions[0]).toMatch(/ranking is withheld/);
  });

  it("also names a disagreement in the RELEV reading, without touching the rank wording", () => {
    const f = landscapeFinding({ ...base, variantRevel: 0.7, rows: [subsRow(0.8401, 0.853)] });
    expect(f.variant).toMatch(/it ranks 2 of the 2/); // rank unaffected (it reads AlphaMissense only)
    expect(f.cautions[0]).toMatch(/REVEL 0\.700 from the predictors pipeline vs 0\.853 in dbNSFP/);
  });

  it("names a dbNSFP release gap as the likely cause when the two sides say their releases", () => {
    const f = landscapeFinding({
      ...base,
      rows: [subsRow(0.79, 0.853)],
      meta: meta({ sourceVersion: "dbNSFP 4.8a" }),
      predictorProvenance: { am: "local dbNSFP 5.0 (local)", revel: null }
    });
    expect(f.cautions[0]).toMatch(/The predictors read local dbNSFP 5\.0 \(local\), while this tab's table is dbNSFP 4\.8a — a different release is the likely cause\./);
  });

  it("says the readings disagree for another reason when the releases match", () => {
    const f = landscapeFinding({
      ...base,
      rows: [subsRow(0.79, 0.853)],
      meta: meta({ sourceVersion: "dbNSFP 4.8a" }),
      predictorProvenance: { am: "myvariant.info dbNSFP (release not stated)", revel: null }
    });
    // The pipeline's provenance carries no release, so no gap can be asserted.
    expect(f.cautions[0]).toMatch(/re-run the analysis to refresh both\./);
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

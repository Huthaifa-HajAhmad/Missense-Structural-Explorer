/**
 * reportDocument.test.ts — what the Report document may claim, and how edits and exclusions behave.
 *
 * Reference variant: NAE1 p.Asp116Gly. The old Report counted the model's PM2 as an applied criterion
 * beside a verdict the engine reached from PP3 alone, printed the narrative with no authorship line,
 * invented a "MANE Select" transcript and dated itself at render time.
 */
import { describe, expect, it } from "vitest";
import { buildInsightsEvidence } from "../insightsEvidence";
import {
  buildReportDocument,
  checksum,
  defaultReportSections,
  exportedBlocks,
  parseProse,
  proseToPlain,
  sectionsForPreset,
  strengthWord,
  type ReportDocumentInput,
} from "../reportDocument";
import { renderReportHtml, renderReportJson, renderReportText } from "../reportRender";

const functionInput = { residue: 116, uniprot: null, serviceStatus: "ok" } as any;

function nae1(): any {
  return {
    metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard", residueIndex: 116, wildType: "Asp", mutant: "Gly", pdbId: "1YOV", pdbSource: "RCSB PDB" },
    predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous", source: "Ensembl VEP", gnomadVariantId: "16-66823281-T-C", gnomadVariantAssembly: "GRCh38" },
    conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
    ruleBasedInsights: {
      plausibility: "",
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }],
      partialEvidence: { available: [], unavailable: [] },
    },
    insights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      acmgCriteria: [
        { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
        { code: "PM2", reason: "counts not provided in the prompt", source: "ai_suggested" },
        { code: "PS3", reason: "assay in a cited abstract", source: "ai_suggested" },
      ],
    },
  };
}

const energetics = { foldx: 2.62, foldxMean: 2.62, thermompnn: -0.36, stabilityoracle: -0.06 };

function input(over: Partial<ReportDocumentInput> = {}): ReportDocumentInput {
  const result = nae1();
  return {
    result,
    insights: buildInsightsEvidence({ result, functionInput, stability: { verdict: "Destabilizing (Engines Agree)", enginesCounted: 3, enginesDestabilizing: 1 } }),
    gene: "NAE1",
    variant: "p.Asp116Gly",
    uniprotId: "Q13564",
    foldingEnergetics: energetics,
    foldingDdG: 2.62,
    foldingStatus: "success",
    narrative: { text: "The wild-type residue is polar.\n\n## Structural context\nA void may form.", authorship: "ai", model: "gemini-test" },
    citations: [],
    sections: defaultReportSections(),
    edits: {},
    meta: { title: "", preparedBy: "", caseRef: "" },
    ...over,
  };
}

const block = (doc: ReturnType<typeof buildReportDocument>, key: string) => doc.blocks.find(b => b.key === key)!;

describe("classification", () => {
  const doc = buildReportDocument(input());
  const c = block(doc, "classification");

  it("lists only the criteria the engine recorded as counted", () => {
    expect(c.counted).toEqual(["PP3"]);
    const rows = c.table!.rows;
    expect(rows.find(r => r[0] === "PP3")![1]).toBe("Supporting");
    expect(c.text).toContain("counted 1 criterion: PP3");
  });

  it("shows a model proposal once, as not counted, and never lets it turn an engine-owned PM2 row to met", () => {
    const rows = c.table!.rows;
    expect(rows.find(r => r[0] === "PS3")![2]).toBe("Not counted");
    // PM2 is an engine-owned code: its row shows the engine's state, never the model's proposal.
    expect(rows.find(r => r[0] === "PM2")?.[2] ?? "").not.toBe("Met");
    expect(c.caption).toContain("Also checked, no evidence recorded:");
    expect(rows.filter(r => r[2] === "Met").map(r => r[0])).toEqual(["PP3"]);
    expect(rows.flat().join(" ")).not.toContain("counts not provided in the prompt");
    expect(c.caption).toContain("1 model proposal for a code the engine owns was dropped");
  });

  it("carries the engine's tier and never a ClinVar sentence", () => {
    expect(c.verdict!.tier).toBe("Uncertain");
    expect(c.verdict!.text).toContain("Uncertain Significance");
  });

  it("says what a bare PM code weighs in the tier instead of leaving the strength blank", () => {
    expect(strengthWord("PM2")).toBe("Supporting"); // ClinGen SVI 2020 PM2_Supporting
    expect(strengthWord("PM1")).toBe("Moderate");
    expect(strengthWord("PP3")).toBe("Supporting");
    expect(strengthWord("BP4")).toBe("Supporting");
    expect(strengthWord("BA1")).toBe("Stand-alone");
  });

  it("states a stale record instead of resolving it silently", () => {
    const r = nae1();
    r.ruleBasedInsights.acmgVerdict = "Likely Pathogenic";
    const mism = buildReportDocument(input({ result: r, insights: buildInsightsEvidence({ result: r, functionInput, stability: null }) }));
    expect(block(mism, "classification").text).toContain("Recorded tier and current rule differ");
  });
});

describe("identity", () => {
  it("reports the coordinate and build, and omits a transcript it could not resolve", () => {
    const id = block(buildReportDocument(input()), "identity");
    expect(id.facts.find(f => f.label === "Genomic")!.value).toBe("16-66823281-T-C (GRCh38)");
    expect(id.facts.some(f => f.label === "Transcript")).toBe(false);
    expect(JSON.stringify(id)).not.toContain("MANE Select");
  });

  it("says when no coordinate was reported", () => {
    const r = nae1();
    delete r.predictorData.gnomadVariantId;
    const id = block(buildReportDocument(input({ result: r })), "identity");
    expect(id.facts.find(f => f.label === "Genomic")!.value).toBe("Not reported for this run");
  });
});

describe("evidence blocks", () => {
  const doc = buildReportDocument(input());

  it("takes each lane's sentence and counted state from the consolidator", () => {
    const comp = block(doc, "computational");
    expect(comp.counted).toEqual(["PP3"]);
    expect(comp.chips.map(c => c.label)).toContain("PP3 counted");
    expect(comp.text).toContain("says tolerated");
    expect(comp.table!.headers).toEqual(["Tool", "Score", "Call", "Role"]);
  });

  it("prints the stability engines with canonical signs and says it is not an ACMG input", () => {
    const s = block(doc, "stability");
    const foldx = s.table!.rows.find(r => r[0].startsWith("FoldX"))!;
    expect(foldx[1]).toMatch(/^\+2\.62/);
    expect(s.caption).toContain("not an ACMG input");
  });

  it("states population absence as a statement", () => {
    expect(block(doc, "population").text).toMatch(/No frequency evidence was counted|No frequency criterion applies/);
  });

  it("names structure quality gaps instead of leaving them blank", () => {
    const st = block(doc, "structure");
    expect(st.facts.find(f => f.label === "Model")!.value).toBe("1YOV");
    expect(st.text).toContain("does not state");
  });
});

describe("the narrative", () => {
  it("is its own block with an authorship chip and an unverified caption", () => {
    const s = block(buildReportDocument(input()), "summary");
    expect(s.chips.map(c => c.label)).toContain("AI-written");
    expect(s.caption).toContain("Not verified against the evidence above");
  });

  it("labels a degraded run's text as rule-based, never as model-written", () => {
    const s = block(buildReportDocument(input({ narrative: { text: "Assembled text.", authorship: "rule-based", model: null } })), "summary");
    expect(s.chips[0].label).toBe("Rule-based text, not model-written");
    expect(s.caption).toContain("no model wrote it");
  });

  it("is empty, and skipped by exports, when nothing was generated", () => {
    const doc = buildReportDocument(input({ narrative: { text: "", authorship: "none", model: null } }));
    expect(block(doc, "summary").empty).toBe(true);
    expect(exportedBlocks(doc).some(b => b.key === "summary")).toBe(false);
  });
});

describe("edits", () => {
  it("replaces the block's text, marks it, and keeps the drafted text", () => {
    const base = block(buildReportDocument(input()), "computational").drafted;
    const doc = buildReportDocument(input({ edits: { computational: { text: "My reading.", base } } }));
    const b = block(doc, "computational");
    expect(b.edited).toBe(true);
    expect(b.text).toBe("My reading.");
    expect(b.drafted).toBe(base);
    expect(b.stale).toBe(false);
    expect(b.chips.some(c => c.label === "Edited by the author" && c.dashed)).toBe(true);
    expect(b.table).not.toBeNull();
  });

  it("marks an edit stale when the drafted text has changed since", () => {
    const doc = buildReportDocument(input({ edits: { computational: { text: "My reading.", base: "an older draft" } } }));
    expect(block(doc, "computational").stale).toBe(true);
  });

  it("cannot overwrite the classification's verdict or criteria", () => {
    const doc = buildReportDocument(input({ edits: { classification: { text: "Pathogenic, I say.", base: "" } } }));
    const c = block(doc, "classification");
    expect(c.text).toBe("Pathogenic, I say.");
    expect(c.verdict!.tier).toBe("Uncertain");
    expect(c.counted).toEqual(["PP3"]);
    expect(renderReportText(doc)).toContain("Classification: Variant of Uncertain Significance (VUS)");
  });

  it("makes an author's-notes block appear once it has text", () => {
    expect(block(buildReportDocument(input()), "notes").empty).toBe(true);
    const doc = buildReportDocument(input({ edits: { notes: { text: "Discuss at MDT.", base: "" } } }));
    expect(block(doc, "notes").empty).toBe(false);
    expect(renderReportText(doc)).toContain("Discuss at MDT.");
  });
});

describe("exclusions", () => {
  const sections = { ...defaultReportSections(), population: false, splicing: false, computational: false };
  const doc = buildReportDocument(input({ sections }));

  it("hides excluded blocks from every format", () => {
    for (const out of [renderReportText(doc), renderReportHtml(doc), JSON.stringify(renderReportJson(doc))]) {
      expect(out).not.toContain("Scores are not probabilities");
    }
    expect(exportedBlocks(doc).map(b => b.key)).not.toContain("computational");
  });

  it("names what was left out, and warns when its criterion is still counted", () => {
    expect(doc.footer.omitted).toContain("RNA splicing");
    expect(doc.footer.omitted.find(o => o.startsWith("Computational evidence"))).toContain("PP3 is still counted in the classification");
    expect(renderReportText(doc)).toContain("Not included by the author:");
  });

  it("lets even identity, classification and method be left out", () => {
    const all = { ...defaultReportSections(), identity: false, classification: false, method: false };
    const d = buildReportDocument(input({ sections: all }));
    expect(exportedBlocks(d).map(b => b.key)).not.toEqual(expect.arrayContaining(["identity"]));
    // The footer, which is not a block, still carries the research-use line and the scope.
    expect(renderReportText(d)).toContain("Not a validated diagnostic report");
    expect(d.footer.omitted.length).toBeGreaterThan(0);
  });

  it("presets only choose ticks", () => {
    const one = sectionsForPreset("one-page");
    expect(one.identity && one.classification && one.method).toBe(true);
    expect(one.computational).toBe(false);
    expect(Object.values(sectionsForPreset("full")).every(Boolean)).toBe(true);
  });
});

describe("document id and stamps", () => {
  it("changes when the exported text changes and not otherwise", () => {
    const a = buildReportDocument(input());
    const b = buildReportDocument(input());
    expect(a.footer.documentId).toBe(b.footer.documentId);
    const edited = buildReportDocument(input({ edits: { notes: { text: "x", base: "" } } }));
    expect(edited.footer.documentId).not.toBe(a.footer.documentId);
    expect(checksum("a")).not.toBe(checksum("b"));
    expect(checksum("abc")).toMatch(/^[0-9a-f]{14}$/);
  });

  it("stamps the export time only when one is given, never the render time", () => {
    expect(buildReportDocument(input()).footer.generatedAt).toBeNull();
    const stamped = buildReportDocument(input({ generatedAt: "2026-09-30T12:00:00.000Z" }));
    expect(renderReportText(stamped)).toContain("on 2026-09-30");
  });

  it("makes no validation or compliance claim", () => {
    const text = renderReportText(buildReportDocument(input()));
    expect(text).not.toMatch(/validated biomolecular|compliance|protocol v/i);
    expect(text).toContain("Not a validated diagnostic report");
  });
});

describe("prose markup", () => {
  it("reads paragraphs, bold, bullets and headings and treats everything else as text", () => {
    const nodes = parseProse("**Lead.** Rest.\n\n- one\n- two\n\n## Head\nBody <b>x</b>");
    expect(nodes.map(n => n.type)).toEqual(["p", "ul", "h", "p"]);
    expect(proseToPlain("**Lead.** Rest.\n\n- one")).toBe("Lead. Rest.\n\n- one");
  });

  it("escapes markup in the html file", () => {
    const doc = buildReportDocument(input({ edits: { notes: { text: "<script>alert(1)</script> & more", base: "" } } }));
    const html = renderReportHtml(doc);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("json", () => {
  it("carries drafted and author text separately and the document id", () => {
    const doc = buildReportDocument(input({ edits: { computational: { text: "Mine.", base: "" } }, generatedAt: "2026-09-30T00:00:00.000Z" }));
    const json: any = renderReportJson(doc);
    const comp = json.blocks.find((b: any) => b.key === "computational");
    expect(comp.authorText).toBe("Mine.");
    expect(comp.drafted).toContain("says tolerated");
    expect(json.documentId).toBe(doc.footer.documentId);
    expect(json.schema).toBe("mse.report-document/1");
  });
});

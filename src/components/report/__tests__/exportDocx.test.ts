import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildReportDocument, defaultReportSections } from "../../../shared/reportDocument";
import { buildInsightsEvidence } from "../../../shared/insightsEvidence";
import { buildReportDocx } from "../exportDocx";

const functionInput = { residue: 116, uniprot: null, serviceStatus: "ok" } as any;
const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard", residueIndex: 116, wildType: "Asp", mutant: "Gly" },
  analysis: "### Clinical\n\nThe **model's** prose.",
  predictorData: { caddPhred: 26.3, amPathogenicity: 0.362, amClass: "ambiguous", source: "Ensembl VEP", gnomadVariantId: "16-66823281-T-C", gnomadVariantAssembly: "GRCh38" },
  conservationData: { revel: 0.231, metarnn: 0.529, clinpred: 0.977 },
  ruleBasedInsights: { plausibility: "", acmgVerdict: "Variant of Uncertain Significance (VUS)", acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }], partialEvidence: { available: [], unavailable: [] } },
  insights: { acmgVerdict: "Variant of Uncertain Significance (VUS)", model: "gemini-test", source: "ai_inference", acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree", source: "database_verified" }, { code: "PS3", reason: "assay in a cited abstract", source: "ai_suggested" }] },
};

function doc(over: Record<string, unknown> = {}) {
  return buildReportDocument({
    result,
    insights: buildInsightsEvidence({ result, functionInput, stability: null }),
    gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564",
    narrative: { text: "The **model's** prose.", authorship: "ai", model: "gemini-test" },
    citations: [], sections: defaultReportSections(), edits: {}, meta: { title: "", preparedBy: "A. Researcher", caseRef: "" },
    generatedAt: "2026-09-30T12:00:00.000Z",
    ...over,
  } as any);
}

async function xml(d: ReturnType<typeof doc>) {
  const blob = await buildReportDocx(d);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return { blob, main: await zip.file("word/document.xml")!.async("string"), names: Object.keys(zip.files) };
}

describe("buildReportDocx", () => {
  it("writes a Word package carrying the title, tier, criteria and footer ID", async () => {
    const d = doc();
    const { blob, main, names } = await xml(d);
    expect(blob.type).toContain("wordprocessingml");
    expect(names).toContain("word/document.xml");
    expect(main).toContain("NAE1 p.Asp116Gly evidence report");
    expect(main).toContain("Variant of Uncertain Significance (VUS)");
    expect(main).toContain("PS3");
    expect(main).toContain("Not counted");
    expect(main).toContain(d.footer.documentId);
    expect(main).toContain("Research use");
  });

  it("leaves out blocks the author left out and names them", async () => {
    const d = doc({ sections: { ...defaultReportSections(), computational: false, splicing: false } });
    const { main } = await xml(d);
    expect(main).not.toContain("Scores are not probabilities");
    expect(main).toContain("Not included by the author");
    expect(main).toContain("RNA splicing");
  });

  it("marks an edited block and carries the author's words", async () => {
    const d = doc({ edits: { notes: { text: "Discuss at MDT.", base: "" } } });
    const { main } = await xml(d);
    expect(main).toContain("Discuss at MDT.");
  });

  it("escapes markup in author text", async () => {
    const d = doc({ edits: { notes: { text: "<b>x</b> & y", base: "" } } });
    const { main } = await xml(d);
    expect(main).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
});

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildReportDocument, defaultReportSections } from "../../../shared/reportDocument";
import { buildInsightsEvidence } from "../../../shared/insightsEvidence";
import { buildReportPptx, leadOf } from "../exportPptx";

const functionInput = { residue: 116, uniprot: null, serviceStatus: "ok" } as any;
const result: any = {
  metadata: { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", acmgWeighting: "standard", residueIndex: 116, wildType: "Asp", mutant: "Gly" },
  analysis: "### Clinical\n\nThe model's prose.",
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
    narrative: { text: "The model's prose.", authorship: "ai", model: "gemini-test" },
    citations: [], sections: defaultReportSections(), edits: {}, meta: { title: "", preparedBy: "A. Researcher", caseRef: "" },
    generatedAt: "2026-09-30T12:00:00.000Z",
    ...over,
  } as any);
}

async function open(d: ReturnType<typeof doc>) {
  const blob = await buildReportPptx(d);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const texts = await Promise.all(slides.map(n => zip.file(n)!.async("string")));
  const notes = await Promise.all(Object.keys(zip.files).filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)).map(n => zip.file(n)!.async("string")));
  return { blob, slides: texts, notes, all: texts.join("\n") };
}

describe("buildReportPptx", () => {
  it("builds a short summary deck with the title, tier, criteria and Document ID", async () => {
    const d = doc();
    const { blob, slides, all } = await open(d);
    expect(blob.type).toContain("presentationml");
    expect(slides.length).toBeGreaterThanOrEqual(5);
    expect(slides.length).toBeLessThanOrEqual(10);
    expect(all).toContain("NAE1 p.Asp116Gly evidence report");
    expect(all).toContain("Variant of Uncertain Significance (VUS)");
    expect(all).toContain("PS3");
    expect(all).toContain("Not counted");
    expect(all).toContain(d.footer.documentId);
  });

  it("keeps the full block text in the speaker notes", async () => {
    const { notes } = await open(doc());
    expect(notes.join("\n")).toContain("Not enough evidence either way yet.");
  });

  it("leaves out blocks the author left out and names them", async () => {
    const d = doc({ sections: { ...defaultReportSections(), computational: false, splicing: false } });
    const { all } = await open(d);
    expect(all).not.toContain("<a:t>Computational evidence</a:t>");
    expect(all).toContain("Computational evidence (its PP3 is still counted");
    expect(all).toContain("Not included by the author");
  });

  it("paginates the evidence readings instead of overflowing one slide", async () => {
    const few = await open(doc({ sections: { ...defaultReportSections(), computational: true, population: false, splicing: false, function: false, structure: false, stability: false, assembly: false, "language-models": false } }));
    const many = await open(doc());
    expect(many.slides.length).toBeGreaterThan(few.slides.length);
  });
});

describe("leadOf", () => {
  it("keeps a short first paragraph whole and drops markup", () => {
    expect(leadOf("**Three of six** predictors call it damaging.\n\nMore.")).toBe("Three of six predictors call it damaging.");
  });
  it("cuts a long paragraph at a sentence end", () => {
    const long = "First sentence is here. " + "Filler words go on. ".repeat(30);
    const out = leadOf(long, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith(".")).toBe(true);
  });
});

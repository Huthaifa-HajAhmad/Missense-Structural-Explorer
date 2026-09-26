// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useVariantAnalysisStore } from "../useVariantAnalysisStore";
import { generateStructuredEhrReport } from "../../components/report/reportStatus";

/**
 * The two "Copy Report" buttons must emit the same document, and neither may paste a database status
 * into the verdict slot.
 *
 * The Insights view's handler built its own three-line text:
 *
 *     `${clinvar.classification ?? ruleBasedInsights.acmgVerdict}\n\n${analysis}\n\nACMG: ${codes}`
 *
 * `??` falls through on null/undefined only, and `clinvar.classification` is a REAL string
 * ("Not found in ClinVar") for a variant ClinVar does not hold — so pasting the report from the
 * Insights view began with **"Not found in ClinVar" where a classification belongs**, while the
 * identically-labelled button in the Report view began with the rule engine's verdict. It also omitted
 * the plausibility, the ACMG reasons, the energetics, the evidence completeness, the numbering basis,
 * and ignored the report's section toggles.
 *
 * Nothing tested any of it: the only references to `handleCopyReport` in the suite were `vi.fn()` prop
 * stubs, so a revert to the old assembly passed the whole suite.
 */

function writeClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** A variant ClinVar does not hold, with the rule engine's verdict and tagged criteria. */
function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys", uniprotId: "Q9H4Z3" },
    analysis: "### Clinical and Pathogenicity Interpretation\n\nThe variant is plausibly uncertain.",
    clinvar: {
      classification: "Not found in ClinVar",
      reviewStatus: "",
      trait: "",
      alleleFrequencies: [],
      uid: null,
    },
    insights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      plausibility: "Plausibly uncertain in pathogenicity.",
      model: "gemini-3.7-flash",
      source: "ai_inference",
      acmgCriteria: [
        { code: "PP3", reason: "4/10 predictors agree.", source: "database_verified" },
      ],
    },
    ruleBasedInsights: {
      acmgVerdict: "Variant of Uncertain Significance (VUS)",
      plausibility: "Plausibly pathogenic based on gathered evidence: PP3.",
      acmgCriteria: [{ code: "PP3", reason: "4/10 predictors agree." }],
    },
    ...overrides,
  } as any;
}

async function copyReport(result: any, gene = "CNNM2", variant = "p.Ser489Cys") {
  const writeText = writeClipboard();
  const store = useVariantAnalysisStore.getState();
  store.setGene(gene);
  store.setVariant(variant);
  store.setUniprotId("Q9H4Z3");
  await store.handleCopyReport(result);
  expect(writeText, "the handler must have written to the clipboard").toHaveBeenCalledTimes(1);
  return writeText.mock.calls[0][0] as string;
}

describe("handleCopyReport", () => {
  beforeEach(() => {
    useVariantAnalysisStore.getState().setReportSections({
      summary: true, acmg: true, structure: true, energetics: true, literature: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the rule engine's verdict in the verdict slot, never the ClinVar sentinel", async () => {
    const text = await copyReport(baseResult());

    const headline = text.split("\n").find(line => line.startsWith("Headline Verdict:"));
    expect(headline).toContain("Variant of Uncertain Significance (VUS)");
    // The defect: this line read `Headline Verdict:   Not found in ClinVar`.
    expect(headline).not.toContain("Not found in ClinVar");
  });

  it("emits the same document as the Report view's own builder", async () => {
    // Both buttons call `generateStructuredEhrReport`. The store supplies live energetics, so the
    // comparison uses the same (absent) energetics the fixtures carry.
    const result = baseResult();
    const text = await copyReport(result);

    const store = useVariantAnalysisStore.getState();
    const expected = generateStructuredEhrReport({
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      reportedVariant: "p.Ser489Cys",
      modelledVariant: "p.Ser489Cys",
      uniprotId: "Q9H4Z3",
      reportedTranscriptId: null,
      basisNote: undefined,
      headlineVerdict: "Variant of Uncertain Significance (VUS)",
      plausibility: result.insights.plausibility,
      acmgCriteria: [{ code: "PP3", reason: "4/10 predictors agree.", source: "database_verified" }],
      energetics: null,
      foldingDdG: null,
      result,
      narrative: result.analysis,
      evidenceSummary: (store as any).evidenceSummary ?? undefined,
      sections: undefined,
    } as any);

    // The shared builder is the source of truth; assert the parts a reader files rather than the whole
    // string, which also carries a generated date.
    for (const marker of ["CLINICAL GENOMICS & BIOPHYSICAL ASSESSMENT REPORT", "ACMG / AMP EVIDENCE CRITERIA", "Headline Verdict:"]) {
      expect(text).toContain(marker);
      expect(expected).toContain(marker);
    }
    expect(text).toMatch(/\[PP3\] 4\/10 predictors agree\./);
    expect(text).toMatch(/CLINICAL NARRATIVE & SYNTHESIS/);
  });

  it("carries the provenance that the old three-line text omitted", async () => {
    const text = await copyReport(baseResult());

    // Verdict + plausibility + criteria reasons + prevalence of the numbered basis.
    expect(text).toContain("Plausibility:");
    expect(text).toContain("Canonical UniProt:  Q9H4Z3");
    expect(text).toMatch(/Evidence Completeness: \d+ of \d+ sources retrieved\./);
    // The source tag on the criterion now travels with it, which is what makes the two buttons agree.
    expect(text).toContain("(Source: database_verified)");
  });

  it("honours the report's own section toggles", async () => {
    const store = useVariantAnalysisStore.getState();
    store.setReportSections({ summary: false, acmg: false, structure: true, energetics: false, literature: false });

    const text = await copyReport(baseResult());

    // A section switched off in the Report inspector must not reappear in the pasted document.
    expect(text).not.toContain("CLINICAL NARRATIVE & SYNTHESIS");
    expect(text).not.toContain("ACMG / AMP EVIDENCE CRITERIA");
  });

  it("does not assert a reference transcript it could not resolve", async () => {
    /*
     * The builder's `reportedTranscriptId` used to fall back to the literal "MANE Select", so a filed
     * report declared a specific reference-sequence designation whenever no transcript had resolved —
     * in the one header block a reader uses to check the right transcript was analysed.
     */
    const text = await copyReport(
      baseResult({ metadata: { gene: "CNNM2", variant: "p.Ser489Cys", uniprotId: "Q9H4Z3" } }),
      "CNNM2",
      "p.Ser489Cys"
    );

    expect(text).not.toMatch(/Transcript:\s+MANE Select/);
  });

  it("does not paste undefined or NaN into a clinical document", async () => {
    // The builder is the only text producer now, and it must not interpolate a missing value.
    const text = await copyReport(baseResult({ ruleBasedInsights: undefined, insights: {} }));

    expect(text).not.toMatch(/\bundefined\b/);
    expect(text).not.toMatch(/\bNaN\b/);
    expect(text).not.toMatch(/\bnull\b/);
  });

  it("does nothing when there is no result", async () => {
    const writeText = writeClipboard();
    await useVariantAnalysisStore.getState().handleCopyReport(null);
    expect(writeText).not.toHaveBeenCalled();
  });
});

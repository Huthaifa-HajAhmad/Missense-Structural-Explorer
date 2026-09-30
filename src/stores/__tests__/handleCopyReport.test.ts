// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useVariantAnalysisStore } from "../useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../slices/uiSlice";
import { buildReportDocument } from "../../shared/reportDocument";
import { reportInputFromRun } from "../../shared/reportInput";
import { renderReportText } from "../../shared/reportRender";

/**
 * The two "Copy Report" buttons must emit the same document, and neither may paste a database status
 * into the classification slot. Both now render the Report document (`buildReportDocument`), so the
 * author's included blocks and edits apply to the pasted text as they do to every export.
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
    const s = useVariantAnalysisStore.getState();
    s.setReportSections({ ...DEFAULT_REPORT_SECTIONS });
    s.loadReportDraft(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("puts the rule engine's tier in the classification slot, never the ClinVar sentinel", async () => {
    const text = await copyReport(baseResult());

    const line = text.split("\n").find(l => l.startsWith("Classification:"));
    expect(line).toContain("Variant of Uncertain Significance (VUS)");
    // The defect: the verdict slot read `Not found in ClinVar`.
    expect(text).not.toMatch(/Classification:[^\n]*Not found in ClinVar/);
  });

  it("emits the same document as the Report screen's own builder", async () => {
    const result = baseResult();
    const text = await copyReport(result);

    const st = useVariantAnalysisStore.getState();
    const expected = renderReportText(
      buildReportDocument(
        reportInputFromRun({
          result,
          gene: "CNNM2",
          variant: "p.Ser489Cys",
          uniprotId: "Q9H4Z3",
          foldingEnergetics: null,
          foldingDdG: null,
          foldingStatus: null,
          isLoading: false,
          draft: { sections: st.reportSections, edits: st.reportEdits, meta: st.reportMeta, citations: st.reportCitations },
          generatedAt: null,
        })
      )
    );
    // The copy is stamped with its export time and the Document ID follows the text, so compare the body.
    const body = (t: string) => t.split("\n").filter(l => !l.startsWith("Generated ") && !l.startsWith("Document ID")).join("\n");
    expect(body(text)).toBe(body(expected));
    expect(text).toMatch(/PP3/);
    expect(text).toContain("Research use.");
  });

  it("honours the report's own block toggles", async () => {
    useVariantAnalysisStore.getState().setReportSections({ ...DEFAULT_REPORT_SECTIONS, summary: false, computational: false });

    const text = await copyReport(baseResult());

    expect(text).not.toContain("WRITTEN SUMMARY");
    expect(text).not.toContain("plausibly uncertain");
    expect(text).toContain("Not included by the author:");
  });

  it("carries the author's edits and marks them", async () => {
    useVariantAnalysisStore.getState().setReportEdit("notes", "Discuss at MDT.", "");

    const text = await copyReport(baseResult());

    expect(text).toContain("Discuss at MDT.");
  });

  it("does not assert a reference transcript it could not resolve", async () => {
    const text = await copyReport(baseResult());

    expect(text).not.toMatch(/MANE Select/);
  });

  it("does not paste undefined or NaN into a clinical document", async () => {
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

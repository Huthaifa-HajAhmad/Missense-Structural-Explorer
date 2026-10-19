// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import ClinicalInsightsCard from "../ClinicalInsightsCard";
import { SettingsProvider } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { DEFAULT_REPORT_SECTIONS } from "../../stores/slices/uiSlice";

/**
 * The Insights view shows a CONDENSED narrative; the Report owns the full text.
 *
 * The card used to render the whole narrative verbatim in a collapsible panel — the same text the
 * Report's "Executive Summary & Clinical Narrative" section prints. Two copies of one AI artefact
 * existed in one viewport and only the Report copy was covered by the section toggles, the print pass,
 * the EHR export and the report fingerprint. These tests pin the four things that make the replacement
 * safe rather than merely shorter:
 *
 *   1. the FULL narrative is no longer rendered here;
 *   2. the summary is the narrative's clinical conclusion, not its opening argument;
 *   3. the card says who wrote the prose, so a rule-based run is not presented as a model's;
 *   4. the link actually reaches the Report, including when the reader had the section switched off
 *      (a disabled section does not mount, so the anchor would otherwise resolve to nothing).
 */

beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

/** Shaped like a real response: four `###` sections, the clinical one third. */
const NARRATIVE = [
  "### \u{1F9EC} Molecular and Chemical Shift",
  "",
  "MOLECULAR_SECTION_MARKER: wild-type Ser is polar and small, Cys is bulkier.",
  "",
  "### \u{1F3E5} Clinical and Pathogenicity Interpretation",
  "",
  "CLINICAL_SECTION_MARKER the variant is plausibly uncertain in pathogenicity. No functional study",
  "has been reported.",
  "",
  "### \u{1F52C} Recommended 3D Visualization Landmarks",
  "",
  "LANDMARK_SECTION_MARKER inspect the loop between the two helices.",
].join("\n");

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { gene: "CNNM2", variant: "p.Ser489Cys", wildType: "Ser", mutant: "Cys", residueIndex: 489 },
    analysis: NARRATIVE,
    insights: {
      biochemicalShift: "Polar to polar, side chain volume increases.",
      structuralImpact: "Local packing is altered.",
      acmgCriteria: [],
      model: "gemini-3.7-flash",
      source: "ai_inference",
    },
    ...overrides,
  } as any;
}

function renderCard(result: any, overrides: Record<string, unknown> = {}) {
  const rendered = render(
    <SettingsProvider>
      <ClinicalInsightsCard
        {...({
          isDark: false,
          classCard: "",
          classCardHeader: "",
          classCardTitle: "",
          classTextBody: "",
          classTextMute: "",
          classBorderSec: "",
          analysisState: { result, isLoading: false, error: null },
          handleCopyReport: vi.fn(),
          copied: false,
          gene: "CNNM2",
          variant: "p.Ser489Cys",
          uniprotId: "Q9H4Z3",
          loadingStep: "",
          formatEnergyString: (v: string | null | undefined) => v ?? "",
          selectedResidueIndex: 489,
          settings: { acmgWeighting: {}, energyUnit: "kcal/mol" },
          ...overrides,
        } as any)}
      />
    </SettingsProvider>
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Written summary' }));
  return rendered;
}

/** The store is global, so a test that disables a section must put it back. */
afterEach(() => {
  useVariantAnalysisStore.getState().setReportSections({ ...DEFAULT_REPORT_SECTIONS, summary: true });
  vi.restoreAllMocks();
});

describe("ClinicalInsightsCard — condensed clinical summary", () => {
  it("does not render the full narrative any more", () => {
    renderCard(baseResult());

    // The sections that are the ARGUMENT, not the conclusion. Rendering any of these means the
    // second copy of the narrative is back.
    expect(screen.queryByText(/MOLECULAR_SECTION_MARKER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LANDMARK_SECTION_MARKER/)).not.toBeInTheDocument();
    // ...and the markdown headings the panel used to render.
    expect(screen.queryByText(/Molecular and Chemical Shift/)).not.toBeInTheDocument();
  });

  it("shows the clinical conclusion and labels where it came from", () => {
    renderCard(baseResult());

    expect(screen.getByText(/CLINICAL_SECTION_MARKER/)).toBeInTheDocument();
    expect(screen.getByText("Written interpretation")).toBeInTheDocument();
    expect(screen.getByText("Clinical and Pathogenicity Interpretation")).toBeInTheDocument();
  });

  it("says the prose is AI-synthesised and names the model, from the payload", () => {
    renderCard(baseResult());

    expect(screen.getByText(/AI-synthesised by gemini-3\.7-flash/i)).toBeInTheDocument();
    expect(screen.queryByText(/Rule-based synthesis/i)).not.toBeInTheDocument();
  });

  it("does NOT present a rule-based narrative as a model's", () => {
    renderCard(
      baseResult({
        analysis: "### Rule-Based Clinical Summary\n\nRULE_BASED_MARKER assembled from database evidence.",
        isFallback: true,
        fallbackReason: "PROVIDER_OVERLOADED",
        insights: { biochemicalShift: "Not synthesized", structuralImpact: "Not synthesized", acmgCriteria: [], source: "rule_based" },
      })
    );

    expect(screen.getByText(/RULE_BASED_MARKER/)).toBeInTheDocument();
    expect(screen.getByText(/Rule-based synthesis/i)).toBeInTheDocument();
    expect(screen.queryByText(/AI-synthesised/i)).not.toBeInTheDocument();
  });

  it("renders nothing for a missing narrative rather than an empty panel", () => {
    renderCard(baseResult({ analysis: "" }));

    expect(screen.queryByText("Clinical summary")).not.toBeInTheDocument();
  });

  it("takes the reader to the Report when the link is used", () => {
    const onNavigateToView = vi.fn();
    renderCard(baseResult(), { onNavigateToView });

    fireEvent.click(screen.getByRole("button", { name: /full report|full narrative in the Report/i }));

    expect(onNavigateToView).toHaveBeenCalledWith("report");
  });

  it("re-enables the Report's summary section before navigating, so the anchor resolves", () => {
    // A section switched off does not mount, so #report-summary would not exist and the scroll would
    // silently do nothing — the reader would land on a Report that does not contain the narrative.
    useVariantAnalysisStore.getState().setReportSections({ ...DEFAULT_REPORT_SECTIONS, summary: false });
    expect(useVariantAnalysisStore.getState().reportSections.summary).toBe(false);

    const onNavigateToView = vi.fn();
    renderCard(baseResult(), { onNavigateToView });
    fireEvent.click(screen.getByRole("button", { name: /full report|full narrative in the Report/i }));

    expect(useVariantAnalysisStore.getState().reportSections.summary).toBe(true);
    expect(onNavigateToView).toHaveBeenCalledWith("report");
  });

  it("discloses condensation when the section is longer than the summary ceiling", () => {
    /*
     * The heading goes on its OWN line. This fixture previously joined heading and sentences with a
     * single space, which makes the whole thing one line — so `splitSections` read it as a heading with
     * an empty body, and the assertion passed only because the old implementation fell back to
     * `toProse(wholeDocument)` while still labelling it with that heading. Removing that fallback exposed
     * the fixture: a real narrative puts its body on the next line, and this one now does too.
     */
    const longClinical = [
      "### Clinical and Pathogenicity Interpretation",
      "",
      Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} argues the clinical point at length.`).join(" "),
    ].join("\n");

    renderCard(baseResult({ analysis: longClinical }));

    // Named rather than merely tagged: the summary keeps whole sentences, so a claim can survive the
    // cut while the sentence qualifying it does not, and the reader has to be told the text continues.
    expect(screen.getByText("Excerpt — continues")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /full narrative in the Report/i })).toBeInTheDocument();
  });

  it("does not offer a full-report link it cannot honour", () => {
    // No onNavigateToView (e.g. a host that did not wire it): the button must still exist and not throw.
    const onNavigateToView = undefined;
    renderCard(baseResult(), { onNavigateToView });

    const button = screen.getByRole("button", { name: /full report|full narrative in the Report/i });
    expect(() => fireEvent.click(button)).not.toThrow();
  });
});

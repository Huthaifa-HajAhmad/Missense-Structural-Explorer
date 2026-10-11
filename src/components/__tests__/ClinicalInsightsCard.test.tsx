// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import ClinicalInsightsCard from "../ClinicalInsightsCard";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * jsdom has no ResizeObserver, which the chart's responsive container requires.
 * Stubbed locally rather than in the shared setup so the dependency stays visible
 * at the one test that needs it.
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

/**
 * The Insights view had no tests despite carrying the largest behavioural rewrite
 * of the whole change: its radar moved from re-parsing the variant string with a
 * defaulted all-50 fallback to the shared resolver, its axis names and angular
 * order changed, and its biochemical-shift paragraph switched to the shared
 * narrative classifier.
 */

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      gene: "MACO1",
      variant: "p.Glu433Lys",
      wildType: "Glu",
      mutant: "Lys",
      residueIndex: 433
    },
    insights: {
      biochemicalShift: "Charge swap: Negative (Glu) to Positive (Lys).",
      structuralImpact: "Local packing is altered.",
      acmgCriteria: []
    },
    ...overrides
  } as any;
}

function renderCard(result: any, overrides: Record<string, unknown> = {}) {
  const props = {
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
    gene: "MACO1",
    variant: "p.Glu433Lys",
    uniprotId: "Q8N5G2",
    loadingStep: "",
    formatEnergyString: (value: string | null | undefined) => value ?? "",
    selectedResidueIndex: 433,
    settings: { acmgWeighting: {}, energyUnit: "kcal/mol" },
    ...overrides
  };

  return render(
    <SettingsProvider>
      <ClinicalInsightsCard {...(props as any)} />
    </SettingsProvider>
  );
}

// The residue-property radar and the biochemical-shift prose were removed from this tab: both repeat the
// Residue Shifts tab, which keeps its own axis-definition and fallback tests (residueShift*.test.*). The
// Insights tab consolidates the evidence tabs and does not restate them.

describe("ClinicalInsightsCard structured-report banner", () => {
  /**
   * `insights` is absent for the whole of a synthesis, so the banner's old `!insights` condition
   * announced "could not be parsed or generated" while the model was still working. Observed
   * live on a fresh variant (CNOT1 p.Phe876Leu): the banner rendered directly beneath a moving
   * "ANALYZING BIOPHYSICAL PROPERTIES" bar and beside "Narrative: Synthesizing…", so a reader
   * was told a run had failed while it was still running.
   */
  const withoutInsights = (extra: Record<string, unknown> = {}) =>
    baseResult({ insights: undefined, analysis: "Clinical summary from the run.", ...extra });

  it("stays silent while the narrative stage is still synthesizing", () => {
    renderCard(withoutInsights(), { isNarrativeLoading: true });
    expect(screen.queryByText(/No structured interpretation came back/)).not.toBeInTheDocument();
  });

  it("stays silent while the wider run is still streaming evidence", () => {
    renderCard(withoutInsights(), {
      analysisState: { result: withoutInsights(), isLoading: true, error: null },
      isNarrativeLoading: false,
    });
    expect(screen.queryByText(/No structured interpretation came back/)).not.toBeInTheDocument();
  });

  it("reports the omission once the run has finished, and does not claim a narrative that is absent", () => {
    renderCard(withoutInsights(), { isNarrativeLoading: false });
    expect(screen.getByText(/No structured interpretation came back/)).toBeInTheDocument();
    expect(screen.getByText(/returned the clinical narrative only/)).toBeInTheDocument();

    // No narrative either: the old copy would have promised "only the raw clinical narrative is
    // available" while there was none to read.
    renderCard(withoutInsights({ analysis: "" }), { isNarrativeLoading: false });
    expect(screen.getByText(/neither a structured interpretation nor a narrative/)).toBeInTheDocument();
  });
});

describe("ClinicalInsightsCard export handlers", () => {
  /**
   * F11. The whole export-verdict fix rests on this component CALLING `buildExportVerdictContext`, and
   * nothing tested that it does. Rewriting the call site as an inline lookup of the stored verdict — the
   * exact class the fix closed — passed the entire suite.
   *
   * So this drives the real button, captures the Blob the handler builds, and reads the manifest back
   * out of it. The fixture makes the two sources DISAGREE, which is the only way the test can tell which
   * one was read: the stored snapshot says low risk, the six engines say otherwise.
   */
  it("writes the DERIVED verdict into the provenance manifest, not the stored snapshot", async () => {
    const stale = "Low Misfolding Risk (Neutral Stability)";
    const blobs: Blob[] = [];
    const originalCreate = (URL as any).createObjectURL;
    (URL as any).createObjectURL = (b: Blob) => {
      blobs.push(b);
      return "blob:mock";
    };

    try {
      renderCard(baseResult(), {
        foldingEnergetics: {
          foldx: 3.0,
          dynamut2: -1.5,
          ddmut: -1.2,
          rasp: 1.5,
          thermompnn: 1.1,
          stabilityoracle: 1.3,
          consensusVerdict: stale
        }
      });

      fireEvent.click(screen.getByRole("button", { name: /Provenance Manifest/i }));

      expect(blobs, "the handler must have produced a download").toHaveLength(1);
      const manifest = JSON.parse(await blobs[0].text());

      expect(manifest.verdictSummary.stabilityVerdict, "a verdict must be present").toBeTruthy();
      expect(
        manifest.verdictSummary.stabilityVerdict,
        "the export carried the stored snapshot that the engines on screen contradict"
      ).not.toBe(stale);
    } finally {
      (URL as any).createObjectURL = originalCreate;
    }
  });

  it("exports the derived agreement and one sign convention, never the stored probability", async () => {
    /**
     * F10-1 from the fourth review panel was an export whose probability and interval disagreed, because
     * one was derived and the other read from the stored snapshot. The probability itself came from
     * hand-typed curves and is retired (`thresholds/consensus.ts`); the invariant that survives is that
     * the export DERIVES from the engines and never forwards the stale snapshot below.
     */
    const blobs: Blob[] = [];
    const originalCreate = (URL as any).createObjectURL;
    (URL as any).createObjectURL = (b: Blob) => {
      blobs.push(b);
      return "blob:mock";
    };

    try {
      renderCard(baseResult(), {
        foldingEnergetics: {
          foldx: 3.0,
          dynamut2: -1.5,
          ddmut: -1.2,
          rasp: 1.5,
          thermompnn: 1.1,
          stabilityoracle: 1.3,
          // A stale snapshot from before the probability was retired.
          consensusProbability: 0.11,
          consensusConfMin: 0.021,
          consensusConfMax: 0.113,
        },
      });

      fireEvent.click(screen.getByRole("button", { name: /Export JSON/i }));

      expect(blobs, "the handler must have produced a download").toHaveLength(1);
      const json = JSON.parse(await blobs[0].text());
      const consensus = json.biophysicalEnergetics;

      expect(consensus).not.toHaveProperty("consensusProbability");
      expect(consensus).not.toHaveProperty("consensusConfMin");
      expect(consensus.consensusStabilityVerdict).toBe("Destabilizing (Engines Agree)");
      expect(consensus.consensusEnginesCounted).toBe(6);
      expect(consensus.consensusEnginesDestabilizing).toBe(6);
      expect(consensus.consensusMedianDdg).toBeCloseTo(1.4, 5);
      // Raw provider values are kept for existing readers; the canonical block is what compares.
      expect(consensus.dynamut2).toBe(-1.5);
      expect(consensus.canonicalDdg.dynamut2).toBe(1.5);
      expect(consensus.canonicalDdg.ddmut).toBe(1.2);
    } finally {
      (URL as any).createObjectURL = originalCreate;
    }
  });
});

describe("ClinicalInsightsCard consolidated case", () => {
  const withCriteria = () =>
    baseResult({
      ruleBasedInsights: {
        plausibility: "",
        acmgVerdict: "Variant of Uncertain Significance (VUS)",
        acmgCriteria: [{ code: "PP3", reason: "3/6 predictors agree" }],
        partialEvidence: { available: [], unavailable: [] },
      },
      insights: {
        biochemicalShift: "",
        structuralImpact: "",
        acmgVerdict: "Variant of Uncertain Significance (VUS)",
        acmgCriteria: [
          { code: "PP3", reason: "3/6 predictors agree", source: "database_verified" },
          { code: "PM2", reason: "counts not provided in the prompt", source: "ai_suggested" },
        ],
      },
    });

  it("leads with the engine's classification and lists only its codes as counted", () => {
    renderCard(withCriteria());
    expect(screen.getByText("Rule-engine classification")).toBeInTheDocument();
    expect(screen.getByText(/The engine counted 1 criterion: PP3\./)).toBeInTheDocument();
    expect(screen.getByText(/Uncertain/, { selector: ".ins-tier" })).toBeInTheDocument();
  });

  it("does not present the model's PM2 as evidence beside an engine that did not record it", () => {
    renderCard(withCriteria());
    expect(screen.getByText(/The model proposed PM2, and it is left out/)).toBeInTheDocument();
    expect(screen.queryByText("Criteria met: PP3, PM2")).not.toBeInTheDocument();
  });

  it("gives every evidence area a row on the board", () => {
    renderCard(withCriteria());
    for (const name of ["Computational", "Population", "Splicing", "Protein function", "Stability", "Assembly", "Sequence models"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('retains evidence during a streaming analysis rather than replacing it with the initial loader', () => {
    renderCard(withCriteria(), { analysisState: { result: withCriteria(), isLoading: true, error: null } });
    expect(screen.getByRole('status')).toHaveTextContent('Evidence is still arriving');
    expect(screen.getByRole('button', { name: 'Computational' })).toBeInTheDocument();
  });

  it('shows the actual analysis error instead of assuming API configuration is missing', () => {
    renderCard(null, { analysisState: { result: null, isLoading: false, error: 'Provider connection timed out.' } });
    expect(screen.getByText('Provider connection timed out.')).toBeInTheDocument();
    expect(screen.queryByText('Variant Interpretation Awaiting Configuration')).not.toBeInTheDocument();
  });
});

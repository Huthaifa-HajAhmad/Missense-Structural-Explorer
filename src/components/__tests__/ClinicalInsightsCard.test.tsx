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

describe("ClinicalInsightsCard residue property radar", () => {
  it("labels the axes with the shared definitions rather than its own names", () => {
    renderCard(baseResult());

    // Source lines come straight from PROPERTY_SCALE_DEFINITIONS, so the axis
    // names here cannot drift from the Residue Shifts tab again.
    expect(screen.getByText(/Hydrophobicity: Kyte & Doolittle/)).toBeInTheDocument();
    expect(screen.getByText(/Size: Side-chain van der Waals volume/)).toBeInTheDocument();
    expect(screen.getByText(/Polarity: Standard biochemical polarity/)).toBeInTheDocument();
    expect(screen.getByText(/Charge: Hand-normalised charge index/)).toBeInTheDocument();

    // The names this chart used to invent must be gone.
    expect(screen.queryByText(/Molecular Size/)).not.toBeInTheDocument();
  });

  it("names both residues from the resolved pair", () => {
    renderCard(baseResult());
    expect(screen.getByText("Wild-Type (Glu)")).toBeInTheDocument();
    expect(screen.getByText("Mutant (Lys)")).toBeInTheDocument();
  });

  it("explains that the charge axis is signed on a radial scale", () => {
    // On a radar, radius 0 is the origin, so Asp/Glu (charge 0) plot at the centre
    // and read as "no charge" unless the signed axis is spelled out.
    renderCard(baseResult());
    expect(screen.getByText(/0 = negative, 50 = neutral and 100 = positive/)).toBeInTheDocument();
  });

  it("reports missing data instead of plotting a defaulted profile", () => {
    // Genomic notation the string parser rejects, with no metadata residues.
    renderCard(
      baseResult({
        metadata: { gene: "MACO1", variant: "chr1:25484258:G:A", wildType: "", mutant: "" }
      })
    );

    expect(screen.getByText(/Residue property comparison is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Wild-Type \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hydrophobicity: Kyte & Doolittle/)).not.toBeInTheDocument();
  });

  it("resolves from metadata even when the variant string cannot be parsed", () => {
    // The real defect the shared resolver fixed: a blank radar for input the
    // string parser rejects, despite usable metadata residues.
    renderCard(
      baseResult({
        metadata: {
          gene: "MACO1",
          variant: "chr1:25484258:G:A",
          wildType: "Glu",
          mutant: "Lys",
          residueIndex: 433
        }
      })
    );

    expect(screen.getByText("Wild-Type (Glu)")).toBeInTheDocument();
    expect(screen.queryByText(/Residue property comparison is unavailable/)).not.toBeInTheDocument();
  });
});

describe("ClinicalInsightsCard biochemical narrative", () => {
  it("renders real prose verbatim", () => {
    renderCard(baseResult());
    expect(screen.getByText(/Charge swap: Negative \(Glu\) to Positive \(Lys\)/)).toBeInTheDocument();
  });

  it("classifies the pipeline fallback as a state rather than printing its markdown", () => {
    renderCard(
      baseResult({
        insights: {
          biochemicalShift: "\u26a0\ufe0f **Biochemical Shift Unavailable** (Failed)",
          structuralImpact: "",
          acmgCriteria: []
        }
      })
    );

    expect(screen.getByText(/Biochemical Shift Unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    // The degraded state is labelled, and the derived scales still render.
    expect(screen.getByText(/State: Rule-based only/)).toBeInTheDocument();
    expect(screen.getByText(/Hydrophobicity: Kyte & Doolittle/)).toBeInTheDocument();
  });
});

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
    expect(screen.queryByText(/Structured Report Unavailable/)).not.toBeInTheDocument();
  });

  it("stays silent while the wider run is still streaming evidence", () => {
    renderCard(withoutInsights(), {
      analysisState: { result: withoutInsights(), isLoading: true, error: null },
      isNarrativeLoading: false,
    });
    expect(screen.queryByText(/Structured Report Unavailable/)).not.toBeInTheDocument();
  });

  it("reports the omission once the run has finished, and does not claim a narrative that is absent", () => {
    renderCard(withoutInsights(), { isNarrativeLoading: false });
    expect(screen.getByText(/Structured Report Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/returned the clinical narrative but no structured interpretation/)).toBeInTheDocument();

    // No narrative either: the old copy would have promised "only the raw clinical narrative is
    // available" while there was none to read.
    renderCard(withoutInsights({ analysis: "" }), { isNarrativeLoading: false });
    expect(screen.getByText(/neither a structured interpretation nor a clinical narrative/)).toBeInTheDocument();
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

  it("does not export an interval that contradicts its own probability", async () => {
    /**
     * F10-1 from the fourth review panel. The JSON export derived its probability but read the interval
     * bounds from the STORED snapshot, so a report could carry a point estimate OUTSIDE its own interval
     * — measured as 80.6% with 68.1-89.1 on screen against 80.6% with 2.1-11.3 exported. The stored
     * snapshot below deliberately disagrees with what the engines derive, which is how that arose.
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
          // A stale snapshot from an earlier, two-engine commit.
          consensusProbability: 0.11,
          consensusConfMin: 0.021,
          consensusConfMax: 0.113,
        },
      });

      fireEvent.click(screen.getByRole("button", { name: /Export JSON/i }));

      expect(blobs, "the handler must have produced a download").toHaveLength(1);
      const json = JSON.parse(await blobs[0].text());
      const consensus = json.biophysicalEnergetics;

      expect(typeof consensus.consensusProbability).toBe("number");
      expect(consensus.consensusProbability, "the stored probability was exported").not.toBeCloseTo(
        0.11,
        5
      );

      // Assert the TYPES before the ordering: `null <= 0.8` coerces to true, so the bounds checks below
      // would pass vacuously against a null interval.
      expect(typeof consensus.consensusConfMin).toBe("number");
      expect(typeof consensus.consensusConfMax).toBe("number");
      expect(consensus.consensusConfMin).toBeLessThanOrEqual(consensus.consensusProbability);
      expect(consensus.consensusConfMax).toBeGreaterThanOrEqual(consensus.consensusProbability);
      expect(consensus.consensusConfMin, "the bounds stayed at the stored snapshot").not.toBeCloseTo(
        0.021,
        5
      );
    } finally {
      (URL as any).createObjectURL = originalCreate;
    }
  });
});

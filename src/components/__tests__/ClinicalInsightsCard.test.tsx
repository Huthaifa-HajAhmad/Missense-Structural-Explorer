// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
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

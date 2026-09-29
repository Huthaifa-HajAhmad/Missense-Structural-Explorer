// @vitest-environment jsdom
/**
 * AlphaGenomeRail — the inspector shows how the rank was obtained, and never an evidence band.
 */
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return { ...actual, useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }) };
});
vi.mock("../../../apiClient", () => ({ useApiClient: () => ({ fetchWithAuth: vi.fn() }) }));

import { AlphaGenomeRail } from "../AlphaGenomeRail";
import { EvidenceInspector } from "../EvidenceInspector";

const result: any = {
  metadata: { gene: "GZF1", variant: "p.Arg591Trp" },
  predictorData: { gnomadVariantId: "20-23369727-C-T", gnomadVariantAssembly: "GRCh38" },
  conservationData: {
    alphagenome: {
      status: "live",
      aviPhred: 26.4,
      aviRaw: 1.21,
      aviQuantile: 0.99771,
      topPercentile: 0.229,
      acmgStrength: "PP3_Moderate",
      atlasUrl: "https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=chr20:23369727:C%3ET",
      featureAttributions: { AlphaMissense: 0.686, Splicing: 0.083 },
    },
  },
};

describe("AlphaGenomeRail", () => {
  it("shows the Phred arithmetic from the payload's own quantile", () => {
    render(<AlphaGenomeRail analysisResult={result} />);
    const trace = screen.getByTestId("avi-trace");
    expect(within(trace).getByText("chr20:23369727 C>T")).toBeInTheDocument();
    expect(within(trace).getByText("−10 · log10(1 − 0.99771) = 26.4")).toBeInTheDocument();
  });

  it("marks the rank row the variant falls in, and lists no PP3/BP4 bands", () => {
    render(<AlphaGenomeRail analysisResult={result} />);
    const rows = screen.getByTestId("avi-phred-rows");
    expect(within(rows).getByText(/this variant \(26\.4\)/).closest("li")).toHaveTextContent("Phred ≥ 20");
    expect(screen.queryByText(/PP3-moderate|BP4-supporting|PP3_/i)).not.toBeInTheDocument();
  });

  it("names the conservation scores it shares with Predictors as the same kind, not the same scores", () => {
    render(<AlphaGenomeRail analysisResult={result} />);
    // Predictors reads phyloP and GERP; the AVI's inputs are Cactus 241-way and PhastCons 470-way.
    expect(screen.queryByText(/both already read on the Predictors tab/)).not.toBeInTheDocument();
    expect(screen.getByText(/measure the same thing as phyloP and GERP/)).toBeInTheDocument();
  });

  it("replaces the placeholder telemetry box on the AlphaGenome tab", () => {
    render(<EvidenceInspector analysisResult={result} activeEvidenceTab="alphagenome" />);
    expect(screen.getByTestId("alphagenome-rail")).toBeInTheDocument();
    expect(screen.queryByText(/placeholder, not a measurement/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Track reference schema/)).not.toBeInTheDocument();
  });
});

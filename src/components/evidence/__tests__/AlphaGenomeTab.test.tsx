// @vitest-environment jsdom
/**
 * AlphaGenomeTab.test.tsx — what the AlphaGenome panel is allowed to say.
 *
 * Two families of claim are pinned here, both written against the rendered DOM:
 *   1. absence — a missing score is explained by the shared resolver, never re-derived here (the
 *      "Awaiting API key" defect, doc/ALPHAGENOME_STANDBY_RCA_AND_UI_AUDIT.md §1);
 *   2. integrity — the AVI is shown as a rank with its composition, never as an ACMG strength, a
 *      probability, or next to invented reference magnitudes (doc/ALPHAGENOME_TAB_REVIEW.md).
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const REFUSAL =
  "alphagenome covers GRCh38 / hg38; this coordinate is GRCh37 / hg19 and was not scored.";

vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      // No browser-side key: `configured` is then `undefined` (unknown), never a definite false.
      settings: { alphagenomeApiKey: "", alphagenomeApiUrl: "" },
      openSettingsTab: vi.fn(),
    }),
  };
});

vi.mock("../../../apiClient", () => ({
  useApiClient: () => ({ fetchWithAuth: vi.fn() }),
}));

import { AlphaGenomeTab } from "../AlphaGenomeTab";

const GZF1_ATLAS = "https://deepmind.google.com/science/alphagenome/atlas/track-predictions?v=chr20:23369727:C%3ET";

function renderTab(options: {
  alphagenome?: Record<string, unknown> | null;
  refusals?: Array<{ source: string; reason: string }> | null;
  predictorData?: Record<string, unknown>;
}) {
  const result = {
    metadata: { gene: "ACOT9", variant: "p.Lys272Asn", uniprotId: "Q9Y305" },
    predictorData: options.predictorData ?? { gnomadVariantId: "X-23723975-C-A", gnomadVariantAssembly: "GRCh37" },
    conservationData: {
      alphagenome: options.alphagenome ?? null,
      assemblyRefusals: options.refusals ?? null,
    },
  };
  return render(<AlphaGenomeTab {...({ analysisState: { result } } as any)} />);
}

/** The GZF1 p.Arg591Trp payload from the review screenshots. */
const GZF1 = {
  status: "live",
  aviPhred: 26.4,
  aviRaw: 1.21,
  aviQuantile: 0.99771,
  topPercentile: 0.229,
  acmgStrength: "PP3_Moderate",
  atlasUrl: GZF1_ATLAS,
  featureAttributions: {
    Splicing: 0.083,
    AlphaMissense: 0.686,
    "RNA-seq": 0.002,
    "ATAC-seq": 0.002,
    "DNASE-seq": 0.005,
    "ChIP-TF": 0,
  },
};

describe("a build refusal is stated as a coverage decision, never as a credential problem", () => {
  it("renders the canonical label and the server's own reason", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    expect(screen.getByTestId("avi-status")).toHaveTextContent("Not covered");
    expect(screen.getAllByText(/AlphaGenome Atlas covers GRCh38 \/ hg38/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^alphagenome covers/)).not.toBeInTheDocument();
  });

  it("never blames the API key", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    expect(screen.queryByText(/Awaiting API key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Add or check the AlphaGenome credential/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Standby/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connection settings/i })).not.toBeInTheDocument();
  });

  it("says plainly that no setting changes a coverage decision", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    expect(screen.getByText(/No setting changes this\./)).toBeInTheDocument();
  });
});

describe("an actionable absence offers the remedy that can actually fix it", () => {
  it("sends a rejected credential to Settings", () => {
    renderTab({ alphagenome: { status: "unavailable", aviPhred: null, message: "AlphaGenome API Key is invalid or expired." } });
    expect(screen.getByTestId("avi-status")).toHaveTextContent("Not available here");
    expect(screen.getByText(/Add or check the AlphaGenome credential in Settings/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open connection settings/ })).toBeInTheDocument();
    expect(screen.queryByText(/Re-evaluate the variant to ask the Atlas again/)).not.toBeInTheDocument();
  });

  it("offers a retry for a provider fault, and not a credential action", () => {
    renderTab({ alphagenome: { status: "unavailable", aviPhred: null, message: "AlphaGenome Atlas query timed out." } });
    expect(screen.getByTestId("avi-status")).toHaveTextContent("Provider error");
    expect(screen.getByText(/Re-evaluate the variant to ask the Atlas again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-evaluate/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connection settings/i })).not.toBeInTheDocument();
  });

  it("does not assert a third-party fault from a bare status with no message", () => {
    renderTab({ alphagenome: { status: "unavailable", aviPhred: null } });
    expect(screen.queryByText("Provider error")).not.toBeInTheDocument();
    expect(screen.getByTestId("avi-status")).toHaveTextContent("No result");
  });

  it("shows no score sections when there is no score", () => {
    renderTab({ alphagenome: { status: "unavailable", aviPhred: null } });
    expect(screen.queryByTestId("avi-rank-ruler")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avi-contributions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avi-facts")).not.toBeInTheDocument();
  });
});

describe("the score is a rank, never an ACMG strength", () => {
  it("does not render the payload's app-defined PP3/BP4 banding, or odds, or a ClinGen claim", () => {
    renderTab({ alphagenome: GZF1, predictorData: { gnomadVariantId: "20-23369727-C-T", gnomadVariantAssembly: "GRCh38" } });
    // The caveat may SAY "not counted toward PP3/BP4"; no strength may be assigned.
    expect(screen.queryByText(/PP3_|BP4_|PP3 \(|Moderate Pathogenic|PP3-(supporting|moderate|strong)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/4\.33|Odds of Pathogenicity/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ClinGen SVI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Calibrated AVI/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/P_benign|\/ 50\.0/)).not.toBeInTheDocument();
  });

  it("states the rank against all possible SNVs, with the canonical positive state", () => {
    renderTab({ alphagenome: GZF1 });
    expect(screen.getByTestId("avi-status")).toHaveTextContent("Computed");
    expect(screen.getByTestId("avi-headline")).toHaveTextContent("Top 0.23%");
    expect(screen.getByText(/of all ~9 billion possible hg38 SNVs/)).toBeInTheDocument();
    expect(screen.getByText(/about 1 in 437/)).toBeInTheDocument();
    expect(screen.getByTestId("avi-caveat")).toHaveTextContent(/not a probability of pathogenicity/);
  });

  it("treats a measured quantile of 0 as a value, not as missing", () => {
    renderTab({ alphagenome: { status: "live", aviPhred: 22.5, aviQuantile: 0, featureAttributions: { Splicing: 0 } } });
    expect(screen.getByText("0.00000")).toBeInTheDocument();
  });

  it("carries no invented reference magnitudes", () => {
    renderTab({ alphagenome: GZF1 });
    expect(screen.queryByText(/illustrative/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HepG2|ChIP Peak Disruption/)).not.toBeInTheDocument();
  });
});

describe("what the score is made of", () => {
  it("reports shares of the summed |contribution|, not SHAP × 100", () => {
    renderTab({ alphagenome: GZF1 });
    const am = screen.getByTestId("avi-feature-ALPHAMISSENSE");
    expect(within(am).getByText("+0.686")).toBeInTheDocument();
    // 0.686 / 0.778 = 88%
    expect(within(am).getByText("88%")).toBeInTheDocument();
    expect(screen.queryByText(/Rel$/)).not.toBeInTheDocument();
  });

  it("names AlphaMissense as a separate predictor, not as protein structure", () => {
    renderTab({ alphagenome: GZF1 });
    expect(screen.queryByText(/steric|hydrophobic packing|AlphaFold Structural/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("avi-composition")).toHaveTextContent(/AlphaMissense \(\+0\.686\), which the Predictors tab already counts/);
  });

  it("says a conservation-dominated score names no molecular route", () => {
    renderTab({ alphagenome: { status: "live", aviPhred: 22.7, featureAttributions: { AlphaMissense: 0.076, Splicing: 0.008, Cactus: 0.531 } } });
    expect(screen.getByTestId("avi-composition")).toHaveTextContent(/Most of the score \(86%\) comes from conservation/);
    expect(screen.getByTestId("avi-composition")).toHaveTextContent(/does not name a molecular route/);
  });

  it("folds contributions under 2% behind a row that says how many it holds", () => {
    renderTab({ alphagenome: GZF1 });
    expect(screen.getByTestId("avi-feature-MERGED_SPLICING")).toBeInTheDocument();
    expect(screen.queryByTestId("avi-feature-MAX_ABS_CHIP_TF")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /9 more — each under 2% of the total, 5 not attributed/ })).toBeInTheDocument();
  });

  it("keeps absent and zero apart: an unattributed feature is a dash, a measured 0 is 0", () => {
    renderTab({ alphagenome: GZF1 });
    for (const b of screen.getAllByRole("button", { name: /more — each under/ })) fireEvent.click(b);
    expect(within(screen.getByTestId("avi-feature-MAX_ABS_CHIP_TF")).getByText("+0.000")).toBeInTheDocument();
    expect(within(screen.getByTestId("avi-feature-CACTUS_241_WAY")).getByText("Not attributed")).toBeInTheDocument();
  });

  it("does not elect a feature from an all-zero vector", () => {
    renderTab({ alphagenome: { status: "live", aviPhred: 22.7, featureAttributions: { Splicing: 0, AlphaMissense: 0 } } });
    expect(screen.getByTestId("avi-composition")).toHaveTextContent(/every attribution is zero/);
  });

  it("explains a live score that arrived without attributions", () => {
    renderTab({ alphagenome: { status: "live", aviPhred: 22.5, featureAttributions: null } });
    expect(screen.getByTestId("avi-no-attribution")).toBeInTheDocument();
    expect(screen.queryByTestId("avi-contributions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avi-composition")).not.toBeInTheDocument();
  });
});

describe("Atlas links point at the locus that was scored", () => {
  it("uses the coordinate the Atlas was actually queried with", () => {
    renderTab({ alphagenome: GZF1 });
    const atlas = screen.getByTestId("avi-atlas");
    expect(within(atlas).getByText("chr20:23369727 C>T")).toBeInTheDocument();
    expect(within(atlas).getByRole("link", { name: /Variant page/ })).toHaveAttribute(
      "href",
      "https://deepmind.google.com/science/alphagenome/atlas/variant/chr20:23369727:C%3ET",
    );
  });

  it("never deep-links a GRCh37 position into the GRCh38 Atlas", () => {
    renderTab({ refusals: [{ source: "alphagenome", reason: REFUSAL }] });
    const atlas = screen.getByTestId("avi-atlas");
    expect(within(atlas).queryByText(/23723975/)).not.toBeInTheDocument();
    expect(within(atlas).getByRole("link", { name: /Search the Atlas for ACOT9/ })).toBeInTheDocument();
  });
});

describe("the wrapper's guard", () => {
  it("renders nothing without a result, and without tripping the hooks order", () => {
    const { container } = render(<AlphaGenomeTab {...({ analysisState: { result: null } } as any)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

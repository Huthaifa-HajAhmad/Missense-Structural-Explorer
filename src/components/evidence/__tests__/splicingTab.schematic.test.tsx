// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: { alphagenomeApiKey: "", alphagenomeApiUrl: "" },
      openSettingsTab: vi.fn(),
    }),
  };
});

import { SplicingTab } from "../SplicingTab";

function createMockAnalysisResult(overrides: Record<string, unknown> = {}) {
  return {
    metadata: {
      gene: "CNNM2",
      variant: "p.Ser489Cys",
      wildType: "Ser",
      mutant: "Cys",
      residueIndex: 489,
    },
    conservationData: {
      spliceProximity: {
        distance: 155,
        nearest_junction: "donor",
        region_type: "exonic",
        exon_number: 1,
        total_exons: 8,
        strand: -1,
        exon_length: 1888,
        transcript_id: "NM_017649.5",
      },
      spliceai: {
        ds_ag: 0.0,
        ds_al: 0.0,
        ds_dg: 0.0,
        ds_dl: 0.004,
        max_ds: 0.004,
      },
      dbscsnv: {
        ada_score: null,
        rf_score: null,
      },
    },
    ...overrides,
  } as any;
}

describe("SplicingTab Schematic Off-Scale Presentation", () => {
  it("renders off-scale chip label and does not render redundant scale break slashes inside exon", () => {
    const result = createMockAnalysisResult();
    render(
      <SplicingTab
        {...({
          analysisState: { result, isLoading: false, error: null },
          isBiophysicalLoading: false,
          foldingDdG: null,
          onTabChange: vi.fn(),
        } as any)}
      />
    );

    // Verify the off-scale chip is rendered with explicit >60 bp scale notation
    expect(screen.getByText("155 bp (>60 bp scale)")).toBeInTheDocument();

    // Verify no redundant scale break symbol group is rendered
    expect(screen.queryByLabelText("Scale break symbol")).toBeNull();
  });
});

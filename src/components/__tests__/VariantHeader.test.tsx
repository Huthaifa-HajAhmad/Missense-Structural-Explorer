// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import VariantHeader from "../VariantHeader";
import { AnalysisResult } from "../../types";

describe("VariantHeader Component Tests", () => {
  const mockAnalysisResult: Partial<AnalysisResult> = {
    transcriptId: "ENST00000288602.11",
    isManeSelect: true,
    predictorData: {
      gnomadVariantId: "7-140753336-A-T",
    } as any,
    gnomadConstraint: {
      missense_z: 2.04,
      oe_mis: 0.72,
      pli: 0.99,
      loeuf: 0.71,
      isPP2Constrained: true,
      hasRegionalData: true,
      regionalConstraint: {
        isConstrained: true,
        oeRatio: 0.85,
        pValue: 0.002,
        regionText: "460-600",
      },
    },
    conservationData: {
      spliceProximity: {
        isNearSpliceSite: true,
        distance: 4,
      },
      alphagenome: {
        aviPhred: 32.4,
        acmgStrength: "PP3_Strong",
        topModality: "Splice",
      },
    } as any,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should render gene and formatted variant", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(screen.getByText("BRAF")).toBeInTheDocument();
    expect(screen.getByText("p.Val600Glu")).toBeInTheDocument();
  });

  it("should render lineage and identifier pills (Transcript, GRCh38, UniProt)", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(screen.getByText("ENST00000288602.11")).toBeInTheDocument();
    expect(screen.getByText("MANE Select")).toBeInTheDocument();
    expect(screen.getByText("7-140753336-A-T")).toBeInTheDocument();
    expect(screen.getByText("P15056")).toBeInTheDocument();

    // Verify external link attribute with encoded URI and rel
    const link = screen.getByLabelText("Open UniProt entry for P15056");
    expect(link).toHaveAttribute("href", "https://www.uniprot.org/uniprotkb/P15056/entry");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("should NOT render AlphaGenome AVI badge in header (removed per specification)", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // AlphaGenome AVI was 32.4 in mock data — must not be in document
    expect(screen.queryByText("32.4")).not.toBeInTheDocument();
    expect(screen.queryByText("AVI")).not.toBeInTheDocument();
  });

  it("should render splice junction proximity alert when adjacent to splice site", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(screen.getByText("Splice Alert")).toBeInTheDocument();
    expect(screen.getByText("4 bp adjacent")).toBeInTheDocument();
  });

  it("should NOT render splice junction proximity alert when not near splice site", () => {
    const noSpliceResult: Partial<AnalysisResult> = {
      ...mockAnalysisResult,
      conservationData: {
        spliceProximity: {
          isNearSpliceSite: false,
          distance: 50,
        },
      } as any,
    };

    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={noSpliceResult as AnalysisResult}
      />
    );

    expect(screen.queryByText("Splice Alert")).not.toBeInTheDocument();
  });

  it("should render Cluster B constraint cards with clearly articulated metric names, current scores, and normal ranges", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // Explicit Metric Names
    expect(screen.getByText("Missense Z score")).toBeInTheDocument();
    expect(screen.getByText("Loss-of-function (LOEUF)")).toBeInTheDocument();
    expect(screen.getByText("Regional Missense Constraint (RMC)")).toBeInTheDocument();

    // Scores
    expect(screen.getByText("+2.04")).toBeInTheDocument();
    expect(screen.getByText("0.71")).toBeInTheDocument();
    expect(screen.getByText("O/E 0.85")).toBeInTheDocument();

    // Normal Ranges
    expect(screen.getByText(/< 2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/≥ 1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Unconstrained \(O\/E ~ 1\.0\)/)).toBeInTheDocument();

    // Status Tags
    expect(screen.getByText("Constrained")).toBeInTheDocument();
    expect(screen.getByText("Moderate Constraint")).toBeInTheDocument();
    expect(screen.getByText("Subgenic Constrained")).toBeInTheDocument();
  });

  it("should handle severe Missense Z, strong LoF intolerance, and unconstrained RMC", () => {
    const extremeResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.5,
        oe_mis: 0.45,
        pli: 1.0,
        loeuf: 0.22,
        isPP2Constrained: true,
        hasRegionalData: true,
        regionalConstraint: {
          isConstrained: false,
          oeRatio: null,
          pValue: null,
          regionText: null,
        },
      },
    };

    render(
      <VariantHeader
        gene="TP53"
        variant="p.Arg175His"
        uniprotId="P04637"
        analysisResult={extremeResult as AnalysisResult}
      />
    );

    expect(screen.getByText("+3.50")).toBeInTheDocument();
    expect(screen.getByText("Severe Intolerance")).toBeInTheDocument();
    expect(screen.getByText("0.22")).toBeInTheDocument();
    expect(screen.getByText("Strong LoF Intolerance")).toBeInTheDocument();
    expect(screen.getByText("Expected Variation")).toBeInTheDocument();
  });

  it("should handle null and NaN constraint values gracefully", () => {
    const nanResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: NaN,
        oe_mis: null,
        pli: null,
        loeuf: NaN,
        isPP2Constrained: false,
        hasRegionalData: false,
        regionalConstraint: null,
      },
    };

    render(
      <VariantHeader
        gene="UNKNOWN"
        variant="p.Ala123Val"
        uniprotId="Q99999"
        analysisResult={nanResult as AnalysisResult}
      />
    );

    // Both NaN scores should report No Data and Unmeasured
    const noDataElements = screen.getAllByText("No Data");
    expect(noDataElements.length).toBeGreaterThanOrEqual(2);
    const unmeasuredElements = screen.getAllByText("Unmeasured");
    expect(unmeasuredElements.length).toBe(2);
    expect(screen.getByText("No gnomAD Blocks")).toBeInTheDocument();
  });

  it("should handle null analysisResult safely without crashing", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={null}
      />
    );

    expect(screen.getByText("BRAF")).toBeInTheDocument();
    expect(screen.getByText("p.Val600Glu")).toBeInTheDocument();
    expect(screen.getByText("P15056")).toBeInTheDocument();
    // Constraint cluster should not be rendered when gnomad is null
    expect(screen.queryByText("Missense Z score")).not.toBeInTheDocument();
  });

  it("should handle MANE+Clin and Canonical transcript tiers", () => {
    const maneClinResult: Partial<AnalysisResult> = {
      transcriptId: "NM_004333.6",
      isManePlusClinical: true,
    };

    const { rerender } = render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={maneClinResult as AnalysisResult}
      />
    );

    expect(screen.getByText("MANE+Clin")).toBeInTheDocument();

    const canonicalResult: Partial<AnalysisResult> = {
      transcriptId: "ENST00000496384.7",
      isCanonical: true,
    };

    rerender(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={canonicalResult as AnalysisResult}
      />
    );

    expect(screen.getByText("Ensembl Canonical")).toBeInTheDocument();
  });

  it("should handle copy to clipboard interaction and update screen reader feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    const copyBtn = screen.getByLabelText("Copy variant notation");
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith("p.Val600Glu");
    await waitFor(() => {
      expect(screen.getByLabelText("Copied variant notation to clipboard")).toBeInTheDocument();
    });
  });
});

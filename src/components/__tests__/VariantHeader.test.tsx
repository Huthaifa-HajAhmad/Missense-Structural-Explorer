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
        regionText: "460 to 600",
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

  it("should render lineage and identifier chips (Transcript, GRCh38, UniProt)", () => {
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
    // Assembly stays visible next to the coordinate, without a "GRCh38:" key label
    expect(screen.getByText("hg38")).toBeInTheDocument();

    // The keyword labels are now conveyed to assistive tech instead of printed
    expect(screen.getByText("Transcript")).toBeInTheDocument();
    expect(screen.getByText("GRCh38 coordinates")).toBeInTheDocument();
    expect(screen.getByText("UniProt accession")).toBeInTheDocument();

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

  it("should render the splice junction proximity alert when adjacent to a splice site", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    const alert = screen.getByTitle(/Splice alert/);
    expect(alert).toHaveClass("vh-chip--alert");
    expect(alert).toHaveTextContent("4 bp");
    expect(alert).toHaveTextContent("Splice site");
    expect(
      screen.getByText("Splice alert: variant is 4 bp from the nearest exon–intron boundary.")
    ).toBeInTheDocument();
  });

  it("should NOT render the splice junction alert when not near a splice site", () => {
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

    expect(screen.queryByTitle(/Splice alert/)).not.toBeInTheDocument();
  });

  it("should render the gnomAD v2 constraint rail with compact labels, values and verdicts", () => {
    const { container } = render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // Source attribution survives as a rail label rather than a full sentence
    expect(screen.getByText("gnomAD v2")).toBeInTheDocument();
    expect(screen.getByText("Gene constraint")).toBeInTheDocument();

    // Compact metric labels — the full names live in the tooltip/sr-only copy
    expect(screen.getByText("Missense Z")).toBeInTheDocument();
    expect(screen.getByText("LOEUF")).toBeInTheDocument();
    expect(screen.getByText("Regional O/E")).toBeInTheDocument();

    // Scores
    expect(screen.getByText("+2.04")).toBeInTheDocument();
    expect(screen.getByText("0.71")).toBeInTheDocument();
    expect(screen.getByText("0.85")).toBeInTheDocument();

    // Verdicts
    expect(screen.getByText("Constrained")).toBeInTheDocument();
    expect(screen.getByText("Moderate constraint")).toBeInTheDocument();
    expect(screen.getByText("Subgenic constrained")).toBeInTheDocument();

    // Reference ranges are rendered as threshold ticks on the tracks
    expect(screen.getByText("2.0")).toBeInTheDocument();
    expect(screen.getByText("3.09")).toBeInTheDocument();
    expect(screen.getByText("0.35")).toBeInTheDocument();
    expect(screen.getAllByText("1.0").length).toBe(2); // LOEUF tolerance + RMC baseline

    // Three threshold tracks, each with a marker for the observed value
    expect(container.querySelectorAll(".vh-scale").length).toBe(3);
    expect(container.querySelectorAll(".vh-marker").length).toBe(3);

    // Constraint bands encode the reference zones (3 for Z, 3 for LOEUF, none for RMC)
    expect(container.querySelectorAll(".vh-band").length).toBe(6);

    // RMC footnote keeps the constrained block and the p-value
    expect(screen.getByText("460–600 · p = 0.002")).toBeInTheDocument();
  });

  it("should expose the full metric sentences to assistive tech", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(
      screen.getByText(/gnomAD v2 Missense Z score \+2\.04: above the tolerant reference range/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/gnomAD v2 loss-of-function \(LOEUF\) 0\.71: below the tolerant reference range/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Constrained block 460 to 600, p-value 0\.002/)).toBeInTheDocument();
    expect(
      screen.getByTitle(/Regional Missense Constraint \(RMC\): Constrained block 460 to 600/)
    ).toBeInTheDocument();
  });

  it("should carry the full metric names and ClinGen thresholds in the tooltips", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(screen.getByTitle(/Missense Z score \+2\.04/)).toBeInTheDocument();
    expect(
      screen.getByTitle(/loss-of-function observed\/expected upper bound fraction \(LOEUF\) 0\.71/)
    ).toBeInTheDocument();
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
    expect(screen.getByText("Severe intolerance")).toBeInTheDocument();
    expect(screen.getByText("0.22")).toBeInTheDocument();
    expect(screen.getByText("Strong LoF intolerance")).toBeInTheDocument();
    expect(screen.getByText("Expected variation")).toBeInTheDocument();
    // No observed ratio reported, so the metric renders the empty value state
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("should collapse a tiny RMC p-value into scientific notation", () => {
    const tinyP: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.13,
        oe_mis: 0.26,
        pli: 0.98,
        loeuf: 0.26,
        isPP2Constrained: true,
        hasRegionalData: true,
        regionalConstraint: {
          isConstrained: true,
          oeRatio: 0.68,
          pValue: 6.648150909581207e-6,
          regionText: "Gln199 to Met555",
        },
      },
    };

    render(
      <VariantHeader
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={tinyP as AnalysisResult}
      />
    );

    expect(screen.getByText("Gln199–Met555 · p = 6.6×10⁻⁶")).toBeInTheDocument();
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

    const { container } = render(
      <VariantHeader
        gene="UNKNOWN"
        variant="p.Ala123Val"
        uniprotId="Q99999"
        analysisResult={nanResult as AnalysisResult}
      />
    );

    // Both NaN scores report "No data" with the empty-marker track state
    expect(screen.getAllByText("No data").length).toBe(2);
    expect(screen.getByText("No gnomAD blocks")).toBeInTheDocument();
    expect(container.querySelectorAll(".vh-marker").length).toBe(0);
    expect(container.querySelectorAll('.vh-scale[data-empty="true"]').length).toBe(3);
  });

  it("should handle a null analysisResult safely without crashing", () => {
    const { container } = render(
      <VariantHeader gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={null} />
    );

    expect(screen.getByText("BRAF")).toBeInTheDocument();
    expect(screen.getByText("p.Val600Glu")).toBeInTheDocument();
    expect(screen.getByText("P15056")).toBeInTheDocument();
    // The constraint rail should not be rendered when gnomad is null
    expect(screen.queryByText("Missense Z")).not.toBeInTheDocument();
    expect(container.querySelector(".vh-rail")).toBeNull();
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

// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import VariantHeader from "../VariantHeader";
import { AnalysisResult } from "../../types";

describe("VariantHeader Component Tests", () => {
  /**
   * The real case that prompted this: a coordinate resolves through the MANE transcript
   * (`NM_001037171.2:p.Lys281Asn`, isoform Q9Y305-4) and is modelled as `p.Lys272Asn` on canonical
   * Q9Y305. A clinician checking this header against their lab report must see THEIR notation first,
   * with the canonical basis stated beside it — showing only `p.Lys272Asn` made them re-map it by hand.
   */
  it("leads with the REPORTED (lab/MANE) notation and states the modelled basis", () => {
    const remapped = {
      metadata: { gene: "ACOT9", variant: "p.Lys272Asn", uniprotId: "Q9Y305" },
      numberingRemap: {
        reason: "MANE numbering remapped onto the canonical isoform",
        from: {
          hgvsp: "ENSP00000368605.5:p.Lys281Asn",
          transcriptId: "ENST00000379303",
          isoform: "Q9Y305-4",
          maneRefSeqId: "NM_001037171.2",
        },
      },
    } as unknown as AnalysisResult;

    render(<VariantHeader gene="ACOT9" variant="p.Lys272Asn" uniprotId="Q9Y305" analysisResult={remapped} />);

    expect(screen.getByText("p.Lys281Asn")).toBeTruthy();
    const basis = screen.getByTestId("modelled-basis");
    expect(basis.textContent).toContain("modelled as p.Lys272Asn");
    expect(basis.textContent).toContain("canonical Q9Y305");
    // The canonical notation is NOT the headline any more, and nothing claims a remap that did not happen.
    expect(screen.queryByText("p.Lys272Asn")).toBeNull();
  });

  it("shows the plain notation when nothing was remapped", () => {
    render(<VariantHeader gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={null} />);

    expect(screen.getByText("p.Val600Glu")).toBeTruthy();
    expect(screen.queryByTestId("modelled-basis")).toBeNull();
  });

  const mockAnalysisResult: Partial<AnalysisResult> = {
    transcriptId: "ENST00000288602.11",
    isManeSelect: true,
    predictorData: {
      gnomadVariantId: "7-140753336-A-T",
      gnomadVariantAssembly: "GRCh38",
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

    // Source attribution lives on the list's accessible label and the row
    // tooltips; there is no visible caption line above the rows.
    expect(screen.getByRole("list", { name: /gnomAD v2 population constraint/ })).toBeInTheDocument();
    expect(container.querySelector(".vh-rail-meta")).not.toBeInTheDocument();

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
    expect(screen.getByText("Not LoF constrained")).toBeInTheDocument(); // 0.71 ≥ 0.6, gnomAD's suggested cut
    expect(screen.getByText("Subgenic constrained")).toBeInTheDocument();

    // Reference ranges are rendered as threshold ticks on the tracks
    expect(screen.getByText("2.0")).toBeInTheDocument();
    expect(screen.getByText("3.09")).toBeInTheDocument();
    expect(screen.getByText("0.35")).toBeInTheDocument();
    expect(screen.getByText("0.6")).toBeInTheDocument(); // LOEUF constraint cut
    expect(screen.getByText("1.0")).toBeInTheDocument(); // RMC baseline

    // Three threshold tracks, each with a marker for the observed value
    expect(container.querySelectorAll(".vh-scale").length).toBe(3);
    expect(container.querySelectorAll(".vh-marker").length).toBe(3);

    // Constraint bands encode the reference zones (3 for Z, 3 for LOEUF, none for RMC)
    expect(container.querySelectorAll(".vh-band").length).toBe(6);

    // RMC block span and p-value are tooltip/sr-only provenance, not visible
    // text — a footnote would give the third row a second line and break the
    // row rhythm.
    const rmcRow = screen.getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain("Constrained block 460 to 600");
    expect(rmcRow!.getAttribute("title")).toContain("p = 0.002");
    expect(rmcRow!.textContent).toContain("RMC block 460 to 600");
    expect(screen.queryByText(/460–600/)).not.toBeInTheDocument();
  });

  it("should expose the reference ranges to assistive tech without restating the visible values", () => {
    render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // The reference sentence is the sr-only contract; the label, value and verdict are
    // already exposed as visible text, so repeating them here would double every row.
    expect(
      screen.getByText(/Reference: tolerant below 2\.0, constrained from 2\.0, severe intolerance at or above 3\.09/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Reference: strong loss-of-function intolerance below 0\.35, constrained below 0\.60/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Reference: unconstrained at O\/E ≈ 1\.0\./)).toBeInTheDocument();

    const srOnly = Array.from(document.querySelectorAll(".vh-sr-only")).map((el) => el.textContent ?? "");
    // The RMC row's detail leads with the constrained block (window provenance,
    // formerly the visible footnote), so match containment rather than a prefix.
    const detail = srOnly.filter((t) => t.includes("Reference:"));
    expect(detail).toHaveLength(3); // one per metric row
    // The metric value and verdict are NOT repeated inside the hidden detail.
    expect(detail.some((t) => t.includes("+2.04"))).toBe(false);
    expect(detail.some((t) => t.includes("Constrained"))).toBe(false);
    expect(detail.some((t) => t.includes("0.71"))).toBe(false);

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

    const rmcRow = screen.getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain("p = 6.6×10⁻⁶");
    expect(screen.queryByText(/Gln199–Met555/)).not.toBeInTheDocument();
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

  it("explains an absent regional call without claiming the gene has no blocks", () => {
    // Reachable state: the gene HAS RMC blocks (hasRegionalData true) but the variant
    // had no residue position, so the server returns regionalConstraint: null.
    const noPositionResult: Partial<AnalysisResult> = {
      transcriptId: "NM_018202.6",
      gnomadConstraint: {
        missense_z: 3.13,
        oe_mis: 0.26,
        pli: 0.98,
        loeuf: 0.26,
        isPP2Constrained: true,
        hasRegionalData: true,
        regionalConstraint: null,
      },
    };

    render(
      <VariantHeader
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={noPositionResult as AnalysisResult}
      />
    );

    expect(screen.getByText("No data")).toBeInTheDocument();
    // The gene must NOT be described as lacking blocks: only this residue was unresolved.
    expect(screen.queryByText(/no gnomAD constraint blocks/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No gnomAD blocks")).not.toBeInTheDocument();
    expect(screen.getByText(/No sub-regional call was returned for this residue/)).toBeInTheDocument();
    expect(screen.getByTitle(/no sub-regional call was returned for this residue/)).toBeInTheDocument();
  });

  it("still says a gene has no blocks when it genuinely has none", () => {
    const noBlocksResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 1.2,
        oe_mis: 1.1,
        pli: 0.1,
        loeuf: 1.1,
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
        analysisResult={noBlocksResult as AnalysisResult}
      />
    );

    expect(screen.getByText("No gnomAD blocks")).toBeInTheDocument();
    expect(screen.getByText(/The gene has no gnomAD constraint blocks/)).toBeInTheDocument();
  });

  it.each([
    [0.05, "p = 0.050"],
    [0.002, "p = 0.002"],
    [0.0015, "p = 0.0015"],
    [0.00149, "p = 0.0015"],
    [0.0009, "p = 9.0×10⁻⁴"],
    [9.96e-6, "p = 1.0×10⁻⁵"],
    [6.648150909581207e-6, "p = 6.6×10⁻⁶"],
    [1e-12, "p = 1.0×10⁻¹²"],
  ])("formats the RMC p-value %s canonically", (pValue, expected) => {
    const result: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.13,
        oe_mis: 0.26,
        pli: 0.98,
        loeuf: 0.26,
        isPP2Constrained: true,
        hasRegionalData: true,
        regionalConstraint: { isConstrained: true, oeRatio: 0.68, pValue, regionText: "Gln199 to Met555" },
      },
    };

    render(
      <VariantHeader
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={result as AnalysisResult}
      />
    );

    const rmcRow = screen.getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain(expected);
  });

  it.each([0, -1, NaN, Infinity])("omits the RMC p-value when it is %s", (pValue) => {
    const result: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.13,
        oe_mis: 0.26,
        pli: 0.98,
        loeuf: 0.26,
        isPP2Constrained: true,
        hasRegionalData: true,
        regionalConstraint: { isConstrained: true, oeRatio: 0.68, pValue, regionText: "Gln199 to Met555" },
      },
    };

    render(
      <VariantHeader
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={result as AnalysisResult}
      />
    );

    const rmcRow = screen.getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).not.toContain("p = ");
    expect(rmcRow!.getAttribute("title")).toContain("Constrained block Gln199 to Met555");
    expect(screen.queryByText(/p = /)).not.toBeInTheDocument();
  });

  it("labels a matched RMC window that did not reach significance as sub-threshold, not as expected variation", () => {
    const subThreshold: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.13,
        oe_mis: 0.26,
        pli: 0.98,
        loeuf: 0.26,
        isPP2Constrained: true,
        hasRegionalData: true,
        // The server gates isConstrained on the window's own p-value; this is
        // what a matched-but-insignificant window looks like on the wire.
        regionalConstraint: { isConstrained: false, oeRatio: 0.91, pValue: 0.4, regionText: "100 to 200" },
      },
    };

    render(
      <VariantHeader
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={subThreshold as AnalysisResult}
      />
    );

    const verdict = screen.getByText("Sub-threshold window");
    const row = verdict.closest("li");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("title")).toContain("did not reach significance");
    expect(row!.getAttribute("title")).toContain("p = 0.400");
    // The "outside every constrained sub-region" copy would be false here.
    expect(screen.queryByText("Expected variation")).not.toBeInTheDocument();
  });

  it("labels the coordinate build from the payload instead of assuming GRCh38", () => {
    const grch37: Partial<AnalysisResult> = {
      predictorData: { gnomadVariantId: "7-140453136-A-T", gnomadVariantAssembly: "GRCh37" } as any,
    };

    const { container, rerender } = render(
      <VariantHeader gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={grch37 as AnalysisResult} />
    );

    expect(screen.getByText("hg19")).toBeInTheDocument();
    expect(screen.queryByText("hg38")).not.toBeInTheDocument();
    expect(screen.getByTitle(/GRCh37 genomic coordinates/)).toBeInTheDocument();
    expect(screen.getByText("GRCh37 coordinates")).toBeInTheDocument();

    // Unknown build: show the coordinate but make no build claim at all.
    const unknownBuild: Partial<AnalysisResult> = {
      predictorData: { gnomadVariantId: "7-140453136-A-T", gnomadVariantAssembly: null } as any,
    };

    rerender(
      <VariantHeader gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={unknownBuild as AnalysisResult} />
    );

    expect(container.querySelector(".vh-chip-key")).toBeNull();
    expect(screen.queryByText("hg38")).not.toBeInTheDocument();
    expect(screen.getByTitle(/Build not reported/)).toBeInTheDocument();
  });

  it("exposes the constraint metrics as a list for VoiceOver", () => {
    const { container } = render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // `list-style: none` drops list semantics in WebKit unless the role is explicit.
    const list = container.querySelector(".vh-metrics");
    expect(list).toHaveAttribute("role", "list");
    expect(list?.querySelectorAll("li.vh-metric")).toHaveLength(3);
  });

  it("gates the ClinGen PP2 wording on the server's own flag, not the Z threshold alone", () => {
    const pp2NotMet: Partial<AnalysisResult> = {
      gnomadConstraint: {
        missense_z: 3.4,
        oe_mis: 0.72, // ≥ 0.6, so the pipeline's isPP2Constrained is false
        pli: 0.8,
        loeuf: 0.5,
        isPP2Constrained: false,
        hasRegionalData: false,
        regionalConstraint: null,
      },
    };

    const { rerender } = render(
      <VariantHeader gene="GENE1" variant="p.Ala1Val" uniprotId="P00001" analysisResult={pp2NotMet as AnalysisResult} />
    );

    // The Z severity itself still reports as severe...
    expect(screen.getByText("Severe intolerance")).toBeInTheDocument();
    // ...but PP2 is not claimed.
    expect(screen.getByTitle(/ClinGen PP2 not met/)).toBeInTheDocument();
    expect(screen.queryByTitle(/ClinGen PP2 is met/)).not.toBeInTheDocument();

    const pp2Met: Partial<AnalysisResult> = {
      gnomadConstraint: {
        ...pp2NotMet.gnomadConstraint,
        oe_mis: 0.26,
        isPP2Constrained: true,
      } as any,
    };

    rerender(
      <VariantHeader gene="GENE2" variant="p.Ala1Val" uniprotId="P00002" analysisResult={pp2Met as AnalysisResult} />
    );

    expect(screen.getByTitle(/ClinGen PP2 is met/)).toBeInTheDocument();
  });

  it("keeps the band tones and verdicts in step with the thresholds", () => {
    const { container } = render(
      <VariantHeader
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    const tonesOf = (label: string) => {
      const row = Array.from(container.querySelectorAll("li.vh-metric")).find(
        (li) => li.querySelector(".vh-metric-label")?.textContent === label
      );
      return Array.from(row?.querySelectorAll(".vh-band") ?? []).map((b) => (b as HTMLElement).dataset.tone);
    };

    // The band ladder and the tier ladder are declared separately; this pins them together.
    expect(tonesOf("Missense Z")).toEqual(["good", "warn", "path"]);
    expect(tonesOf("LOEUF")).toEqual(["path", "warn", "good"]);
    expect(tonesOf("Regional O/E")).toEqual([]);
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

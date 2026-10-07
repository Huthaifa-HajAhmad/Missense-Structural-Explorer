// @vitest-environment jsdom
import React from "react";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import VariantHeader from "../VariantHeader";
import { VariantIdentity } from "../header/VariantIdentity";
import { buildVariantHeaderModel } from "../header/variantHeaderModel";
import { AnalysisResult } from "../../types";

/**
 * The variant chrome as the app renders it: the identity (top bar) above the context strip.
 * The identity and the strip were one component before the option-B redesign; these tests kept
 * their assertions and render both, with the strip's Details panel OPEN so the full tracks are in
 * the DOM. A chip and its panel row both state the value, so value/verdict assertions are scoped
 * to the panel (`panel()`), the surface that carries the full reading.
 */
type ChromeProps = { gene: string; variant: string; uniprotId: string; analysisResult: AnalysisResult | null };
function Chrome(props: ChromeProps) {
  return (
    <>
      <VariantIdentity model={buildVariantHeaderModel(props)} />
      <VariantHeader {...props} />
    </>
  );
}
function openDetails() {
  const button = screen.queryByRole("button", { name: /^Details/ });
  if (button && button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
function render(ui: React.ReactElement) {
  const result = rtlRender(ui);
  openDetails();
  const rerender = (next: React.ReactElement) => {
    result.rerender(next);
    openDetails();
  };
  return { ...result, rerender };
}
/** The Details panel: the full tracks, cut-points and verdicts. */
const panel = () => within(screen.getByRole("region", { name: "Gene constraint reference ranges" }));

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

    render(<Chrome gene="ACOT9" variant="p.Lys272Asn" uniprotId="Q9Y305" analysisResult={remapped} />);

    expect(screen.getByText("p.Lys281Asn")).toBeTruthy();
    const basis = screen.getByTestId("modelled-basis");
    expect(basis.textContent).toContain("modelled as p.Lys272Asn");
    expect(basis.textContent).toContain("canonical Q9Y305");
    // The canonical notation is NOT the headline any more, and nothing claims a remap that did not happen.
    expect(screen.queryByText("p.Lys272Asn")).toBeNull();
  });

  it("shows the plain notation when nothing was remapped", () => {
    render(<Chrome gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={null} />);

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
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
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
      <Chrome
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
    // The build is named in the field's own terms ("GRCh38", not UCSC "hg38") in front of the coordinate
    expect(screen.getByText("GRCh38")).toBeInTheDocument();
    expect(screen.queryByText("hg38")).not.toBeInTheDocument();

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
      <Chrome
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

  it("states proximity to a splice junction as context, not as an alert", () => {
    render(
      <Chrome
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    const chip = screen.getByTestId("splice-proximity-chip");
    expect(chip).not.toHaveClass("vh-chip--alert");
    expect(chip).toHaveTextContent("4 bp");
    expect(chip).toHaveTextContent("Near splice site");
    expect(chip.getAttribute("title")).toMatch(/context, not evidence/);
    expect(screen.queryByTitle(/Splice alert/)).toBeNull();
  });

  it("words an oriented position in splice-site numbering", () => {
    render(
      <VariantHeader
        gene="SLC12A4"
        variant="p.Gln867His"
        uniprotId="Q9UP95"
        analysisResult={
          {
            ...mockAnalysisResult,
            conservationData: { spliceProximity: { isNearSpliceSite: true, distance: 6, junctionType: "donor", regionType: "exonic" } } as any,
          } as AnalysisResult
        }
      />
    );
    expect(screen.getByTestId("splice-proximity-chip")).toHaveTextContent("−7 donor");
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
      <Chrome
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={noSpliceResult as AnalysisResult}
      />
    );

    expect(screen.queryByTitle(/Splice alert/)).not.toBeInTheDocument();
  });

  it("should render the gnomAD v4.1.2 constraint rail with compact labels, values and verdicts", () => {
    const { container } = render(
      <Chrome
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // The rows are scoped as GENE constraint in a visible caption, so a verdict beside the HGVS
    // cannot be read as a call on the variant.
    expect(screen.getByRole("list", { name: /gnomAD v4.1.2 population constraint/ })).toBeInTheDocument();
    expect(container.querySelector(".vh-rail-title")).toHaveTextContent("Gene constraint · gnomAD v4.1.2");
    expect(container.querySelector(".vh-rail-axis")).toHaveTextContent(/less depleted.*constrained/);
    expect(container.querySelector(".vh-rail-meta")).not.toBeInTheDocument();

    // Compact metric labels — the full names live in the tooltip/sr-only copy
    expect(panel().getByText("Missense Z")).toBeInTheDocument();
    expect(panel().getByText("LOEUF")).toBeInTheDocument();
    expect(panel().getByText("Regional O/E")).toBeInTheDocument();

    // Scores
    expect(panel().getByText("+2.04")).toBeInTheDocument();
    expect(panel().getByText("0.71")).toBeInTheDocument();
    expect(panel().getByText("0.85")).toBeInTheDocument();

    // Verdicts
    expect(panel().getByText("Constrained")).toBeInTheDocument();
    expect(panel().getByText("Not LoF constrained")).toBeInTheDocument(); // 0.71 ≥ 0.6, gnomAD's suggested cut
    expect(panel().getByText("Subgenic constrained")).toBeInTheDocument();

    // Reference ranges are rendered as threshold ticks on the tracks
    expect(panel().getByText("2.0")).toBeInTheDocument();
    expect(panel().getByText("3.09")).toBeInTheDocument();
    expect(panel().getByText("0.36")).toBeInTheDocument();
    expect(panel().getByText("0.45")).toBeInTheDocument(); // LOEUF constraint cut
    expect(panel().getByText("1.0")).toBeInTheDocument(); // RMC baseline

    // Three threshold tracks, each with a marker for the observed value
    expect(container.querySelectorAll(".vh-scale").length).toBe(3);
    expect(container.querySelectorAll(".vh-marker").length).toBe(3);

    // Constraint bands encode the reference zones (3 for Z, 3 for LOEUF, none for RMC)
    expect(container.querySelectorAll(".vh-band").length).toBe(6);

    // RMC block span and p-value are tooltip/sr-only provenance, not visible
    // text — a footnote would give the third row a second line and break the
    // row rhythm.
    const rmcRow = panel().getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain("Constrained block 460 to 600");
    expect(rmcRow!.getAttribute("title")).toContain("p = 0.002");
    expect(rmcRow!.textContent).toContain("RMC block 460 to 600");
    expect(panel().queryByText(/460–600/)).not.toBeInTheDocument();
  });

  it("should expose the reference ranges to assistive tech without restating the visible values", () => {
    render(
      <Chrome
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    // The reference sentence is the sr-only contract; the label, value and verdict are
    // already exposed as visible text, so repeating them here would double every row.
    expect(
      panel().getByText(/Reference: app-defined display bands/)
    ).toBeInTheDocument();
    expect(
      panel().getByText(/Reference: strongest 10% of MANE Select genes/)
    ).toBeInTheDocument();
    expect(panel().getByText(/Reference: O\/E = 1.0 is the neutral baseline/)).toBeInTheDocument();

    const srOnly = Array.from(document.querySelectorAll(".vh-metric .vh-sr-only")).map((el) => el.textContent ?? "");
    // The RMC row's detail leads with the constrained block (window provenance,
    // formerly the visible footnote), so match containment rather than a prefix.
    const detail = srOnly.filter((t) => t.includes("Reference:"));
    expect(detail).toHaveLength(3); // one per metric row
    // The metric value and verdict are NOT repeated inside the hidden detail.
    expect(detail.some((t) => t.includes("+2.04"))).toBe(false);
    expect(detail.some((t) => t.includes("Constrained"))).toBe(false);
    expect(detail.some((t) => t.includes("0.71"))).toBe(false);

    expect(
      panel().getByTitle(/Regional Missense Constraint \(RMC\): Constrained block 460 to 600/)
    ).toBeInTheDocument();
  });

  it("should carry the full metric names and ClinGen thresholds in the tooltips", () => {
    render(
      <Chrome
        gene="BRAF"
        variant="p.Val600Glu"
        uniprotId="P15056"
        analysisResult={mockAnalysisResult as AnalysisResult}
      />
    );

    expect(panel().getByTitle(/Missense Z score \+2\.04/)).toBeInTheDocument();
    expect(
      panel().getByTitle(/loss-of-function observed\/expected upper bound fraction \(LOEUF\) 0\.71/)
    ).toBeInTheDocument();
  });

  it("should handle severe Missense Z, strong LoF intolerance, and unconstrained RMC", () => {
    const extremeResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="TP53"
        variant="p.Arg175His"
        uniprotId="P04637"
        analysisResult={extremeResult as AnalysisResult}
      />
    );

    expect(panel().getByText("+3.50")).toBeInTheDocument();
    expect(panel().getByText("Severe intolerance")).toBeInTheDocument();
    expect(panel().getByText("0.22")).toBeInTheDocument();
    expect(panel().getByText("Strong LoF intolerance")).toBeInTheDocument();
    expect(panel().getByText("Outside regions")).toBeInTheDocument();
    // No observed ratio reported, so the metric renders the empty value state
    expect(panel().getByText("—")).toBeInTheDocument();
  });

  it("should collapse a tiny RMC p-value into scientific notation", () => {
    const tinyP: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={tinyP as AnalysisResult}
      />
    );

    const rmcRow = panel().getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain("p = 6.6×10⁻⁶");
    expect(panel().queryByText(/Gln199–Met555/)).not.toBeInTheDocument();
  });

  it("should handle null and NaN constraint values gracefully", () => {
    const nanResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="UNKNOWN"
        variant="p.Ala123Val"
        uniprotId="Q99999"
        analysisResult={nanResult as AnalysisResult}
      />
    );

    // Both NaN scores report "No data" with the empty-marker track state
    expect(panel().getAllByText("No data").length).toBe(2);
    expect(panel().getByText("No gnomAD blocks")).toBeInTheDocument();
    expect(container.querySelectorAll(".vh-marker").length).toBe(0);
    expect(container.querySelectorAll('.vh-scale[data-empty="true"]').length).toBe(3);
  });

  it("should handle a null analysisResult safely without crashing", () => {
    const { container } = render(
      <Chrome gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={null} />
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
      <Chrome
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
      <Chrome
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
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={noPositionResult as AnalysisResult}
      />
    );

    expect(panel().getByText("No data")).toBeInTheDocument();
    // The gene must NOT be described as lacking blocks: only this residue was unresolved.
    expect(panel().queryByText(/no gnomAD constraint blocks/i)).not.toBeInTheDocument();
    expect(panel().queryByText("No gnomAD blocks")).not.toBeInTheDocument();
    expect(panel().getByText(/No sub-regional call was returned for this residue/)).toBeInTheDocument();
    expect(panel().getByTitle(/no sub-regional call was returned for this residue/)).toBeInTheDocument();
  });

  it("still says a gene has no blocks when it genuinely has none", () => {
    const noBlocksResult: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="UNKNOWN"
        variant="p.Ala123Val"
        uniprotId="Q99999"
        analysisResult={noBlocksResult as AnalysisResult}
      />
    );

    expect(panel().getByText("No gnomAD blocks")).toBeInTheDocument();
    expect(panel().getByText(/The gene has no gnomAD constraint blocks/)).toBeInTheDocument();
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
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={result as AnalysisResult}
      />
    );

    const rmcRow = panel().getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).toContain(expected);
  });

  it.each([0, -1, NaN, Infinity])("omits the RMC p-value when it is %s", (pValue) => {
    const result: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={result as AnalysisResult}
      />
    );

    const rmcRow = panel().getByText("Subgenic constrained").closest("li");
    expect(rmcRow).not.toBeNull();
    expect(rmcRow!.getAttribute("title")).not.toContain("p = ");
    expect(rmcRow!.getAttribute("title")).toContain("Constrained block Gln199 to Met555");
    expect(panel().queryByText(/p = /)).not.toBeInTheDocument();
  });

  it("labels a matched RMC window that did not reach significance as sub-threshold, not as expected variation", () => {
    const subThreshold: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome
        gene="MACO1"
        variant="p.Glu433Lys"
        uniprotId="Q9NSG2"
        analysisResult={subThreshold as AnalysisResult}
      />
    );

    const verdict = panel().getByText("Sub-threshold window");
    const row = verdict.closest("li");
    expect(row).not.toBeNull();
    expect(row!.getAttribute("title")).toContain("did not reach significance");
    expect(row!.getAttribute("title")).toContain("p = 0.400");
    // The "outside every constrained sub-region" copy would be false here.
    expect(panel().queryByText("Outside regions")).not.toBeInTheDocument();
  });

  it("labels the coordinate build from the payload instead of assuming GRCh38", () => {
    const grch37: Partial<AnalysisResult> = {
      predictorData: { gnomadVariantId: "7-140453136-A-T", gnomadVariantAssembly: "GRCh37" } as any,
    };

    const { container, rerender } = render(
      <Chrome gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={grch37 as AnalysisResult} />
    );

    expect(screen.getByText("GRCh37")).toBeInTheDocument();
    expect(screen.queryByText("GRCh38")).not.toBeInTheDocument();
    expect(screen.getByTitle(/GRCh37 genomic coordinates/)).toBeInTheDocument();
    expect(screen.getByText("GRCh37 coordinates")).toBeInTheDocument();

    // Unknown build: show the coordinate but make no build claim at all.
    const unknownBuild: Partial<AnalysisResult> = {
      predictorData: { gnomadVariantId: "7-140453136-A-T", gnomadVariantAssembly: null } as any,
    };

    rerender(
      <Chrome gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={unknownBuild as AnalysisResult} />
    );

    expect(screen.queryByText(/^GRCh3[78]$/)).toBeNull();
    expect(container).toBeTruthy();
    expect(screen.getByTitle(/Build not reported/)).toBeInTheDocument();
  });

  it("exposes the constraint metrics as a list for VoiceOver", () => {
    const { container } = render(
      <Chrome
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

  it("gates the App-defined PP2 proxy wording on the server's own flag, not the Z threshold alone", () => {
    const pp2NotMet: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
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
      <Chrome gene="GENE1" variant="p.Ala1Val" uniprotId="P00001" analysisResult={pp2NotMet as AnalysisResult} />
    );

    // The Z severity itself still reports as severe...
    expect(panel().getByText("Severe intolerance")).toBeInTheDocument();
    // ...but PP2 is not claimed.
    expect(panel().getByTitle(/App-defined PP2 proxy not met/)).toBeInTheDocument();
    expect(panel().queryByTitle(/App-defined PP2 proxy is met/)).not.toBeInTheDocument();

    const pp2Met: Partial<AnalysisResult> = {
      gnomadConstraint: {
        provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "test" },
        regionalRelease: "4.1.1",
        ...pp2NotMet.gnomadConstraint,
        oe_mis: 0.26,
        isPP2Constrained: true,
      } as any,
    };

    rerender(
      <Chrome gene="GENE2" variant="p.Ala1Val" uniprotId="P00002" analysisResult={pp2Met as AnalysisResult} />
    );

    expect(panel().getByTitle(/App-defined PP2 proxy is met/)).toBeInTheDocument();
  });

  it("keeps the band tones and verdicts in step with the thresholds", () => {
    const { container } = render(
      <Chrome
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
    // Bands are listed in drawn order: every track reads tolerant on the left, constrained on the
    // right, so LOEUF (which falls as constraint rises) runs on a reversed axis.
    expect(tonesOf("Missense Z")).toEqual(["good", "warn", "path"]);
    expect(tonesOf("LOEUF")).toEqual(["good", "warn", "path"]);
    expect(tonesOf("Regional O/E")).toEqual([]);
  });

  it("draws every track in the same direction: constrained values sit right", () => {
    const { container } = render(
      <Chrome gene="BRAF" variant="p.Val600Glu" uniprotId="P15056" analysisResult={mockAnalysisResult as AnalysisResult} />
    );
    const leftOf = (label: string, selector: string) => {
      const row = Array.from(container.querySelectorAll("li.vh-metric")).find(
        (li) => li.querySelector(".vh-metric-label")?.textContent === label
      );
      return Array.from(row?.querySelectorAll<HTMLElement>(selector) ?? []).map((el) => parseFloat(el.style.left));
    };
    // Missense Z ticks 2.0 then 3.09, left to right
    const [z20, z309] = leftOf("Missense Z", ".vh-axis-label");
    expect(z309).toBeGreaterThan(z20);
    // LOEUF: the strong cut (0.35) sits RIGHT of the 0.6 cut on the reversed axis
    const [l035, l06] = leftOf("LOEUF", ".vh-axis-label");
    expect(l035).toBeGreaterThan(l06);
    // RMC: O/E 0.85 sits right of the 1.0 baseline
    const [rmcMarker] = leftOf("Regional O/E", ".vh-marker");
    const [rmcBaseline] = leftOf("Regional O/E", ".vh-axis-label");
    expect(rmcMarker).toBeGreaterThan(rmcBaseline);
  });


  it("should handle copy to clipboard interaction and update screen reader feedback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <Chrome
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

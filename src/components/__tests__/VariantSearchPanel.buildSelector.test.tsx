// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import VariantSearchPanel from "../VariantSearchPanel";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";

/**
 * The genome-build selector.
 *
 * Design property under test: the control owns NO state. Its value is derived from the notation, and
 * choosing a build REWRITES the notation — which is what makes a build choice an input aid rather
 * than hidden state (a sticky toggle, or a selection that can disagree with the text, is exactly how
 * an hg19 position comes to be sent under a GRCh38 label).
 */

function renderPanel() {
  return render(
    <SettingsProvider>
      <VariantSearchPanel
      />
    </SettingsProvider>
  );
}

/** Types into the Genomic coordinates field, the way a reader would. */
function typeCoordinate(value: string) {
  const input = screen.getByLabelText(/genomic coordinates/i) as HTMLInputElement;
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
  return input;
}

const buildSelect = () =>
  screen.queryByLabelText("Genome build this coordinate is expressed in") as HTMLSelectElement | null;

describe("VariantSearchPanel — genome build selector", () => {
  beforeEach(() => {
    act(() => {
      useVariantAnalysisStore.getState().resetVariantAnalysisState();
      useVariantAnalysisStore.setState({
        customGene: "",
        customVariant: "",
        customUniprot: "",
        customGenomic: "",
        numberingBasis: null,
        history: [],
        analysisState: { isLoading: false, error: null, result: null } as any,
      });
    });
  });

  it("is absent while the coordinate field is empty, as the badge was", () => {
    renderPanel();
    expect(buildSelect()).toBeNull();
    // The slot still states the field is optional (the panel marks several fields that way).
    expect(screen.getAllByText("Optional").length).toBeGreaterThan(0);
  });

  it("appears for a coordinate and derives its value from the notation, not from state", () => {
    renderPanel();
    typeCoordinate("chr1:g.1256452C>A");

    const select = buildSelect();
    expect(select).not.toBeNull();
    // A bare coordinate states NO build, so the control shows the server's default without claiming
    // it was stated — and the title says which of the two it is.
    expect(select!.value).toBe("GRCh38");
    expect(select!.getAttribute("title")).toContain("default");
  });

  it("writes the chosen build into the notation instead of storing a selection", () => {
    renderPanel();
    typeCoordinate("chr1:g.1256452C>A");

    act(() => {
      fireEvent.change(buildSelect()!, { target: { value: "GRCh37" } });
    });

    // The field now STATES the build — visible, quotable, and what the server reads.
    const input = screen.getByLabelText(/genomic coordinates/i) as HTMLInputElement;
    expect(input.value).toBe("Chr1(GRCh37):g.1256452C>A");
    // …and the control follows the text, so the two can never disagree.
    expect(buildSelect()!.value).toBe("GRCh37");
    expect(buildSelect()!.getAttribute("title")).toContain("stated");
  });

  it("reads a build the coordinate already states, including from a RefSeq accession", () => {
    renderPanel();
    typeCoordinate("Chr1(GRCh37):g.1256452C>A");
    expect(buildSelect()!.value).toBe("GRCh37");
    expect(buildSelect()!.getAttribute("title")).toContain("in the notation");

    // hg19 data usually arrives from a database as an accession, which names its own build.
    typeCoordinate("NC_000001.10:g.1256452C>A");
    expect(buildSelect()!.value).toBe("GRCh37");
    expect(buildSelect()!.getAttribute("title")).toContain("RefSeq accession");
  });

  it("swaps the two builds by rewriting an accession into an Ensembl contig", () => {
    renderPanel();
    typeCoordinate("NC_000001.10:g.1256452C>A");

    act(() => {
      fireEvent.change(buildSelect()!, { target: { value: "GRCh38" } });
    });

    // An accession cannot be relabelled, so the rewrite must change the contig spelling too.
    const input = screen.getByLabelText(/genomic coordinates/i) as HTMLInputElement;
    expect(input.value).toBe("Chr1(GRCh38):g.1256452C>A");
  });

  it("normalizes a dashed coordinate when the reader picks a build", () => {
    renderPanel();
    typeCoordinate("20-23365054-G-A");

    act(() => {
      fireEvent.change(buildSelect()!, { target: { value: "GRCh37" } });
    });

    // The server normalizes dashed input itself; doing it here means the build is visible in the
    // string that will actually be sent.
    expect((screen.getByLabelText(/genomic coordinates/i) as HTMLInputElement).value).toBe(
      "Chr20(GRCh37):g.23365054G>A"
    );
  });

  it("never offers a build where one cannot be stated", () => {
    renderPanel();
    // A protein notation typed into the coordinate field keeps its verdict badge, and gets no
    // control: the server would not honour an annotation there.
    typeCoordinate("p.Gly380Arg");
    expect(buildSelect()).toBeNull();
  });

  /**
   * The VARIANT field's own control.
   *
   * cDNA carries a build as much as a coordinate does — the transcript is read against a reference,
   * so an hg19 transcript sequence against GRCh38 is the same wrong-reference hazard. This field's
   * annotation sits on the transcript accession (`NM_004333.6(GRCh37):c.…`), which is why it needs its
   * own control rather than being left to the coordinate field.
   */
  describe("on the Variant notation field", () => {
    const variantInput = () => screen.getByLabelText(/protein or cdna notation/i) as HTMLInputElement;
    const variantBuildSelect = () =>
      screen.queryByLabelText("Genome build this cDNA is expressed in") as HTMLSelectElement | null;

    const typeVariant = (value: string) => {
      act(() => {
        fireEvent.change(variantInput(), { target: { value } });
      });
    };

    beforeEach(() => {
      renderPanel();
    });

    it("appears for cDNA alone — the accession is what a build annotation attaches to", () => {
      // A BARE `c.` notation names no transcript, so there is no reference sequence to qualify.
      typeVariant("c.1799T>A");
      expect(variantBuildSelect()).toBeNull();

      typeVariant("NM_004333.6:c.1799T>A");
      const select = variantBuildSelect();
      expect(select).not.toBeNull();
      // Unannotated cDNA states nothing, so the control shows the server's default without claiming
      // it was stated — the same honesty the coordinate field's control has.
      expect(select!.value).toBe("GRCh38");
      expect(select!.getAttribute("title")).toContain("default");
    });

    it("writes the chosen build onto the transcript accession", () => {
      typeVariant("NM_004333.6:c.1799T>A");

      act(() => {
        fireEvent.change(variantBuildSelect()!, { target: { value: "GRCh37" } });
      });

      expect(variantInput().value).toBe("NM_004333.6(GRCh37):c.1799T>A");
      expect(variantBuildSelect()!.value).toBe("GRCh37");
      expect(variantBuildSelect()!.getAttribute("title")).toContain("stated");
    });

    it("reads and swaps a build the cDNA already states", () => {
      typeVariant("NM_004333.6(GRCh37):c.1799T>A");
      expect(variantBuildSelect()!.value).toBe("GRCh37");

      act(() => {
        fireEvent.change(variantBuildSelect()!, { target: { value: "GRCh38" } });
      });

      // Replaced, not stacked: one annotation, and it is the one that will be sent.
      expect(variantInput().value).toBe("NM_004333.6(GRCh38):c.1799T>A");
    });

    it("gives the two controls distinct accessible names, and never doubles up on one field", () => {
      typeVariant("NM_004333.6:c.1799T>A");
      // Two identically named selects in one form is a coin flip for a screen-reader user.
      expect(variantBuildSelect()).not.toBeNull();
      expect(buildSelect()).toBeNull();

      // A protein notation gets neither: there is no reference sequence in `p.Gly380Arg`.
      typeVariant("p.Gly380Arg");
      expect(variantBuildSelect()).toBeNull();
    });
  });
});

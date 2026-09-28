// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import VariantSearchPanel from "../VariantSearchPanel";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { SettingsProvider } from "../../context/SettingsContext";
import type { BuildHint } from "../../shared/contracts";

/**
 * The reference-mismatch retry.
 *
 * Design property under test: the refusal's remedy is a COORDINATE, and offering it must not become a
 * second source of truth. The hint's notation is the server's own annotated spelling of the submitted
 * locus, so "retry" is an ordinary resubmit — the build is stated in the text the reader sees, exactly
 * as if they had chosen it in the build control.
 *
 * The other property is tighter: the prompt may only appear while the fields still hold the run it is
 * about. It lives on the last result and the fields are store-bound, so a reader who edits the
 * coordinate and then clicks would otherwise silently discard what they typed.
 */

const HINT: BuildHint = {
  assembly: "GRCh37",
  triedAssembly: "GRCh38",
  notation: "Chr1(GRCh37):g.1256452C>A",
  reason: "the reference allele matched no reference base on GRCh38 at that position",
};

/** The refused notation — the unused hg19 coordinate the bug report was about. */
const REFUSED = "chr1:g.1256452C>A";

function renderPanel(handleSearchSubmit = vi.fn()) {
  render(
    <SettingsProvider>
      <VariantSearchPanel
        isDark={false}
        classCard=""
        classCardHeader=""
        classCardTitle=""
        classInput=""
        classBorderSec=""
        handleSearchSubmit={handleSearchSubmit}
      />
    </SettingsProvider>
  );
  return handleSearchSubmit;
}

function seedRefusal(result: any) {
  act(() => {
    useVariantAnalysisStore.setState({
      customGene: "",
      customVariant: "",
      customUniprot: "",
      customGenomic: REFUSED,
      analysisState: {
        isLoading: false,
        error: "Analysis query error: reference allele does not match",
        result,
      } as any,
    });
  });
}

const coordinateInput = () =>
  screen.getByLabelText(/genomic coordinates/i) as HTMLInputElement;

describe("VariantSearchPanel — reference-mismatch retry", () => {
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

  it("offers the other build's spelling for a coordinate that failed to match the reference", () => {
    renderPanel();
    seedRefusal({ metadata: { variant: REFUSED }, buildHint: HINT });

    const prompt = screen.getByTestId("build-mismatch-prompt");
    /**
     * `role="group"`, not `alert`: the refusal message is already announced by the header's live
     * region, and a second alert for one event makes a screen reader read them over each other. The
     * prompt still names itself through `aria-labelledby`.
     */
    expect(prompt.getAttribute("role")).toBe("group");
    expect(prompt.getAttribute("aria-labelledby")).toBeTruthy();
    /**
     * The reader is told what happened — WHICH build was tried. Asserted on the assembled sentence,
     * because the static copy mentions both builds: a probe-only `toContain("GRCh38")` stayed green
     * even when the refusal's own build stopped being rendered into it.
     */
    expect(prompt.textContent).toContain("no matching reference base on GRCh38");
    expect(prompt.textContent).toContain(REFUSED);
    // …and the button carries the annotated spelling, ready to submit.
    expect(screen.getByTestId("build-mismatch-retry-GRCh37").textContent).toContain(
      "Chr1(GRCh37):g.1256452C>A"
    );
  });

  /**
   * A defaulted build is not an established one.
   *
   * The refusal's trail says whether the build the coordinate was read against had been STATED; when
   * it had not, the copy must say so, because "read as GRCh38" and "stated as GRCh38" are different
   * facts and only one of them was the reader's.
   */
  it("says when the build it names was only the default", () => {
    renderPanel();
    seedRefusal({
      metadata: { variant: REFUSED },
      buildHint: HINT,
      coordinateLift: {
        status: "not-needed",
        fromAssembly: "GRCh38",
        toAssembly: "GRCh38",
        buildDeclared: false,
      },
    });

    expect(screen.getByTestId("build-mismatch-prompt").textContent).toContain(
      "no matching reference base on GRCh38 (the default — no build was stated)"
    );
  });

  it("rewrites the coordinate field and re-submits, so the retry states its build", () => {
    const submit = renderPanel();
    seedRefusal({ metadata: { variant: REFUSED }, buildHint: HINT });

    act(() => {
      fireEvent.click(screen.getByTestId("build-mismatch-retry-GRCh37"));
    });

    // The field holds the annotated spelling: visible, quotable, and what the server will read.
    expect(coordinateInput().value).toBe("Chr1(GRCh37):g.1256452C>A");
    // …and the run was started, rather than the field being quietly changed.
    expect(submit).toHaveBeenCalledTimes(1);
    // The build control follows the text, so there is nothing to keep in sync.
    expect(
      (screen.getByLabelText("Genome build this coordinate is expressed in") as HTMLSelectElement).value
    ).toBe("GRCh37");
  });

  it("disappears once the reader edits the coordinate, rather than answering for the old one", () => {
    renderPanel();
    seedRefusal({ metadata: { variant: REFUSED }, buildHint: HINT });
    expect(screen.getByTestId("build-mismatch-prompt")).toBeTruthy();

    act(() => {
      // A VALID edit one base over: an invalid string would also hide the prompt under a parse-based
      // staleness check, which would prove "some change hides it" rather than "this is a different
      // coordinate from the one that was refused" — the property that actually matters.
      fireEvent.change(coordinateInput(), { target: { value: "chr1:g.1256453C>A" } });
    });

    expect(screen.queryByTestId("build-mismatch-prompt")).toBeNull();
  });

  /**
   * A non-empty SIBLING field means the reader has moved on, so the question is stale. Without this,
   * clicking the retry silently erased the notation they had started in the other field.
   */
  it("disappears when the reader starts a different query in the other field", () => {
    const submit = renderPanel();
    seedRefusal({ metadata: { variant: REFUSED }, buildHint: HINT });

    act(() => {
      fireEvent.change(screen.getByLabelText(/protein or cdna notation/i), {
        target: { value: "p.Gly380Arg" },
      });
    });

    expect(screen.queryByTestId("build-mismatch-prompt")).toBeNull();
    // …and nothing was submitted on their behalf.
    expect(submit).not.toHaveBeenCalled();
  });

  it("stays hidden for every other refusal, and for a result with no hint", () => {
    renderPanel();
    // A provider failure is not a coordinate problem: there is nothing to retry as.
    seedRefusal({ metadata: { variant: REFUSED } });
    expect(screen.queryByTestId("build-mismatch-prompt")).toBeNull();
  });

  /**
   * cDNA refusals are retried in the field they came from.
   *
   * A cDNA notation lives in the Variant field (`handleSearchSubmit` only prefers the Genomic field
   * when it has content), and the two fields are ALTERNATIVES, not additive inputs. Writing the retry
   * into the other one would move the notation across that line — changing which field the pipeline
   * reads, and leaving the field it landed in carrying a string whose own badge calls it invalid.
   */
  it("retries cDNA in the Variant field, not in the coordinate field", () => {
    const submit = renderPanel();
    const CDNA = "NM_004333.6:c.1799T>A";
    act(() => {
      useVariantAnalysisStore.setState({
        customGene: "BRAF",
        customVariant: CDNA,
        customUniprot: "",
        customGenomic: "",
        analysisState: {
          isLoading: false,
          error: "Analysis query error: reference allele does not match",
          result: {
            metadata: { variant: CDNA },
            buildHint: {
              assembly: "GRCh37",
              triedAssembly: "GRCh38",
              notation: "NM_004333.6(GRCh37):c.1799T>A",
            },
          },
        } as any,
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("build-mismatch-retry-GRCh37"));
    });

    expect((screen.getByLabelText(/protein or cdna notation/i) as HTMLInputElement).value).toBe(
      "NM_004333.6(GRCh37):c.1799T>A"
    );
    // The coordinate field stays empty: the alternatives never both hold content.
    expect(coordinateInput().value).toBe("");
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { StructureInspector } from "../StructureInspector";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";

/**
 * The inspector's de novo folding notice — the banner this file exists to stop from regressing.
 *
 * WHAT SHIPPED
 * ------------
 * For a 711 aa protein the inspector printed, in amber, beneath a red "ESMFold-2 Generation Failed"
 * card:
 *
 *   "ℹ️ ESMFold-2 Token Notice: Protein exceeds public 400 aa threshold. Sovereign JapanFold inference
 *    engine configured in Settings is used for de novo folding."
 *
 * Three things were wrong at once, and only one of them was a wording problem:
 *
 *   1. no "Sovereign JapanFold inference engine" and no such Settings entry exist in this repository;
 *   2. the routing rule it described does not exist either — crossing 400 aa DELETES the keyless
 *      fallback rather than selecting an engine, so the sentence inverted the constraint;
 *   3. it asserted a working engine on the same screen as a card reporting that the fold had failed;
 *   4. it omitted its own residue count, which is why its disagreement with the canvas beside it —
 *      "PROTEIN LENGTH: 51 AA" for that same 711 aa protein — was invisible to a reader.
 *
 * Each of those is pinned below, so a revert fails here rather than in front of a user.
 *
 * The rail now reads the store through `useStructure3dEvidence` (the 3D redesign), so the fixture
 * seeds the store instead of passing props; the invariants are unchanged.
 */

function renderNotice(overrides: {
  family?: "alphafold" | "esmfold";
  metadata?: Record<string, unknown>;
  esmFoldingError?: string | null;
  foldingStatus?: string | null;
} = {}) {
  useVariantAnalysisStore.setState({
    analysisState: {
      isLoading: false,
      error: null,
      result: {
        metadata: overrides.metadata ?? {
          gene: "GZF1",
          variant: "p.Arg591Trp",
          uniprotId: "Q9H116",
          residueIndex: 591,
          wildType: "Arg",
          mutant: "Trp",
          sequence: "M".repeat(711),
          mutatedSequence: "M".repeat(711),
        },
        uniprotFeatures: { features: [] },
      },
    } as any,
    esmFoldingError: overrides.esmFoldingError ?? null,
    foldingStatus: (overrides.foldingStatus ?? null) as any,
    esmFoldWtPdb: null,
    esmFoldMutPdb: null,
    isEsmFolding: false,
  } as any);
  return render(<StructureInspector family={overrides.family ?? "esmfold"} />);
}

beforeEach(() => cleanup());

const noticeOf = (container: HTMLElement) => container.querySelector("[data-folding-notice]");

describe("StructureInspector — the de novo folding notice", () => {
  it("names the length it is talking about, and never claims a Settings engine", () => {
    const { container } = renderNotice();

    const notice = noticeOf(container);
    expect(notice, "no notice rendered for a 711 aa sequence").not.toBeNull();
    expect(notice!.getAttribute("data-folding-notice")).toBe("info");

    // (4) the number that was missing. Without it the canvas and this panel could disagree about the
    // same run and neither would look wrong.
    expect(container.textContent).toContain("711 aa");

    // (1) and (2): the fabricated engine, its fabricated setting, and the inverted routing rule.
    expect(container.textContent).not.toMatch(/sovereign/i);
    expect(container.textContent).not.toMatch(/settings/i);
    expect(container.textContent).not.toMatch(/inference engine configured/i);
    expect(container.textContent).not.toMatch(/is used for de novo folding/i);

    // The ceiling this panel used to quote for Tier-1 was the stability path's 768, not Tier-1's 1,024.
    expect(container.textContent).not.toMatch(/\b768\b/);
    expect(container.textContent).toContain("1,024");
  });

  it("says nothing at all when both tiers accept the sequence", () => {
    const { container } = renderNotice({ metadata: { mutatedSequence: "M".repeat(120), sequence: "M".repeat(120) } });

    expect(noticeOf(container)).toBeNull();
  });

  it("warns rather than informs once no de novo model is possible, and still names the number", () => {
    const { container } = renderNotice({ metadata: { mutatedSequence: "M".repeat(1500), sequence: "M".repeat(1500) } });

    const notice = noticeOf(container);
    expect(notice).not.toBeNull();
    // The two tones rendered identically before, so a "cannot do this" and a benign advisory were
    // indistinguishable.
    expect(notice!.getAttribute("data-folding-notice")).toBe("warning");
    expect(container.textContent).toContain("1,500 aa");
  });

  it("takes the length from the mutant translation, not from a shorter window field", () => {
    // The shape of the original run: a 711 aa protein whose `sequence` field carried something much
    // shorter. Reading the wrong one is how the canvas came to print 51 aa.
    const { container } = renderNotice({ metadata: { sequence: "M".repeat(50), mutatedSequence: "M".repeat(711) } });

    expect(container.textContent).toContain("711 aa");
    expect(container.textContent).not.toContain("50 aa");
  });

  it("is suppressed when the failure card is on screen, instead of contradicting it", () => {
    const { container } = renderNotice({
      esmFoldingError: "Request timed out after 240000ms",
    });

    // (3) the contradiction: a reassuring "folding uses Tier-1" line above a failure report.
    expect(container.textContent).toContain("De novo folding failed");
    expect(noticeOf(container)).toBeNull();
  });

  it("reports a timeout as a likelihood, never as provider telemetry the app does not have", () => {
    const { container } = renderNotice({
      esmFoldingError: "Request timed out after 240000ms",
    });

    expect(container.textContent).toMatch(/timed out/i);
    expect(container.textContent).toMatch(/usual cause/i);
    // The unhedged originals. The error here is a client watchdog abort; it carries no information
    // about the provider's load.
    expect(container.textContent).not.toMatch(/high GPU cluster load/i);
    expect(container.textContent).not.toMatch(/high-throughput cloud GPUs/i);
  });

  it("still speaks about length when the failure belongs to the other model", () => {
    // FoldX (non-ESM) mode with a FoldX failure: the notice is about the SEQUENCE, so it must survive,
    // and it is the panel that points a reader at AlphaFold2 for a full-length model.
    const { container } = renderNotice({
      family: "alphafold",
      foldingStatus: "failed",
      metadata: { mutatedSequence: "M".repeat(1500), sequence: "M".repeat(1500) },
    });

    expect(noticeOf(container)?.getAttribute("data-folding-notice")).toBe("warning");
  });
});

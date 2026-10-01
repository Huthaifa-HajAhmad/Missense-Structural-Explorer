// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useVariantAnalysisStore } from "../useVariantAnalysisStore";

/**
 * Recents replays the submission as it was made, and any surface can request a re-run.
 *
 * A history entry used to keep only the translated protein notation, so a variant first entered as a
 * genomic coordinate was re-run from Recents through protein HGVS — a lossier route that Ensembl
 * refuses for codon-ambiguous substitutions, ending on the MyVariant hg19 fallback.
 */
describe("Recents replay", () => {
  beforeEach(() => {
    const store = useVariantAnalysisStore.getState();
    store.resetVariantAnalysisState();
    store.clearHistory();
    try {
      localStorage.clear();
    } catch (_) {}
  });

  it("stores the submitted notation beside the canonical one", () => {
    useVariantAnalysisStore.getState().addToHistory({
      gene: "NAE1",
      variant: "p.Asp116Gly",
      uniprotId: "Q13564",
      query: "16-66823281-T-C",
    });
    expect(useVariantAnalysisStore.getState().history[0]).toEqual({
      gene: "NAE1",
      variant: "p.Asp116Gly",
      uniprotId: "Q13564",
      query: "16-66823281-T-C",
    });
  });

  it("replays the submitted notation, and falls back to the canonical one for older entries", () => {
    const executeAnalysis = vi.fn();
    const store = useVariantAnalysisStore.getState();

    store.handleSelectHistoryItem(
      { gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564", query: "16-66823281-T-C" },
      { executeAnalysis },
    );
    expect(executeAnalysis).toHaveBeenLastCalledWith("NAE1", "16-66823281-T-C", "Q13564");
    // The search field still shows the canonical notation the reader recognises.
    expect(useVariantAnalysisStore.getState().variant).toBe("p.Asp116Gly");

    store.handleSelectHistoryItem({ gene: "NAE1", variant: "p.Asp116Gly", uniprotId: "Q13564" }, { executeAnalysis });
    expect(executeAnalysis).toHaveBeenLastCalledWith("NAE1", "p.Asp116Gly", "Q13564");
  });

  it("counts re-run requests so the shell can answer each one", () => {
    const before = useVariantAnalysisStore.getState().rerunNonce;
    useVariantAnalysisStore.getState().requestRerun();
    useVariantAnalysisStore.getState().requestRerun();
    expect(useVariantAnalysisStore.getState().rerunNonce).toBe(before + 2);
  });
});

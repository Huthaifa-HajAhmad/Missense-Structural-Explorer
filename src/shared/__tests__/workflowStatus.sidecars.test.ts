import { describe, expect, it } from "vitest";
import { getWorkflowStageStatus, isOnDemandView, summarizeWorkflowStatuses } from "../workflowStatus.ts";
import type { AnalysisResult } from "../contracts.ts";

/**
 * The structure stage and the on-demand classification (PIPE-1).
 *
 * Multimer and PPI start with the structure and are read through the same viewer, so the stage must not
 * report settled while either is still computing. Literature is the one stage the reader opens; it is
 * classified by view, not by the status word, which changes with the reader's action.
 */

const withStages = (pipelineStages: Record<string, string>): AnalysisResult =>
  ({ metadata: { gene: "SLC12A4", variant: "p.Gln867His", uniprotId: "Q9UP95", pipelineStages } } as any);

describe("structure stage waits for multimer and PPI (PIPE-1)", () => {
  it("stays running while multimer computes, even with coordinates loaded", () => {
    const status = getWorkflowStageStatus({
      view: "structure",
      result: withStages({ core: "complete", multimer: "running" }),
      hasStructureCoordinates: true,
    });
    expect(status.status).toBe("progress");
    expect(status.desc).toContain("Interface and multimer analysis running");
  });

  it("stays running while PPI computes, even with coordinates loaded", () => {
    const status = getWorkflowStageStatus({
      view: "structure",
      result: withStages({ core: "complete", ppi: "running" }),
      hasStructureCoordinates: true,
    });
    expect(status.status).toBe("progress");
  });

  it("says the coordinates are still loading when they are not yet present", () => {
    const status = getWorkflowStageStatus({
      view: "structure",
      result: withStages({ core: "complete", coordinates: "running", ppi: "running" }),
    });
    expect(status.status).toBe("progress");
    expect(status.desc).toMatch(/^Loading protein 3D coordinates/);
  });

  it("settles once both sidecars have settled, including when one was skipped or failed", () => {
    expect(
      getWorkflowStageStatus({
        view: "structure",
        result: withStages({ core: "complete", multimer: "complete", ppi: "skipped" }),
        hasStructureCoordinates: true,
      }).status
    ).toBe("complete");

    expect(
      getWorkflowStageStatus({
        view: "structure",
        result: withStages({ core: "complete", multimer: "error", ppi: "error" }),
        hasStructureCoordinates: true,
      }).status
    ).toBe("complete");
  });

  it("does not hold the stage on a sidecar when the core query itself failed", () => {
    // A failed core settles every stage; a sidecar still marked running must not resurrect "progress".
    const status = getWorkflowStageStatus({
      view: "structure",
      result: withStages({ core: "error", multimer: "running" }),
    });
    expect(status.status).toBe("unavailable");
  });
});

describe("on-demand views are classified by view (PIPE-1)", () => {
  it("names literature as the on-demand stage, and nothing else", () => {
    expect(isOnDemandView("literature")).toBe(true);
    for (const view of ["evidence", "structure", "energetics", "landscape", "insights", "report"]) {
      expect(isOnDemandView(view)).toBe(false);
    }
  });

  it("keeps an on-demand stage out of the summary whatever its status", () => {
    // The summary already excludes the "on-demand" status word; the rail excludes the view by name, so an
    // opened literature stage (complete) must not change the automatic count either.
    expect(summarizeWorkflowStatuses(["complete", "complete", "on-demand"]).total).toBe(2);
    expect(summarizeWorkflowStatuses(["complete", "complete", "complete"]).total).toBe(3);
  });
});

/**
 * ProtVar's precomputed FoldX is a reference row. The Energetics stage must never present it as the
 * run's ΔΔG, nor let its lookup state decide the stage.
 */
describe("energetics stage ignores the ProtVar reference row", () => {
  const stage = (foldingEnergetics: Record<string, unknown>) =>
    getWorkflowStageStatus({ view: "energetics", foldingEnergetics, foldingStatus: "failed", foldingError: "FoldX failed" });

  it("does not report ProtVar's value as the run's ΔΔG when every counted engine failed", () => {
    const status = stage({ foldx: null, protvar: 2.09, protvarStatus: "done" });
    expect(status.desc).not.toContain("+2.09");
  });

  it("is not held in progress by a pending ProtVar lookup", () => {
    const status = stage({ foldx: 1.2, foldxMean: 1.2, protvarStatus: "pending" });
    expect(status.status).not.toBe("progress");
    expect(status.desc).toContain("+1.2");
  });
});

import { describe, expect, it } from "vitest";
import { reloadMayPaint, stagesToResume, isServableStoredResult } from "../storedAnalysis";
import type { AnalysisCacheContext } from "../analysisContext";

/**
 * The rules for showing a saved analysis, tested where they live. The routes that use them
 * (`useAppEffects`, `useAnalysisPipeline`, `workflowOrchestrator`) are covered by their own suites;
 * this file pins the decision itself so a new route cannot quietly disagree with it.
 */

const context: AnalysisCacheContext = {
  uniprotId: "P00439",
  acmgWeighting: "standard",
  saprotEngine: "saprot-650m",
  assembly: "",
  genomicCoordinates: "",
  resolvedAssembly: "",
  liftedGenomicCoordinates: "",
  numberingBasis: "",
  userDirections: "",
  simulationConditions: "conditions",
  providerConfiguration: "{}",
};

/** A saved analysis with every stage settled and every enrichment present. */
const result = (over: Record<string, any> = {}) => ({
  analysis: "A real narrative.",
  multimerData: { status: "monomeric" },
  ppiBindingData: { partners: [] },
  landscapeData: [{ position: 1 }],
  esm2Eval: { llr: 1 },
  saprotEval: { score: 1 },
  metadata: {
    pipelineStages: { core: "complete", landscape: "complete", structural: "complete", multimer: "complete", ppi: "complete", narrative: "complete" },
    pipelineContext: context,
  },
  ...over,
});

/** Protein artefacts live on the bundle beside the result, which is where a run saves them. */
const bundle = (saved = result(), over: Record<string, any> = {}): any => ({
  version: 1,
  gene: "PAH",
  variant: "p.Arg408Trp",
  uniprotId: "P00439",
  timestamp: 0,
  mutantPdb: "PDB",
  foldingStatus: "success",
  foldingEnergetics: { foldx: -1.2 },
  analysisResult: saved,
  ...over,
});

describe("showing a saved analysis without starting a run", () => {
  it("paints a finished analysis whose settings still match and which has nothing left to do", () => {
    expect(reloadMayPaint(bundle(), context, null, "automatic")).toBe(true);
  });

  it("does not paint when a scientific setting changed since the analysis was saved", () => {
    const stricter = { ...context, acmgWeighting: "strict-structural" };
    expect(reloadMayPaint(bundle(), stricter, null, "automatic")).toBe(false);
  });

  it("does not paint when a stage still has to be resumed", () => {
    const landscapeFailed = result({ landscapeData: [] });
    landscapeFailed.metadata.pipelineStages.landscape = "error";
    expect(reloadMayPaint(bundle(landscapeFailed), context, null, "automatic")).toBe(false);
  });

  it("does not paint while FoldX is still owed", () => {
    expect(reloadMayPaint(bundle(result(), { foldingStatus: "failed", foldingEnergetics: {} }), context, null, "automatic")).toBe(false);
  });

  it("does not paint a missing narrative when the mode writes them automatically", () => {
    const typedOnly = result({ analysis: "", isFallback: true, fallbackReason: "unavailable" });
    expect(reloadMayPaint(bundle(typedOnly), context, null, "automatic")).toBe(false);
    expect(reloadMayPaint(bundle(typedOnly), context, null, "on-demand")).toBe(true);
  });

  it("does not paint a result that is not servable, whatever else matches", () => {
    expect(reloadMayPaint(bundle(result({ buildHint: { notation: "chr1:1A>G" } })), context, null, "automatic")).toBe(false);
    expect(isServableStoredResult(result())).toBe(true);
  });
});

describe("resuming only the enrichment a saved result did not finish", () => {
  it("resumes nothing when every stage arrived", () => {
    expect(stagesToResume(result())).toEqual([]);
  });

  it("names the stages whose evidence never arrived, in the order a run restarts them", () => {
    const partial = result({ multimerData: null, landscapeData: null, esm2Eval: null, saprotEval: null });
    delete (partial.metadata.pipelineStages as any).structural;
    expect(stagesToResume(partial)).toEqual(["multimer", "landscape", "structural"]);
  });

  it("resumes a stage a previous session left running, even when it already had some data", () => {
    const interrupted = result();
    interrupted.metadata.pipelineStages.landscape = "running";
    expect(stagesToResume(interrupted)).toContain("landscape");
  });
});

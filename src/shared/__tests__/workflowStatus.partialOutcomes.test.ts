import { describe, expect, it } from "vitest";
import { getWorkflowStageStatus } from "../workflowStatus.ts";
import type { AnalysisResult } from "../contracts.ts";

/**
 * A stage that finished with part of its work missing must say "partial" (degraded), never "complete".
 *
 * Each case below is a state a real run reached: the ABCG1 p.Gly358Arg run of 2026-11-25 read gnomAD
 * from the local stand-in and had a FoldX estimate at pLDDT 27, and the source audit reproduced the
 * ClinVar, multimer/PPI and whole-protein-overview failures against the status function directly.
 */

const finished = (extra: Record<string, unknown> = {}, stages: Record<string, string> = {}): AnalysisResult =>
  ({
    metadata: { gene: "ABCG1", variant: "p.Gly358Arg", uniprotId: "P45844", pipelineStages: { core: "complete", ...stages } },
    ...extra,
  } as any);

describe("evidence stage names every missing source", () => {
  it("does not call a failed ClinVar query annotated evidence", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({ serviceStatus: { clinvar: "error", gnomadFrequency: "ok" } }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toBe("ClinVar did not answer on this run · re-run to retry");
  });

  it("treats a ClinVar timeout like a failure", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({ serviceStatus: { clinvar: "timeout", gnomadFrequency: "ok" } }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toContain("ClinVar did not answer");
  });

  it("says 'No record' when ClinVar answered with nothing", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({ serviceStatus: { clinvar: "not_found", gnomadFrequency: "ok" } }),
    });
    expect(status).toEqual({ status: "complete", desc: "ClinVar: No record · ACMG rules evaluated" });
  });

  it("names the local gnomAD stand-in, which has no ancestry groups or FAF95", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({
        serviceStatus: { clinvar: "ok", gnomadFrequency: "stand-in" },
        clinvar: { classification: "Benign" },
        gnomadFrequency: { dataset: "gnomad_r4_local", standIn: "grace" },
      }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toBe("ClinVar: Benign · gnomAD from the local combined copy — no ancestry groups or FAF95");
  });

  it("names the stand-in from the record when only the record says so", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({ serviceStatus: { clinvar: "ok" }, clinvar: { classification: "Benign" }, gnomadFrequency: { standIn: "fault" } }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toContain("local combined copy");
  });

  it("does not hide a failed ClinVar query behind a fallback locus", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({
        serviceStatus: { clinvar: "error" },
        predictorData: { gnomadVariantId: null, gnomadVariantAssembly: null, locusResolution: { route: "fallback", canonicalBy: null, retryable: true, failureKind: "transient-provider", steps: [] } },
      }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toMatch(/^ClinVar did not answer on this run · Population evidence not assessed: /);
  });

  it("shows both problems when ClinVar failed and gnomAD did not answer", () => {
    const status = getWorkflowStageStatus({
      view: "evidence",
      result: finished({ serviceStatus: { clinvar: "error", gnomadFrequency: "timeout" } }),
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toBe(
      "ClinVar did not answer on this run · gnomAD did not answer on this run · population evidence incomplete — re-run to retry"
    );
  });
});

describe("structure stage keeps failed interface work visible", () => {
  it("is partial when coordinates loaded but multimer and PPI failed", () => {
    const status = getWorkflowStageStatus({
      view: "structure",
      result: finished({}, { multimer: "error", ppi: "error" }),
      hasStructureCoordinates: true,
    });
    expect(status).toEqual({
      status: "degraded",
      desc: "Protein 3D coordinates ready · Assembly and partner lookups failed — open Interfaces & PPI to retry",
    });
  });

  it("names only the lookup that failed", () => {
    const status = getWorkflowStageStatus({
      view: "structure",
      result: finished({}, { multimer: "complete", ppi: "error" }),
      hasStructureCoordinates: true,
    });
    expect(status.status).toBe("degraded");
    expect(status.desc).toContain("Partner lookup failed");
  });
});

describe("landscape stage keeps a failed whole-protein overview visible", () => {
  it("is partial when the window loaded but the overview failed", () => {
    const status = getWorkflowStageStatus({
      view: "landscape",
      result: finished({ landscapeData: [{ pos: 358 }] }),
      landscapeOverviewStatus: "error",
    });
    expect(status).toEqual({ status: "degraded", desc: "1 residue loaded · Whole-protein overview failed — retry in Landscape" });
  });
});

describe("energetics stage carries the model's confidence", () => {
  it("adds the low pLDDT to a FoldX estimate from a low-confidence AlphaFold region", () => {
    const status = getWorkflowStageStatus({
      view: "energetics",
      result: finished({ disruptionPredictor: { plddt: 27.83 } }),
      foldingEnergetics: { foldxDdg: -1.1696, provenance: { source: "alphafold" } },
      foldingDdG: -1.1696,
      foldingStatus: "success",
    });
    expect(status.desc).toContain("FoldX ΔΔG = -1.17");
    expect(status.desc).toContain("Low model confidence (pLDDT 28)");
  });

  it("adds nothing when the model is confident", () => {
    const status = getWorkflowStageStatus({
      view: "energetics",
      result: finished({ disruptionPredictor: { plddt: 91 } }),
      foldingEnergetics: { foldxDdg: -1.1696, provenance: { source: "alphafold" } },
      foldingDdG: -1.1696,
      foldingStatus: "success",
    });
    expect(status.desc).not.toContain("pLDDT");
  });
});

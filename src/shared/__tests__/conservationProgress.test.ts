import { describe, it, expect } from "vitest";
import { conservationModelState, isConservationCompositePending, mergeAlphaGenomeReevaluation } from "../conservationProgress.ts";
import { buildSplicingEvidence } from "../splicingEvidence.ts";
import { buildAlphaGenomeEvidence } from "../alphagenomeEvidence.ts";
import { evidenceTabsLoading, isEvidenceTabLoading } from "../evidenceTabProgress.ts";
import { getWorkflowStageStatus } from "../workflowStatus.ts";
import { nae1Reference } from "./fixtures/splicingReference.ts";

const pendingComposite = (modelStatus: Record<string, string>, conservation: Record<string, any> = {}) => ({
  serviceStatus: { conservationData: "pending" },
  conservationData: { revel: null, spliceai: null, alphagenome: null, ...conservation, modelStatus },
});

describe("per-model conservation state", () => {
  it("answers per model while the composite streams", () => {
    const r = pendingComposite({ base: "pending", spliceai: "settled", alphagenome: "pending" });
    expect(conservationModelState(r, "spliceai", true)).toBe("settled");
    expect(conservationModelState(r, "alphagenome", true)).toBe("pending");
  });

  it("treats a settled composite as final, so a stale pending cannot outlive the run", () => {
    const r = { serviceStatus: { conservationData: "ok" }, conservationData: { modelStatus: { spliceai: "pending" } } };
    expect(conservationModelState(r, "spliceai", true)).toBe("settled");
  });

  it("keeps a budget-expired model distinguishable from an answered one", () => {
    const r = { serviceStatus: { conservationData: "timeout" }, conservationData: { modelStatus: { base: "settled", alphagenome: "timeout" } } };
    expect(conservationModelState(r, "alphagenome", false)).toBe("timeout");
    expect(conservationModelState(r, "base", false)).toBe("settled");
  });

  it("reads a failed composite with nothing salvaged as not assessed, never as an empty answer", () => {
    expect(conservationModelState({ serviceStatus: { conservationData: "error" } }, "alphagenome", false)).toBe("timeout");
    expect(conservationModelState({ serviceStatus: { conservationData: "timeout" } }, "spliceai", false)).toBe("timeout");
    expect(conservationModelState({ serviceStatus: { conservationData: "not_found" } }, "spliceai", false)).toBe("settled");
  });

  it("keeps the core stage as the owner of conservationData until it is terminal", () => {
    const settled = { serviceStatus: { conservationData: "ok" }, metadata: { pipelineStages: { core: "running" } } };
    expect(isConservationCompositePending(settled, false)).toBe(true);
    expect(isConservationCompositePending({ ...settled, metadata: { pipelineStages: { core: "complete" } } }, false)).toBe(false);
  });

  it("falls back to the composite, then to the loading flag, for payloads without per-model state", () => {
    expect(conservationModelState({ serviceStatus: { conservationData: "pending" } }, "spliceai", false)).toBe("pending");
    expect(conservationModelState({}, "spliceai", true)).toBe("pending");
    expect(conservationModelState({}, "spliceai", false)).toBe("settled");
  });
});

describe("splicing reads its own models", () => {
  const sai = { ds_ag: 0.01, ds_al: 0.01, ds_dg: 0, ds_dl: 0, max_ds: 0.01 };

  it("states the rule as soon as SpliceAI has answered, without waiting for dbNSFP or geometry", () => {
    const ev = buildSplicingEvidence({
      result: nae1Reference({
        serviceStatus: { conservationData: "pending" },
        conservationData: { spliceai: sai, modelStatus: { base: "pending", spliceai: "settled", spliceProximity: "settled" } },
      }),
      isLoading: true,
    });
    expect(ev.spliceai.availability.hasValue).toBe(true);
    // The rule is SpliceAI's delta score alone, so nothing still running can change it.
    expect(ev.rule.state).toBe("bp4");
  });

  it("says a timed-out SpliceAI was not scored in time, not that no score exists", () => {
    const ev = buildSplicingEvidence({
      result: nae1Reference({
        serviceStatus: { conservationData: "timeout" },
        conservationData: { modelStatus: { base: "settled", spliceai: "timeout", spliceProximity: "settled" } },
      }),
    });
    expect(ev.pending).toBe(false);
    expect(ev.spliceai.availability.reason).toMatch(/did not return a score in this run/);
  });
});

describe("AlphaGenome while its request is in flight", () => {
  it("is pending rather than 'no score'", () => {
    const ev = buildAlphaGenomeEvidence({ result: pendingComposite({ alphagenome: "pending" }) });
    expect(ev.availability.state).toBe("pending");
  });

  it("is pending on the loading flag alone for a payload with no status yet", () => {
    expect(buildAlphaGenomeEvidence({ result: {}, isLoading: true }).availability.state).toBe("pending");
  });

  it("names a budget expiry as such", () => {
    const ev = buildAlphaGenomeEvidence({
      result: { serviceStatus: { conservationData: "timeout" }, conservationData: { alphagenome: null, modelStatus: { alphagenome: "timeout" } } },
    });
    expect(ev.availability.state).not.toBe("pending");
    expect(ev.availability.reason ?? "").toMatch(/did not return a score in this run/);
  });
});

describe("Evidence row: usable is not settled", () => {
  const tabs = [
    { id: "clinical", label: "Population data" },
    { id: "alphagenome", label: "AlphaGenome" },
    { id: "splicing", label: "RNA splicing" },
    { id: "expression-models", label: "Expression" },
    { id: "interfaces", label: "Interfaces & PPI" },
  ];

  it("lists the tabs still loading, each by its own sources", () => {
    const result = {
      ...pendingComposite({ base: "settled", spliceai: "settled", alphagenome: "pending" }, { spliceai: { max_ds: 0.1 } }),
      serviceStatus: { conservationData: "pending", clinvar: "ok", gnomadFrequency: "ok", gnomadConstraint: "ok" },
      metadata: { pipelineStages: { multimer: "complete", ppi: "running" } },
    };
    const loading = evidenceTabsLoading(tabs, false, result, { disease: false, expression: true, models: false });
    expect(loading).toEqual(["AlphaGenome", "Expression", "Interfaces & PPI"]);
    expect(isEvidenceTabLoading("splicing", false, result)).toBe(false);
  });

  it("is in progress and says it is usable while a tab still loads, complete once none does", () => {
    const result: any = { clinvar: { classification: "Benign" }, serviceStatus: { clinvar: "ok", gnomadFrequency: "ok" }, metadata: {} };
    const usable = getWorkflowStageStatus({ view: "evidence", result, evidenceTabsLoading: ["AlphaGenome", "Expression"] });
    expect(usable.status).toBe("progress");
    expect(usable.desc).toBe("Usable now · Still loading: AlphaGenome, Expression");

    const settled = getWorkflowStageStatus({ view: "evidence", result, evidenceTabsLoading: [] });
    expect(settled.status).toBe("complete");
  });

  it("describes partial core evidence with a real separator", () => {
    const result: any = { serviceStatus: { clinvar: "ok", conservationData: "pending" }, metadata: {} };
    const { desc } = getWorkflowStageStatus({ view: "evidence", result, isBiophysicalLoading: true });
    expect(desc).toBe("Partial evidence available · Remaining sources loading");
  });
});

describe("AlphaGenome re-evaluation touches only AlphaGenome", () => {
  const fresh: any = {
    revel: 0.1, spliceai: { max_ds: 0.9 }, alphagenome: { status: "live", aviPhred: 40 },
    assemblyRefusals: [{ source: "alphagenome", reason: "fresh" }, { source: "popEVE", reason: "other" }],
  };

  it("replaces the reading and its refusal, and keeps every other model of the current run", () => {
    const current: any = {
      revel: 0.9, spliceai: { max_ds: 0.01 }, alphagenome: { status: "unavailable" },
      assemblyRefusals: [{ source: "alphagenome", reason: "old" }, { source: "gpn-star", reason: "kept" }],
      modelStatus: { base: "settled", alphagenome: "timeout" },
    };
    const merged = mergeAlphaGenomeReevaluation(current, fresh);
    expect(merged.alphagenome?.aviPhred).toBe(40);
    expect(merged.revel).toBe(0.9);
    expect(merged.spliceai?.max_ds).toBe(0.01);
    expect(merged.assemblyRefusals).toEqual([{ source: "gpn-star", reason: "kept" }, { source: "alphagenome", reason: "fresh" }]);
    // Every model has now answered, so the lifecycle is no longer carried.
    expect(merged.modelStatus).toBeUndefined();
  });

  it("imports nothing but AlphaGenome into a run with no composite", () => {
    const merged = mergeAlphaGenomeReevaluation(null, fresh);
    expect(merged.alphagenome?.aviPhred).toBe(40);
    expect(merged.revel).toBeUndefined();
    expect(merged.spliceai).toBeUndefined();
  });

  it("keeps other models' timeouts in the lifecycle", () => {
    const merged = mergeAlphaGenomeReevaluation({ modelStatus: { alphagenome: "timeout", spliceai: "timeout" } } as any, fresh);
    expect(merged.modelStatus).toEqual({ alphagenome: "settled", spliceai: "timeout" });
  });
});

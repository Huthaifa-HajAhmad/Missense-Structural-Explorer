import { describe, expect, it } from "vitest";
import {
  PRIMARY_PREDICTOR_CHAIN,
  decidePrimaryInsilico,
  primaryInsilicoInputFromResult,
  resolveSpliceAiGateInput,
} from "../insilico/primaryPredictor.ts";
import { lookupVcepInsilicoRule } from "../insilico/vcepRules.ts";
import type { VcepInsilicoRule } from "../insilico/vcepTypes.ts";

describe("vcepRules lookup (Phase 5c)", () => {
  it("resolves audited VCEP specs case-insensitively and returns null for uncovered genes", () => {
    expect(lookupVcepInsilicoRule("TP53")?.cspecId).toBe("GN009");
    expect(lookupVcepInsilicoRule("pah")?.cspecId).toBe("GN006");
    expect(lookupVcepInsilicoRule("GBA1")).toBeNull();
    expect(lookupVcepInsilicoRule(null)).toBeNull();
  });
});

describe("decidePrimaryInsilico — REVEL -> BayesDel noAF -> AlphaMissense -> ESM1b", () => {
  it("uses the settled four-tool fallback order", () => {
    expect(PRIMARY_PREDICTOR_CHAIN).toEqual(["revel", "bayesdel", "alphaMissense", "esm1b"]);
  });

  it("emits REVEL at every Pejaver 2022 calibrated strength including BP4_VeryStrong", () => {
    const cleanSplice = { maxDs: 0.01, status: "settled" as const, failure: null, coordinateBlocked: false, coordinateReason: null };
    expect(decidePrimaryInsilico({ scores: { revel: 0.95 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "PP3_Strong", activeTool: "revel", skippedBefore: [],
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.8 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "PP3_Moderate", activeTool: "revel",
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.65 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "PP3", activeTool: "revel",
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.25 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "BP4", activeTool: "revel",
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.1 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "BP4_Moderate", activeTool: "revel",
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.01 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "BP4_Strong", activeTool: "revel",
    });
    expect(decidePrimaryInsilico({ scores: { revel: 0.003 }, spliceAi: cleanSplice })).toMatchObject({
      outcome: "met", code: "BP4_VeryStrong", activeTool: "revel",
    });
  });

  it("falls back in fixed order when earlier tools have no score", () => {
    const cleanSplice = { maxDs: 0.01, status: "settled" as const, failure: null, coordinateBlocked: false, coordinateReason: null };
    const bayesdelHit = decidePrimaryInsilico({
      scores: { revel: null, bayesdel: 0.55, alphaMissense: 0.99, esm1b: -15 },
      spliceAi: cleanSplice,
    });
    expect(bayesdelHit).toMatchObject({
      outcome: "met", code: "PP3_Strong", activeTool: "bayesdel", skippedBefore: ["revel"],
    });

    const amHit = decidePrimaryInsilico({
      scores: { revel: null, bayesdel: null, alphaMissense: 0.92, esm1b: -15 },
      spliceAi: cleanSplice,
    });
    expect(amHit).toMatchObject({
      outcome: "met", code: "PP3_Moderate", activeTool: "alphaMissense", skippedBefore: ["revel", "bayesdel"],
    });

    const esmHit = decidePrimaryInsilico({
      scores: { revel: null, bayesdel: null, alphaMissense: null, esm1b: -13.0 },
      spliceAi: cleanSplice,
    });
    expect(esmHit).toMatchObject({
      outcome: "met", code: "PP3_Moderate", activeTool: "esm1b", skippedBefore: ["revel", "bayesdel", "alphaMissense"],
    });
  });

  it("stops on an indeterminate primary tool without falling through", () => {
    const res = decidePrimaryInsilico({
      scores: { revel: 0.5, bayesdel: 0.6, alphaMissense: 0.99, esm1b: -15 },
    });
    expect(res).toMatchObject({
      outcome: "indeterminate",
      code: null,
      direction: null,
      activeTool: "revel",
      activeScore: 0.5,
      skippedBefore: [],
    });
  });

  it("reads AlphaMissense numeric score only, ignoring amClass when numeric score is absent", () => {
    const input = primaryInsilicoInputFromResult({
      gene: "TEST",
      predictorData: { amPathogenicity: null, amClass: "likely_pathogenic" },
      conservationData: { revel: null, bayesdel: null, esm1b: -13.0 },
    });
    const res = decidePrimaryInsilico(input);
    expect(res).toMatchObject({
      outcome: "met",
      code: "PP3_Moderate",
      activeTool: "esm1b",
      skippedBefore: ["revel", "bayesdel", "alphaMissense"],
    });
  });

  it("treats a NaN or infinite score as no score and moves to the next tool", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const res = decidePrimaryInsilico({ scores: { revel: bad, bayesdel: 0.6 } });
      expect(res).toMatchObject({ outcome: "met", activeTool: "bayesdel", code: "PP3_Strong", skippedBefore: ["revel"] });
    }
  });

  it("returns no-score when none of the four chain tools scored", () => {
    const res = decidePrimaryInsilico({ scores: { revel: null, bayesdel: null, alphaMissense: null, esm1b: null } });
    expect(res).toMatchObject({ outcome: "no-score", code: null, activeTool: null });
  });

  it("withholds when dbNSFP base composite is pending or timed out", () => {
    for (const baseStatus of ["pending", "timeout"] as const) {
      const res = decidePrimaryInsilico({
        scores: { revel: 0.95 },
        baseStatus,
      });
      expect(res).toMatchObject({ outcome: "withheld-base", code: null, activeTool: null });
    }
  });

  it("withholds, rather than falling back to AlphaMissense, when the whole dbNSFP lookup has not answered", () => {
    // No conservation payload at all: REVEL and BayesDel are unknown, not missing.
    for (const status of ["pending", "timeout", "error"]) {
      const res = decidePrimaryInsilico(primaryInsilicoInputFromResult({
        predictorData: { amPathogenicity: 0.995 },
        conservationData: null,
        serviceStatus: { conservationData: status },
      }));
      expect(res).toMatchObject({ outcome: "withheld-base", code: null });
    }
    // A lookup that answered "not found" is a real absence: AlphaMissense answers.
    const notFound = decidePrimaryInsilico(primaryInsilicoInputFromResult({
      predictorData: { amPathogenicity: 0.995 },
      conservationData: null,
      serviceStatus: { conservationData: "not_found" },
    }));
    expect(notFound).toMatchObject({ outcome: "met", activeTool: "alphaMissense" });
  });

  it("collects disagreement from the other 3 chain tools only without changing strength", () => {
    // GZF1-like profile: REVEL 0.234 (BP4) while AlphaMissense 0.835 (PP3) opposes; BayesDel 0.092 is indeterminate.
    const cleanSplice = { maxDs: 0.0, status: "settled" as const, failure: null, coordinateBlocked: false, coordinateReason: null };
    const res = decidePrimaryInsilico({
      scores: { revel: 0.234, bayesdel: 0.092, alphaMissense: 0.835, esm1b: null },
      spliceAi: cleanSplice,
    });
    expect(res.code).toBe("BP4");
    expect(res.disagreeingTools.map(d => d.key)).toEqual(["alphaMissense"]);
    expect(res.disagreeingTools[0].call.code).toBe("PP3");

    // Strong REVEL stays PP3_Strong even when BayesDel and AlphaMissense read BP4.
    const strongOppose = decidePrimaryInsilico({
      scores: { revel: 0.95, bayesdel: -0.4, alphaMissense: 0.08, esm1b: -8.0 },
      spliceAi: cleanSplice,
    });
    expect(strongOppose.code).toBe("PP3_Strong");
    expect(strongOppose.disagreeingTools.map(d => d.key)).toEqual(["bayesdel", "alphaMissense"]);
  });
});

describe("SpliceAI BP4 gate (Walker 2023 + 3-bucket missingness policy)", () => {
  const bp4Input = (spliceAi: ReturnType<typeof resolveSpliceAiGateInput>, hasPvs1 = false) =>
    decidePrimaryInsilico({ scores: { revel: 0.002 }, spliceAi, hasPvs1 });

  it("blocks BP4 when SpliceAI max_ds >= 0.20 (with PVS1 suppressing splicing PP3)", () => {
    const res = bp4Input(resolveSpliceAiGateInput({
      conservationData: { spliceai: { max_ds: 0.2, ds_ag: 0.2, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
    }), true);
    expect(res).toMatchObject({
      outcome: "blocked-spliceai",
      code: null,
      activeTool: "revel",
      spliceGate: { status: "blocked", maxDs: 0.2 },
    });
  });

  it("allows BP4 with an indeterminate-splicing note when 0.10 < max_ds < 0.20", () => {
    const res = bp4Input(resolveSpliceAiGateInput({
      conservationData: { spliceai: { max_ds: 0.15, ds_ag: 0.15, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
    }));
    expect(res).toMatchObject({
      outcome: "met",
      code: "BP4_VeryStrong",
      spliceGate: { status: "passed-indeterminate-splicing", maxDs: 0.15 },
    });
  });

  it("allows BP4 cleanly when max_ds <= 0.10", () => {
    const res = bp4Input(resolveSpliceAiGateInput({
      conservationData: { spliceai: { max_ds: 0.1, ds_ag: 0.1, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
    }));
    expect(res).toMatchObject({
      outcome: "met",
      code: "BP4_VeryStrong",
      spliceGate: { status: "passed", maxDs: 0.1 },
    });
  });

  it("withholds BP4 when SpliceAI is pending, timed out, or has a transient Broad failure even if modelStatus.spliceai is settled", () => {
    for (const kind of ["rate-limited", "timeout", "upstream-error", "network", "unreadable"] as const) {
      const res = bp4Input(resolveSpliceAiGateInput({
        conservationData: {
          spliceai: null,
          modelStatus: { base: "settled", spliceai: "settled" },
          spliceaiFailure: { kind, httpStatus: null, detail: null },
        },
      }));
      expect(res, kind).toMatchObject({
        outcome: "withheld-spliceai",
        code: null,
        spliceGate: { status: "withheld-transient", retryable: true, failureKind: kind },
      });
    }

    for (const spliceStatus of ["pending", "timeout"] as const) {
      const res = bp4Input(resolveSpliceAiGateInput({
        conservationData: { spliceai: null, modelStatus: { base: "settled", spliceai: spliceStatus } },
      }));
      expect(res, spliceStatus).toMatchObject({
        outcome: "withheld-spliceai",
        code: null,
        spliceGate: { status: "withheld-transient", retryable: true },
      });
    }
  });

  it("withholds BP4 when coordinate resolution failed, is ambiguous, or SpliceAI rejected the coordinate", () => {
    const rejected = bp4Input(resolveSpliceAiGateInput({
      conservationData: {
        spliceai: null,
        spliceaiFailure: { kind: "coordinate-rejected", httpStatus: 400, detail: "REF mismatch" },
      },
    }));
    expect(rejected).toMatchObject({
      outcome: "withheld-spliceai",
      code: null,
      spliceGate: { status: "withheld-coordinate", retryable: false },
    });

    const multiCandidate = bp4Input(resolveSpliceAiGateInput({
      predictorData: {
        locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "multiple-candidates", steps: [] },
      },
      conservationData: { spliceai: null },
    }));
    expect(multiCandidate).toMatchObject({
      outcome: "withheld-spliceai",
      code: null,
      spliceGate: { status: "withheld-coordinate", retryable: false },
    });

    const refused = bp4Input(resolveSpliceAiGateInput({
      conservationData: {
        spliceai: null,
        assemblyRefusals: [{ source: "spliceai-lookup", reason: "spliceai-lookup declined unknown build" }],
      },
    }));
    expect(refused).toMatchObject({
      outcome: "withheld-spliceai",
      code: null,
      spliceGate: { status: "withheld-coordinate", retryable: false },
    });
  });

  it("applies BP4 with a caveat note on clean no-transcript miss or unassessed legacy/direct calls", () => {
    const noTx = bp4Input(resolveSpliceAiGateInput({
      conservationData: {
        spliceai: null,
        modelStatus: { base: "settled", spliceai: "settled" },
        spliceaiFailure: { kind: "no-transcript", httpStatus: 200, detail: null },
      },
    }));
    expect(noTx).toMatchObject({
      outcome: "met",
      code: "BP4_VeryStrong",
      spliceGate: { status: "applied-no-transcript" },
    });

    const unassessed = bp4Input(resolveSpliceAiGateInput({ conservationData: { revel: 0.002 } }));
    expect(unassessed).toMatchObject({
      outcome: "met",
      code: "BP4_VeryStrong",
      spliceGate: { status: "applied-unassessed" },
    });
  });

  it("withholds BP4 when predictor lookup missed or left no verified coordinate, while allowing user GRCh37 coordinates that reached SpliceAI", () => {
    const blockedCases = [
      { serviceStatus: { predictorData: "not_found" }, conservationData: { revel: 0.002, spliceai: null } },
      {
        predictorData: { locusResolution: { route: "vep-hgvs", canonicalBy: null, retryable: false, steps: [] }, gnomadVariantId: null },
        conservationData: { revel: 0.002, spliceai: null },
      },
      { predictorData: { gnomadVariantId: null }, conservationData: { revel: 0.002, spliceai: null } },
      {
        conservationData: { revel: 0.002, spliceai: null, spliceaiFailure: null, modelStatus: { base: "settled", spliceai: "settled" } },
      },
    ];
    for (const c of blockedCases) {
      const res = bp4Input(resolveSpliceAiGateInput(c));
      expect(res).toMatchObject({
        outcome: "withheld-spliceai",
        code: null,
        spliceGate: { status: "withheld-coordinate", retryable: false },
      });
    }

    const userGrch37NoTx = bp4Input(resolveSpliceAiGateInput({
      predictorData: {
        gnomadVariantId: "1-12345-A-G",
        gnomadVariantAssembly: "GRCh37",
        locusResolution: { route: "vep-coordinate", canonicalBy: null, retryable: false, steps: [] },
      },
      conservationData: {
        revel: 0.002,
        spliceai: null,
        spliceaiFailure: { kind: "no-transcript", httpStatus: 200, detail: null },
        modelStatus: { base: "settled", spliceai: "settled" },
      },
    }));
    expect(userGrch37NoTx).toMatchObject({
      outcome: "met",
      code: "BP4_VeryStrong",
      spliceGate: { status: "applied-no-transcript" },
    });
  });

  it("never blocks or withholds PP3 when SpliceAI is >= 0.20 or unavailable", () => {
    const pp3HighSplice = decidePrimaryInsilico({
      scores: { revel: 0.95 },
      spliceAi: resolveSpliceAiGateInput({
        conservationData: { spliceai: { max_ds: 0.9 }, spliceaiFailure: null },
      }),
    });
    expect(pp3HighSplice).toMatchObject({ outcome: "met", code: "PP3_Strong", spliceGate: null });

    const pp3NoSplice = decidePrimaryInsilico({
      scores: { revel: 0.95 },
      spliceAi: resolveSpliceAiGateInput({
        conservationData: { spliceai: null, modelStatus: { base: "settled", spliceai: "timeout" } },
      }),
    });
    expect(pp3NoSplice).toMatchObject({ outcome: "met", code: "PP3_Strong", spliceGate: null });
  });
});

describe("Walker 2023 splicing PP3 and PP3-once arbitration", () => {
  const spliceInput = (maxDs: number | null, channels?: { ds_ag?: number; ds_al?: number; ds_dg?: number; ds_dl?: number }) => ({
    maxDs,
    status: "settled" as const,
    failure: null,
    coordinateBlocked: false,
    coordinateReason: null,
    ...(channels ? { channels } : {}),
  });

  it("blocks BP4 at SpliceAI >= 0.20 and emits splicing PP3 when PVS1 is absent", () => {
    const decision = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.002 },
      spliceAi: spliceInput(0.20),
      hasPvs1: false,
      vcepRule: null,
    });
    expect(decision).toMatchObject({
      outcome: "met",
      code: "PP3",
      direction: "PP3",
      strength: "Supporting",
      criterionSource: "spliceai",
      activeTool: "spliceai",
      activeScore: 0.20,
      disagreeingTools: [],
      spliceGate: { status: "blocked", maxDs: 0.20 },
    });
    expect(decision.splicePp3Corroboration).toMatch(/overr/i);
  });

  it("emits splicing PP3 when missense scores are indeterminate or absent", () => {
    const indet = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.50 },
      spliceAi: spliceInput(0.30),
      vcepRule: null,
    });
    expect(indet).toMatchObject({
      outcome: "met",
      code: "PP3",
      criterionSource: "spliceai",
      activeTool: "spliceai",
    });

    const noMissense = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: null, bayesdel: null, alphaMissense: null, esm1b: null },
      spliceAi: spliceInput(0.30),
      vcepRule: null,
    });
    expect(noMissense).toMatchObject({
      outcome: "met",
      code: "PP3",
      criterionSource: "spliceai",
      activeTool: "spliceai",
    });
  });

  it("applies PP3 once: keeps stronger missense PP3 and attaches splicing corroboration note", () => {
    const strong = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.95 },
      spliceAi: spliceInput(0.85),
      vcepRule: null,
    });
    expect(strong).toMatchObject({
      outcome: "met",
      code: "PP3_Strong",
      criterionSource: "chain",
      activeTool: "revel",
    });
    expect(strong.splicePp3Corroboration).toContain("PP3 is applied once");

    const moderate = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.80 },
      spliceAi: spliceInput(0.25),
      vcepRule: null,
    });
    expect(moderate).toMatchObject({
      outcome: "met",
      code: "PP3_Moderate",
      criterionSource: "chain",
      activeTool: "revel",
    });
    expect(moderate.splicePp3Corroboration).toContain("PP3 is applied once");
  });

  it("never emits splicing PP3 when PVS1 is met", () => {
    const bp4Blocked = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.002 },
      spliceAi: spliceInput(0.85),
      hasPvs1: true,
      vcepRule: null,
    });
    expect(bp4Blocked).toMatchObject({
      outcome: "blocked-spliceai",
      code: null,
      spliceGate: { status: "blocked", maxDs: 0.85 },
    });

    const indet = decidePrimaryInsilico({
      gene: "GBA1",
      scores: { revel: 0.50 },
      spliceAi: spliceInput(0.85),
      hasPvs1: true,
      vcepRule: null,
    });
    expect(indet).toMatchObject({ outcome: "indeterminate", code: null });
  });

  it("respects VCEP custom splice BP4 ceilings and splicing PP3 cutoffs", () => {
    const baseRule = (splice: VcepInsilicoRule["splice"]): VcepInsilicoRule => ({
      gene: "TESTGENE",
      cspecId: "GN999",
      version: "1.0",
      vcep: "Test VCEP",
      rule: {
        kind: "ordered-tools",
        tools: [{
          tool: "revel",
          pp3: { Supporting: { threshold: 0.70, inclusive: true } },
          bp4: { Supporting: { threshold: 0.15, inclusive: true } },
        }],
      },
      splice,
      summary: "Test rule",
    });

    // Tighter bp4Block >= 0.10: blocks BP4 without emitting splicing PP3
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.10 },
      spliceAi: spliceInput(0.10),
      vcepRule: baseRule({ bp4Block: { threshold: 0.1, inclusive: true } }),
    })).toMatchObject({ outcome: "blocked-spliceai", code: null });

    // Tighter bp4Block > 0
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.10 },
      spliceAi: spliceInput(0.05),
      vcepRule: baseRule({ bp4Block: { threshold: 0, inclusive: false } }),
    })).toMatchObject({ outcome: "blocked-spliceai", code: null });

    // Tighter bp4Block > 0.05
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.10 },
      spliceAi: spliceInput(0.05),
      vcepRule: baseRule({ bp4Block: { threshold: 0.05, inclusive: false } }),
    })).toMatchObject({ outcome: "met", code: "BP4" });
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.10 },
      spliceAi: spliceInput(0.06),
      vcepRule: baseRule({ bp4Block: { threshold: 0.05, inclusive: false } }),
    })).toMatchObject({ outcome: "blocked-spliceai", code: null });

    // pp3Missense: "none" blocks BP4 at >= 0.20 but does not emit splicing PP3
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.10 },
      spliceAi: spliceInput(0.85),
      vcepRule: baseRule({ pp3Missense: "none" }),
    })).toMatchObject({ outcome: "blocked-spliceai", code: null });

    // pp3Missense > 0.50: 0.45 blocks BP4 without PP3, 0.55 emits splicing PP3
    const gtHalf = baseRule({ pp3Missense: { Supporting: { threshold: 0.5, inclusive: false } } });
    expect(decidePrimaryInsilico({ gene: "TESTGENE", scores: { revel: 0.10 }, spliceAi: spliceInput(0.45), vcepRule: gtHalf }))
      .toMatchObject({ outcome: "blocked-spliceai", code: null });
    expect(decidePrimaryInsilico({ gene: "TESTGENE", scores: { revel: 0.10 }, spliceAi: spliceInput(0.55), vcepRule: gtHalf }))
      .toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai", activeTool: "spliceai" });

    // pp3Missense: "nf1" (gain >= 0.4 AND loss >= 0.4) OR any >= 0.6
    const nf1 = baseRule({ pp3Missense: "nf1", bp4Block: { threshold: 0.18, inclusive: true } });
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.50 },
      spliceAi: spliceInput(0.40, { ds_ag: 0.40, ds_dg: 0.0, ds_al: 0.10, ds_dl: 0.40 }),
      vcepRule: nf1,
    })).toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai", activeTool: "spliceai" });
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.50 },
      spliceAi: spliceInput(0.40, { ds_ag: 0.40, ds_dg: 0.40, ds_al: 0.10, ds_dl: 0.10 }),
      vcepRule: nf1,
    })).toMatchObject({ outcome: "indeterminate", code: null });
    expect(decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.50 },
      spliceAi: spliceInput(0.60, { ds_ag: 0.60, ds_dg: 0.0, ds_al: 0.0, ds_dl: 0.0 }),
      vcepRule: nf1,
    })).toMatchObject({ outcome: "met", code: "PP3", criterionSource: "spliceai", activeTool: "spliceai" });

    // ABCA4 shape: Moderate splicing PP3 (>= 0.8) outranks Supporting missense PP3
    const abca4Shape = baseRule({
      pp3Missense: {
        Moderate: { threshold: 0.8, inclusive: true },
        Supporting: { threshold: 0.2, inclusive: true },
      },
    });
    const upgraded = decidePrimaryInsilico({
      gene: "TESTGENE",
      scores: { revel: 0.72 },
      spliceAi: spliceInput(0.80),
      vcepRule: abca4Shape,
    });
    expect(upgraded).toMatchObject({
      outcome: "met",
      code: "PP3_Moderate",
      criterionSource: "spliceai",
      activeTool: "spliceai",
    });
    expect(upgraded.splicePp3Corroboration).toContain("PP3 is applied once");
  });
});

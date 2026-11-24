import { describe, expect, it } from "vitest";
import {
  PRIMARY_PREDICTOR_CHAIN,
  decidePrimaryInsilico,
  primaryInsilicoInputFromResult,
  resolveSpliceAiGateInput,
} from "../insilico/primaryPredictor.ts";
import { lookupVcepInsilicoRule } from "../insilico/vcepRules.ts";

describe("vcepRules stub (PR A)", () => {
  it("returns null for every gene until PR B ships the audited 113-spec table", () => {
    expect(lookupVcepInsilicoRule("TP53")).toBeNull();
    expect(lookupVcepInsilicoRule("PAH")).toBeNull();
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
  const bp4Input = (spliceAi: ReturnType<typeof resolveSpliceAiGateInput>) =>
    decidePrimaryInsilico({ scores: { revel: 0.002 }, spliceAi });

  it("blocks BP4 when SpliceAI max_ds >= 0.20", () => {
    const res = bp4Input(resolveSpliceAiGateInput({
      conservationData: { spliceai: { max_ds: 0.2, ds_ag: 0.2, ds_al: 0, ds_dg: 0, ds_dl: 0 } },
    }));
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

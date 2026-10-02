import { describe, expect, it } from "vitest";
import {
  DEEP_EVIDENCE_BOUNDS,
  DEEP_EVIDENCE_MODEL_IDS,
  DEEP_EVIDENCE_SOURCE_LABELS,
  DEEP_MODEL_EVIDENCE_VERSION,
  buildDeepModelEvidence,
  canonicalDeepModelEvidence,
  deepEvidenceContextFromResult,
  deepEvidenceContextFromStore,
  deepEvidencePromptBlock,
  deepModelEvidenceFor,
} from "../deepModelEvidence";
import { deepModelEvidenceSchema } from "../contracts";
import type { EnergeticsInputs } from "../energeticsEvidence";

/**
 * The deep-model evidence a narrative synthesis is given.
 *
 * The load-bearing assertions here are (1) the SIGN of every ΔΔG is the canonical one — a DynaMut2
 * value reported negative must reach the prompt as destabilizing, because the model reasons about the
 * sign it is shown; (2) the payload is BOUNDED and validated, because it is interpolated into a clinical
 * prompt from a client-supplied request; and (3) the prompt text states what these observations are and
 * are not, including that no ACMG criterion may be created from them.
 */

const STABLE_RUN: EnergeticsInputs = {
  foldingEnergetics: {
    foldx: 2.62,
    foldxSd: 0.1,
    dynamut2: -1.8,
    ddmut: -1.1,
    thermompnn: 1.2,
    rasp: 0.9,
    raspSource: "experimental",
    evidenceComplete: true,
    structureProvenance: {
      source: "experimental",
      pdbId: "1abc",
      resolution: 1.8,
      foldxVersion: "5.1",
      foldxRuns: 5,
    },
  },
  dynamut2Status: "done",
  ddmutStatus: "done",
  thermompnnStatus: "done",
};

function observation(evidence: ReturnType<typeof buildDeepModelEvidence>, id: string) {
  const found = evidence.observations.find(entry => entry.id === id);
  expect(found, `${id} must have exactly one observation`).toBeDefined();
  return found!;
}

describe("deepModelEvidence — sign, provenance and status per model", () => {
  it("normalises every ΔΔG to the canonical sign (positive = destabilizing)", () => {
    const evidence = buildDeepModelEvidence({ stability: STABLE_RUN });

    const foldx = observation(evidence, "foldx");
    expect(foldx.value).toBe(2.62);
    expect(foldx.unit).toBe("kcal/mol");
    expect(foldx.call).toBe("Destabilizing");
    // The template the number was computed on travels with it, so a ΔΔG is never printed bare.
    expect(foldx.provenance).toContain("Experimental structure");
    expect(foldx.provenance).toContain("1ABC");
    expect(foldx.provenance).toContain("5.1");
    expect(foldx.note).toContain("Mean of 5 BuildModel runs");

    // DynaMut2 reports NEGATIVE = destabilizing. Canonicalised, it is +1.8 and reads destabilizing —
    // the defect `engineStatus.ts` exists to prevent, asserted at the prompt's own boundary.
    const dynamut2 = observation(evidence, "dynamut2");
    expect(dynamut2.value).toBe(1.8);
    expect(dynamut2.call).toBe("Destabilizing");

    const ddmut = observation(evidence, "ddmut");
    expect(ddmut.value).toBe(1.1);

    // Positive-native engines are unchanged.
    expect(observation(evidence, "thermompnn").value).toBe(1.2);
    expect(observation(evidence, "rasp").value).toBe(0.9);
  });

  it("states the ΔΔG engines that returned nothing, and why", () => {
    const evidence = buildDeepModelEvidence({
      stability: {
        foldingEnergetics: {
          foldx: null,
          foldxError: "FoldX binary not found",
          // The lookup's own reason travels inside the energetics bag, which is where the Energetics
          // surfaces read it from too.
          raspReason: "Residue position is not present in the pre-computed database",
        },
        foldingError: "FoldX binary not found",
        dynamut2Status: "unavailable",
        thermompnnStatus: "unavailable",
      },
    });

    const foldx = observation(evidence, "foldx");
    expect(foldx.state).toBe("failed");
    expect(foldx.note).toContain("FoldX binary not found");
    // A remote queue that did not answer is retryable; an engine this deployment cannot run is not —
    // the distinction `absenceClass` exists for, carried into the prompt instead of "unavailable".
    expect(observation(evidence, "dynamut2").state).toBe("upstream-busy");
    expect(observation(evidence, "thermompnn").state).toBe("not-installed");
    // A RaSP miss is a statement about the dataset, and only the lookup's own answer may assert it.
    expect(observation(evidence, "rasp").state).toBe("not-covered");
    expect(observation(evidence, "ddmut").state).toBe("no-result");
  });

  it("reports a pending remote engine as running, because a pending engine has a live poller", () => {
    const evidence = buildDeepModelEvidence({ stability: { dynamut2Status: "pending" } });
    // `engineStatus.ts`'s own rule: a pending remote engine that survives to this point still has a
    // route to a result, so the prompt is told it is running rather than missing.
    expect(observation(evidence, "dynamut2").state).toBe("running");
  });

  it("does not count a value the run excluded from its own consensus", () => {
    // FoldX after a failed repair: the number is shown for transparency and explicitly not counted.
    const evidence = buildDeepModelEvidence({
      stability: { foldingEnergetics: { foldxMean: 3.0, foldxRepairFailed: true } },
    });
    const foldx = observation(evidence, "foldx");
    expect(foldx.value).toBe(3.0);
    expect(foldx.call).toBe("Not counted");
    expect(foldx.note).toContain("excluded");
  });

  it("carries language-model provenance and refuses to invent a band for an LLR", () => {
    const evidence = buildDeepModelEvidence({
      evaluations: {
        esm2: { llr: -3.21, provenance: "ESM-2 650M (local)" },
        esmc: { llr: 0.42, provenance: "VESM-150M (cpu)" },
        saprot: { error: "sidecar unreachable", status: "timeout" },
        esm3: {
          structuralChangeLevel: "moderate",
          confidence: { level: "high", plddt: 82.14 },
          provenance: "ESM3-open",
        },
      },
    });

    const esm2 = observation(evidence, "esm2");
    expect(esm2.value).toBe(-3.21);
    expect(esm2.unit).toBe("ΔLLR");
    expect(esm2.provenance).toContain("ESM-2 650M");
    // No calibrated band exists for an LLR, so none is asserted.
    expect(esm2.call).toBeNull();

    // The ESMC card is served by a VESM fallback here: the payload says so rather than the card's own
    // calibration row being presented as the serving model.
    expect(observation(evidence, "esmc").note).toContain("calibration row");

    expect(observation(evidence, "saprot").state).toBe("upstream-busy");
    // The reason travels with the row, so the prompt is told WHY it produced nothing rather than being
    // left to infer a value for it.
    expect(observation(evidence, "saprot").note).toContain("sidecar unreachable");

    const esm3 = observation(evidence, "esm3");
    // A categorical drift band is not turned into a number.
    expect(esm3.value).toBeNull();
    expect(esm3.call).toBe("Moderate structural change");
    expect(esm3.note).toContain("confidence high");
    expect(esm3.note).toContain("pLDDT 82.1");
  });

  it("reports a model still loading as running, and one that failed as failed", () => {
    const evidence = buildDeepModelEvidence({
      evaluations: { esm2: { loading: true }, esmc: { error: "boom", status: "error" } },
    });
    expect(observation(evidence, "esm2").state).toBe("running");
    expect(observation(evidence, "esmc").state).toBe("failed");
  });

  /**
   * A failure placeholder OUTRANKS any score or category in the same payload.
   *
   * The projection consulted the value first, so a payload carrying BOTH a finite score and a failure
   * placeholder was reported as `computed` — an errored evaluation reached the prompt, and any telemetry
   * consumer reading the block saw a measurement. These are the mixed shapes that actually occur: a
   * score left beside a fresh error, and an error that closed after partial output.
   */
  it("drops the value and the call when a failure placeholder shares the payload", () => {
    const evidence = buildDeepModelEvidence({
      evaluations: {
        // A finite LLR beside an explicit error: no reading may be quoted.
        esm2: { llr: -4, error: "sidecar failed", status: "error" },
        // A categorical band beside an error: the call must go too, not just the state.
        esm3: {
          structuralChangeLevel: "moderate",
          confidence: { level: "high", plddt: 82.14 },
          provenance: "ESM3-open",
          error: "no perturbation scores returned",
          status: "error",
        },
      },
    });

    const esm2 = observation(evidence, "esm2");
    expect(esm2.state).toBe("failed");
    expect(esm2.value).toBeNull();
    expect(esm2.unit).toBeNull();
    expect(esm2.call).toBeNull();
    expect(esm2.note).toContain("sidecar failed");

    const esm3 = observation(evidence, "esm3");
    expect(esm3.state).toBe("failed");
    expect(esm3.value).toBeNull();
    expect(esm3.call, "a band beside an error is not a reading").toBeNull();
    expect(esm3.note).toContain("no perturbation scores returned");
    // An errored row does not claim which engine served it.
    expect(esm3.provenance).toBeNull();
  });

  it("classifies each placeholder from the endpoint's own vocabulary, and never as computed", () => {
    const cases: Array<[string, any, string]> = [
      ["timeout", { llr: -1.2, status: "timeout" }, "upstream-busy"],
      ["offline", { llr: -1.2, status: "offline" }, "not-installed"],
      ["token_required", { score: null, status: "token_required" }, "not-installed"],
      ["unavailable", { status: "unavailable" }, "not-installed"],
      ["invalid_input", { llr: 0.4, status: "invalid_input" }, "failed"],
      ["error without a status", { llr: 0.4, error: "HTTP 500" }, "failed"],
    ];

    for (const [label, payload, expected] of cases) {
      const esm2 = observation(buildDeepModelEvidence({ evaluations: { esm2: payload } }), "esm2");
      expect(esm2.state, label).toBe(expected);
      expect(esm2.value, label).toBeNull();
      expect(esm2.call, label).toBeNull();
      expect(esm2.note, label).toBeTruthy();
      // The ESM3 row reads the same vocabulary, because the server sends it that way.
      const esm3 = observation(buildDeepModelEvidence({ evaluations: { esm3: payload } }), "esm3");
      expect(esm3.state, `${label} (esm3)`).toBe(expected);
      expect(esm3.call, `${label} (esm3)`).toBeNull();
    }
  });

  it("keeps a fallback tier's note while keeping its real reading", () => {
    /*
     * The other side of the same rule: `hfError`/`remoteEngineNote`/`fallbackReason` describe WHICH tier
     * answered — `saprot.ts` returns them beside a computed `llr` — so mistaking them for failure
     * placeholders would discard a real reading. They travel as the row's note instead.
     */
    const evidence = buildDeepModelEvidence({
      evaluations: {
        saprot: { llr: -2.5, remoteEngineNote: "remote HF tier unavailable; local tier served", hfError: "HTTP 503" },
      },
    });
    const saprot = observation(evidence, "saprot");
    expect(saprot.state).toBe("computed");
    expect(saprot.value).toBe(-2.5);
    expect(saprot.note).toContain("local tier served");
  });
});

describe("deepModelEvidence — bounded and validated", () => {
  it("has one row per declared model, in the declared order", () => {
    const evidence = buildDeepModelEvidence({});
    expect(evidence.version).toBe(DEEP_MODEL_EVIDENCE_VERSION);
    expect(evidence.observations.map(o => o.id)).toEqual([...DEEP_EVIDENCE_MODEL_IDS]);
    expect(evidence.observations.every(o => o.source === DEEP_EVIDENCE_SOURCE_LABELS[o.id])).toBe(true);
  });

  it("truncates free text and refuses an implausible number", () => {
    const evidence = buildDeepModelEvidence({
      stability: {
        // Every ΔΔG engine's value lives in the energetics bag; the top level carries only the run's
        // lifecycle and the single-value FoldX fallback.
        foldingEnergetics: { foldx: 5000, thermompnn: Number.POSITIVE_INFINITY, foldxError: "x".repeat(2000) },
      },
    });
    const foldx = observation(evidence, "foldx");
    // |ΔΔG| > 1000 is not a reading of a stability model, so no value is carried.
    expect(foldx.value).toBeNull();
    expect(foldx.call).toBeNull();
    expect((foldx.note ?? "").length).toBeLessThanOrEqual(DEEP_EVIDENCE_BOUNDS.maxNoteChars);
    expect(observation(evidence, "thermompnn").value).toBeNull();
  });

  it("survives the server's trusted schema unchanged, and refuses what it does not describe", () => {
    const evidence = buildDeepModelEvidence({ stability: STABLE_RUN });
    /*
     * The WIRE form is the object payload; the canonical string is the compact hash input. This asserts
     * both: the payload validates against the route's schema, and the round trip preserves the exact
     * canonical string the client hashed — which is what makes the server's cache key and the client's
     * revision two views of one evidence set.
     */
    const parsed = deepModelEvidenceSchema.parse(JSON.parse(JSON.stringify(evidence)) as any);
    expect(parsed.version).toBe(DEEP_MODEL_EVIDENCE_VERSION);
    expect(parsed.observations).toHaveLength(evidence.observations.length);
    expect(canonicalDeepModelEvidence(parsed as any)).toBe(canonicalDeepModelEvidence(evidence));

    const row = evidence.observations[0];
    expect(deepModelEvidenceSchema.safeParse({ version: 1, observations: [{ ...row, id: "rosetta" }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: 1, observations: [{ ...row, state: "probably-fine" }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: 1, observations: [{ ...row, value: 1e5 }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: 1, observations: [{ ...row, note: "x".repeat(400) }] }).success).toBe(false);
    // A projection version the server has not learned is refused rather than paraphrased.
    expect(deepModelEvidenceSchema.safeParse({ version: 99, observations: [] }).success).toBe(false);
    // More rows than there are models: not a payload this app can produce.
    expect(
      deepModelEvidenceSchema.safeParse({
        version: 1,
        observations: Array.from({ length: DEEP_EVIDENCE_MODEL_IDS.length + 1 }, () => row),
      }).success
    ).toBe(false);
  });

  it("is canonical regardless of observation order", () => {
    const evidence = buildDeepModelEvidence({ stability: STABLE_RUN });
    const shuffled = { ...evidence, observations: [...evidence.observations].reverse() };
    expect(canonicalDeepModelEvidence(shuffled)).toBe(canonicalDeepModelEvidence(evidence));
  });
});

describe("deepModelEvidence — the prompt block", () => {
  it("renders values, provenance, status and the engines that returned nothing", () => {
    const block = deepEvidencePromptBlock(buildDeepModelEvidence({ stability: STABLE_RUN }))!;
    expect(block).toContain("[DEEP-MODEL COMPUTATIONAL OBSERVATIONS");
    expect(block).toContain("FoldX folding stability (ΔΔG): +2.62 kcal/mol");
    expect(block).toContain("DynaMut2 ΔΔG: +1.80 kcal/mol");
    expect(block).toContain("served by: Experimental structure");
    // The engines with no value are listed, so the model cannot infer one for them.
    expect(block).toContain("Returned nothing for this run");
    expect(block).toContain("StabilityOracle ΔΔG (no-result)");
  });

  it("states that these are predictions, not assays, and that they cannot create criteria", () => {
    const block = deepEvidencePromptBlock(buildDeepModelEvidence({ stability: STABLE_RUN }))!;
    expect(block).toMatch(/NOT functional assays/);
    expect(block).toMatch(/NEVER describe one as an assay/);
    expect(block).toMatch(/Do NOT add an ACMG\/AMP criterion/);
    expect(block).toMatch(/A predicted ΔΔG is not PS3 evidence/);
    expect(block).toMatch(/a predicted deleterious score is not PP3 evidence/);
    // The sign the model is shown is the canonical one, and the block says so.
    expect(block).toMatch(/POSITIVE value means/);
    expect(block).toMatch(/comparable only WITHIN one model/);
  });

  it("emits nothing when the run produced no deep-model reading", () => {
    /*
     * An empty block would tell the model it had been given deep evidence it does not have. A run where
     * nothing ran has no informative row, so the prompt is byte-identical to the pre-integration prompt
     * for that run.
     */
    expect(deepEvidencePromptBlock(buildDeepModelEvidence({}))).toBeNull();
    expect(deepEvidencePromptBlock(null)).toBeNull();
  });

  it("stays a bounded block", () => {
    const block = deepEvidencePromptBlock(buildDeepModelEvidence({ stability: STABLE_RUN }))!;
    // 10 rows plus the rules, bounded by construction — a prompt is not an unbounded payload.
    expect(block.length).toBeLessThan(4000);
  });
});

describe("deepModelEvidence — the two client paths agree on the supplement", () => {
  it("reads the store's biophysics state from either the slice or primaryBiophysics", () => {
    const fromSlice = deepEvidenceContextFromStore({
      foldingDdG: 2.15,
      foldingEnergetics: { foldx: 2.15 },
      dynamut2Status: "pending",
      isFolding: false,
    });
    const fromPrimary = deepEvidenceContextFromStore({
      primaryBiophysics: { foldingDdG: 2.15, foldingEnergetics: { foldx: 2.15 }, dynamut2Status: "pending" },
    });
    expect(fromSlice.stability?.foldingDdG).toBe(2.15);
    expect(fromPrimary.stability?.foldingDdG).toBe(2.15);
    expect(fromPrimary.stability?.dynamut2Status).toBe("pending");
    expect(fromSlice.stability?.foldingEnergetics).toEqual({ foldx: 2.15 });
  });

  it("reads a replayed result's own energetics, and an explicit supplement wins over it", () => {
    const replayed = deepEvidenceContextFromResult({
      foldingEnergetics: { foldx: 1.0 },
      metadata: { sequence: "MSTAVL" },
    });
    expect(replayed.stability?.foldingEnergetics).toEqual({ foldx: 1.0 });

    // The pipeline's own payload names the same things `energetics`/`ddG`.
    const pipeline = deepEvidenceContextFromResult({ energetics: { foldx: 3.0 }, ddG: 3.0 });
    expect(pipeline.stability?.foldingDdG).toBe(3.0);
    expect(pipeline.stability?.foldingEnergetics).toEqual({ foldx: 3.0 });

    const evidence = deepModelEvidenceFor({ energetics: { foldx: 3.0 } } as any, {
      stability: { foldingEnergetics: { foldx: 0.4 } },
    });
    expect(observation(evidence, "foldx").value).toBe(0.4);
  });
});

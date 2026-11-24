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
 * The load-bearing assertions here are (1) the SIGN of every ΔΔG is the canonical one (positive =
 * destabilizing), because the model reasons about the sign it is shown; (2) the payload is BOUNDED
 * and validated, because it is interpolated into a clinical prompt from a client-supplied request;
 * and (3) the prompt text states what these observations are and are not, including that no ACMG
 * criterion may be created from them.
 */

const STABLE_RUN: EnergeticsInputs = {
  foldingEnergetics: {
    foldx: 2.62,
    foldxSd: 0.1,
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
  thermompnnStatus: "done",
};

function observation(evidence: ReturnType<typeof buildDeepModelEvidence>, id: string) {
  const found = evidence.observations.find(entry => entry.id === id);
  expect(found, `${id} must have exactly one observation`).toBeDefined();
  return found!;
}

describe("deepModelEvidence — sign, provenance and status per model", () => {
  it("reports every ΔΔG in the canonical sign (positive = destabilizing)", () => {
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

    expect(observation(evidence, "thermompnn").value).toBe(1.2);
    expect(observation(evidence, "thermompnn").call).toBe("Destabilizing");
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
          stabilityoracleStatus: "busy",
        },
        foldingError: "FoldX binary not found",
        thermompnnStatus: "unavailable",
      },
    });

    const foldx = observation(evidence, "foldx");
    expect(foldx.state).toBe("failed");
    expect(foldx.note).toContain("FoldX binary not found");
    // A busy sidecar queue is retryable; an engine this deployment cannot run is not —
    // the distinction `absenceClass` exists for, carried into the prompt instead of "unavailable".
    expect(observation(evidence, "stabilityoracle").state).toBe("upstream-busy");
    expect(observation(evidence, "thermompnn").state).toBe("not-installed");
    // A RaSP miss is a statement about the dataset, and only the lookup's own answer may assert it.
    expect(observation(evidence, "rasp").state).toBe("not-covered");
  });

  it("reports a pending sidecar engine as running", () => {
    const evidence = buildDeepModelEvidence({ stability: { thermompnnStatus: "pending" } });
    expect(observation(evidence, "thermompnn").state).toBe("running");
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

  it("leaves out the retired language-model results a saved analysis still carries", () => {
    const saved = {
      esm2Eval: { llr: -3.21, provenance: "ESM-2 650M (local)" },
      esmcEval: { llr: 0.42, provenance: "VESM-150M (cpu)" },
      saprotEval: { llr: -2.5, provenance: "SaProt (SaProt_35M_AF2 - Remote)" },
      esm3Eval: { structuralChangeLevel: "moderate", provenance: "ESM3-Medium (Remote)" },
    };
    const evidence = deepModelEvidenceFor(saved);
    expect(evidence.observations.map(o => o.id)).toEqual([...DEEP_EVIDENCE_MODEL_IDS]);
    expect(JSON.stringify(evidence)).not.toMatch(/ESM|SaProt|VESM|ΔLLR/);
    expect(deepEvidencePromptBlock(evidence) ?? "").not.toMatch(/ESM|SaProt|VESM|ΔLLR/);
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
    expect(deepModelEvidenceSchema.safeParse({ version: DEEP_MODEL_EVIDENCE_VERSION, observations: [{ ...row, id: "rosetta" }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: DEEP_MODEL_EVIDENCE_VERSION, observations: [{ ...row, state: "probably-fine" }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: DEEP_MODEL_EVIDENCE_VERSION, observations: [{ ...row, value: 1e5 }] }).success).toBe(false);
    expect(deepModelEvidenceSchema.safeParse({ version: DEEP_MODEL_EVIDENCE_VERSION, observations: [{ ...row, note: "x".repeat(400) }] }).success).toBe(false);
    // A projection version the server has not learned is refused rather than paraphrased.
    expect(deepModelEvidenceSchema.safeParse({ version: 99, observations: [] }).success).toBe(false);
    // More rows than there are models: not a payload this app can produce.
    expect(
      deepModelEvidenceSchema.safeParse({
        version: DEEP_MODEL_EVIDENCE_VERSION,
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
    expect(block).toContain("ThermoMPNN ΔΔG: +1.20 kcal/mol");
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
    expect(block.length).toBeLessThan(4000);
  });
});

describe("deepModelEvidence — the two client paths agree on the supplement", () => {
  it("reads the store's biophysics state from either the slice or primaryBiophysics", () => {
    const fromSlice = deepEvidenceContextFromStore({
      foldingDdG: 2.15,
      foldingEnergetics: { foldx: 2.15 },
      thermompnnStatus: "pending",
      isFolding: false,
    });
    const fromPrimary = deepEvidenceContextFromStore({
      primaryBiophysics: { foldingDdG: 2.15, foldingEnergetics: { foldx: 2.15 }, thermompnnStatus: "pending" },
    });
    expect(fromSlice.stability?.foldingDdG).toBe(2.15);
    expect(fromPrimary.stability?.foldingDdG).toBe(2.15);
    expect(fromPrimary.stability?.thermompnnStatus).toBe("pending");
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

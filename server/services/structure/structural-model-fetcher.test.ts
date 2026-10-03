import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchStructuralModelData, isPdbMappingCompatibleWithContext } from "./structural-model-fetcher.ts";
import type { ParsedVariantContext } from "../../routes/variant/variant-parser.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRUCTURAL STAGE — status namespace, race budgets, structure reuse
 * ─────────────────────────────────────────────────────────────────────────────
 * Three defects lived here, each invisible from the outside until a surface disagreed with itself:
 *
 *  1. the ESM-2 650M outcome was reported under `serviceStatus.esm2`, the key the CORE run uses for
 *     its VESM-150M evaluation, so merging the two maps replaced a measured core source;
 *  2. each model raced a fresh timer that was never cleared;
 *  3. a handed-down `pdbMapping` was used whatever it contained, including one resolved for another
 *     position (or an explicit `null`, which skipped the lookup entirely).
 */
vi.mock("../external.ts", () => ({
  fetchBestPdbStructure: vi.fn(async () => ({ pdbId: "2pah", chainId: "A", shift: 0, unpStart: 1, structStart: 1 })),
  fetchAlphafoldPdb: vi.fn(async () => "ATOM      1  N   MET A   1\n"),
  fetchPdbFromRcsb: vi.fn(async () => "ATOM      1  N   MET A   1\n")
}));

vi.mock("../external-api/esm3_forge.ts", () => ({
  fetchEsm3StructureEval: vi.fn(async () => ({ structuralChangeLevel: "minor", provenance: "ESM3-Medium (Remote)" }))
}));

vi.mock("../external-api/esmc.ts", () => ({
  runEsmcAnalysis: vi.fn(async () => ({ score: -2.1, provenance: "ESMC-6B (JapanFold)" }))
}));

vi.mock("../external-api/esm2.ts", () => ({
  runEsm2Analysis: vi.fn(async () => ({ score: -3.8, provenance: "ESM-2 (esm2_t33_650M_UR50D)" }))
}));

vi.mock("../external-api/saprot.ts", () => ({
  runSaprotAnalysis: vi.fn(async () => ({ score: -1.9, provenance: "SaProt (SaProt_650M_AF2)" }))
}));

const baseContext: ParsedVariantContext = {
  gene: "PAH",
  variant: "p.Arg408Trp",
  uniprotId: "P00439",
  originalNotation: "p.Arg408Trp",
  acmgWeighting: "standard",
  sequence: "MKVLIVGLGNCGVFSLLDKN",
  pos: 408,
  residueIndex: "408",
  wildType: "Arg",
  mutant: "Trp",
  wt1Letter: "R",
  mut1Letter: "W"
};

describe("isPdbMappingCompatibleWithContext", () => {
  it("accepts a mapping whose UniProt numbering can contain the residue", () => {
    expect(
      isPdbMappingCompatibleWithContext({ pdbId: "2pah", chainId: "A", shift: 0, unpStart: 1, structStart: 1 }, { pos: 408 })
    ).toBe(true);
  });

  it("refuses a mapping numbered past the residue, a corrupt shift, and an unknown position", () => {
    expect(
      isPdbMappingCompatibleWithContext({ pdbId: "2pah", chainId: "A", shift: 0, unpStart: 900, structStart: 1 }, { pos: 408 }),
      "a structure whose numbering starts at 900 cannot contain residue 408"
    ).toBe(false);

    expect(
      isPdbMappingCompatibleWithContext({ pdbId: "2pah", chainId: "A", shift: 5, unpStart: 100, structStart: 1 }, { pos: 408 }),
      "the retained shift must equal unpStart - structStart, or every residue number is mislabelled"
    ).toBe(false);

    expect(isPdbMappingCompatibleWithContext({ pdbId: "2pah", chainId: "A", shift: 0, unpStart: 1, structStart: 1 }, {})).toBe(false);
    expect(isPdbMappingCompatibleWithContext(null, { pos: 408 })).toBe(false);
  });

  it("falls back to the context's residueIndex when no numeric position is carried", () => {
    // `shift` must equal unpStart - structStart, so these fixtures are internally consistent
    // (400 - 1 = 399). The only property under test is whether the residue is covered.
    const mapping = { pdbId: "2pah", chainId: "A", shift: 399, unpStart: 400, structStart: 1 };
    expect(isPdbMappingCompatibleWithContext(mapping, { residueIndex: "408" })).toBe(true);
    expect(isPdbMappingCompatibleWithContext(mapping, { residueIndex: "300" })).toBe(false);
  });
});

describe("fetchStructuralModelData", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the structural ESM-2 outcome under esm2Eval, never under the core's esm2", async () => {
    const result = await fetchStructuralModelData(baseContext, null, null, 5_000);

    expect(result.serviceStatus).toMatchObject({ esm3: "ok", esmc: "ok", esm2Eval: "ok", saprot: "ok" });
    expect("esm2" in (result.serviceStatus as any)).toBe(false);
  });

  it("uses a compatible handed-down mapping without resolving the structure again", async () => {
    const { fetchBestPdbStructure } = await import("../external.ts");
    vi.mocked(fetchBestPdbStructure).mockClear();

    const mapping = { pdbId: "2pah", chainId: "A", shift: 0, unpStart: 1, structStart: 1 };
    const result = await fetchStructuralModelData(baseContext, null, null, 5_000, { pdbMapping: mapping });

    expect(fetchBestPdbStructure).not.toHaveBeenCalled();
    expect(result.pdbMapping).toEqual(mapping);
  });

  it("re-resolves the structure when the handed-down mapping cannot contain this residue", async () => {
    const { fetchBestPdbStructure, fetchPdbFromRcsb } = await import("../external.ts");
    vi.mocked(fetchBestPdbStructure).mockClear();
    vi.mocked(fetchPdbFromRcsb).mockClear();

    const stale = { pdbId: "1xyz", chainId: "B", shift: 0, unpStart: 900, structStart: 1 };
    const result = await fetchStructuralModelData(baseContext, null, null, 5_000, { pdbMapping: stale });

    expect(fetchBestPdbStructure, "an unusable mapping must not be taken as final").toHaveBeenCalledWith("P00439", 408);
    expect(result.pdbMapping?.pdbId).toBe("2pah");
    expect(fetchPdbFromRcsb).toHaveBeenCalled();
  });

  it("re-resolves the structure when a caller hands down an explicit null", async () => {
    const { fetchBestPdbStructure } = await import("../external.ts");
    vi.mocked(fetchBestPdbStructure).mockClear();

    await fetchStructuralModelData(baseContext, null, null, 5_000, { pdbMapping: null });

    expect(
      fetchBestPdbStructure,
      "`null` used to mean 'there is no mapping', which skipped the lookup and demoted the run to AlphaFold"
    ).toHaveBeenCalled();
  });

  it("leaves no armed race timer behind, and turns an expiring budget into a timeout status", async () => {
    const { runEsm2Analysis } = await import("../external-api/esm2.ts");
    vi.mocked(runEsm2Analysis as any).mockImplementationOnce(() => new Promise(() => {}));

    vi.useFakeTimers();
    const run = fetchStructuralModelData(baseContext, null, null, 50);
    await vi.advanceTimersByTimeAsync(60);
    const result = await run;

    expect(result.esm2Eval).toMatchObject({ status: "timeout" });
    expect(result.serviceStatus?.esm2Eval).toBe("timeout");
    // The other three models still answered, so the stage is degraded, not blank.
    expect(result.degraded).toBe(true);
    // A timed-out model is still reported: the span the run waited for it is bounded by the budget.
    expect(result.structuralTimings?.esm2Eval).toBeLessThanOrEqual(50);
    expect(typeof result.structuralTimingOffsets?.esm2Eval).toBe("number");
    expect(vi.getTimerCount(), "every budget timer must be cleared once its model has settled").toBe(0);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * PER-MODEL SPANS — the thing the parent HTTP span cannot express
   * ─────────────────────────────────────────────────────────────────────────────
   * Without these, a consumer has one span for the whole request and reports it as successful as long
   * as the route answered — including a run where all four models were unavailable. These tests pin
   * that a span exists per model, is keyed like the outcome it belongs to, and is MEASURED (a model
   * that took longer is reported as taking longer).
   */
  it("reports a span per model, keyed exactly like the outcomes it pairs with", async () => {
    const result = await fetchStructuralModelData(baseContext, null, null, 5_000);

    const statusKeys = Object.keys(result.serviceStatus || {}).sort();
    const timingKeys = Object.keys(result.structuralTimings || {}).filter(key => key !== "pdbText").sort();
    expect(timingKeys).toEqual(statusKeys);

    for (const key of Object.keys(result.structuralTimings || {})) {
      expect(typeof result.structuralTimings![key]).toBe("number");
      expect(result.structuralTimings![key]).toBeGreaterThanOrEqual(0);
      expect(typeof result.structuralTimingOffsets![key]).toBe("number");
      // A source cannot settle before it started: the offset is at least the duration it reported.
      expect(result.structuralTimingOffsets![key] + 1).toBeGreaterThanOrEqual(result.structuralTimings![key]);
    }
  });

  it("measures each model's OWN span rather than reusing one number", async () => {
    const { runEsmcAnalysis } = await import("../external-api/esmc.ts");
    vi.mocked(runEsmcAnalysis as any).mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return { score: -2.1 };
    });

    const result = await fetchStructuralModelData(baseContext, null, null, 5_000);

    // ESMC really waited ~40 ms in this test; the others answered from their mocks immediately.
    expect(result.structuralTimings!.esmc).toBeGreaterThanOrEqual(35);
    expect(result.structuralTimings!.esm3).toBeLessThan(result.structuralTimings!.esmc);
    expect(result.structuralTimingOffsets!.esmc).toBeGreaterThanOrEqual(35);
    // ...and the offsets are positions on ONE clock, not the same number copied four times.
    const offsets = ["esm3", "esmc", "esm2Eval", "saprot"].map(key => result.structuralTimingOffsets![key]);
    expect(offsets.every(offset => typeof offset === "number")).toBe(true);
  });
});

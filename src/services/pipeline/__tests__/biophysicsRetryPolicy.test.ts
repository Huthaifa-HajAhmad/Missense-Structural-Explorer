import { describe, expect, it } from "vitest";
import { shouldRunBiophysics } from "../biophysicsRetryPolicy";
import { BIOPHYSICS_RETRY_COOLDOWN_MS } from "../../../shared/timeouts";

const now = 100000000;
const healthy = { mutantPdb: "ATOM", foldingStatus: "success", foldingEnergetics: { foldx: 0 } } as any;
describe("shared biophysics retry policy", () => {
  it("does not repeat a healthy snapshot or retry a missing local sidecar", () => {
    expect(shouldRunBiophysics(healthy, null, now)).toBe(false);
    expect(shouldRunBiophysics({ ...healthy, thermompnnStatus: "unavailable" }, null, now)).toBe(false);
  });
  it("refreshes only admitted repairs inside their window and behind the existing cooldown", () => {
    const energetics = { foldx: 0.5761, foldxRepairSkipped: true };
    const provisional = { ...healthy, foldingEnergetics: energetics };
    expect(shouldRunBiophysics(provisional, null, now)).toBe(false);
    const admitted = { ...provisional, foldingEnergetics: { ...energetics, foldxRepairRefresh: { after: now, until: now + 60_000 } } };
    expect(shouldRunBiophysics(admitted, null, now - 1)).toBe(false);
    expect(shouldRunBiophysics(admitted, null, now)).toBe(true);
    expect(shouldRunBiophysics(admitted, now - 1, now)).toBe(false);
    expect(shouldRunBiophysics(admitted, null, now + 60_000)).toBe(false);
  });

  it("does not consider empty or non-finite energetics healthy", () => {
    expect(shouldRunBiophysics({ ...healthy, foldingEnergetics: {} }, null, now)).toBe(true);
    expect(shouldRunBiophysics({ ...healthy, foldingEnergetics: { foldx: NaN } }, null, now)).toBe(true);
  });
  it("does not retry a structurally impossible repair failure, but retries other FoldX or ThermoMPNN failures after cooldown", () => {
    const repairFailed = { ...healthy, foldingStatus: "failed", foldingEnergetics: { foldxRepairFailed: true } };
    expect(shouldRunBiophysics(repairFailed, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(false);
    expect(shouldRunBiophysics({ ...repairFailed, thermompnnStatus: "error" }, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(true);
    const crashed = { ...healthy, foldingStatus: "failed", foldingEnergetics: { foldx: null } };
    expect(shouldRunBiophysics(crashed, now - BIOPHYSICS_RETRY_COOLDOWN_MS, now)).toBe(false);
    expect(shouldRunBiophysics(crashed, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(true);
  });
  it("re-runs after the cooldown when StabilityOracle timed out, but not when it rejected the structure", () => {
    // Test container: with the model service paused, StabilityOracle timed out while FoldX succeeded;
    // its message asked for another run, but a healthy FoldX snapshot meant another run did nothing.
    const later = now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1;
    const timedOut = { ...healthy, foldingEnergetics: { foldx: 0, stabilityoracleStatus: "error",
      stabilityoracleError: "StabilityOracle did not answer within 180 s. The model service may be busy. Please run the analysis again." } };
    expect(shouldRunBiophysics(timedOut, later, now)).toBe(true);
    expect(shouldRunBiophysics(timedOut, now - 1, now)).toBe(false);
    const rejected = { ...healthy, foldingEnergetics: { foldx: 0, stabilityoracleStatus: "error",
      stabilityoracleError: "StabilityOracle rejected this query: PDB2PQR could not add hydrogens to this chain." } };
    expect(shouldRunBiophysics(rejected, later, now)).toBe(false);
  });

  it("applies cooldown even when a failed attempt could not save a snapshot", () => {
    expect(shouldRunBiophysics(null, now - 1, now)).toBe(false);
    expect(shouldRunBiophysics(null, null, now)).toBe(true);
  });
  it("does not let a missing FoldX binary permanently suppress retryable companion engines", () => {
    const snapshot = { ...healthy, foldingEnergetics: { foldxBinaryMissing: true } };
    expect(shouldRunBiophysics(snapshot, null, now)).toBe(false);
    expect(shouldRunBiophysics({ ...snapshot, thermompnnStatus: "error" }, null, now)).toBe(true);
    expect(shouldRunBiophysics({ ...snapshot, thermompnnStatus: "busy" }, null, now)).toBe(true);
  });
});

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
  it("does not consider empty or non-finite energetics healthy", () => {
    expect(shouldRunBiophysics({ ...healthy, foldingEnergetics: {} }, null, now)).toBe(true);
    expect(shouldRunBiophysics({ ...healthy, foldingEnergetics: { foldx: NaN } }, null, now)).toBe(true);
  });
  it("does not retry a structurally impossible repair failure, but retries other FoldX failures after cooldown", () => {
    const repairFailed = { ...healthy, foldingStatus: "failed", foldingEnergetics: { foldxRepairFailed: true } };
    expect(shouldRunBiophysics(repairFailed, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(false);
    expect(shouldRunBiophysics({ ...repairFailed, ddmutStatus: "error" }, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(true);
    const crashed = { ...healthy, foldingStatus: "failed", foldingEnergetics: { foldx: null } };
    expect(shouldRunBiophysics(crashed, now - BIOPHYSICS_RETRY_COOLDOWN_MS, now)).toBe(false);
    expect(shouldRunBiophysics(crashed, now - BIOPHYSICS_RETRY_COOLDOWN_MS - 1, now)).toBe(true);
  });
  it("applies cooldown even when a failed attempt could not save a snapshot", () => {
    expect(shouldRunBiophysics(null, now - 1, now)).toBe(false);
    expect(shouldRunBiophysics(null, null, now)).toBe(true);
  });
  it("does not let a missing FoldX binary permanently suppress retryable remote engines", () => {
    const snapshot = { ...healthy, foldingEnergetics: { foldxBinaryMissing: true } };
    expect(shouldRunBiophysics(snapshot, null, now)).toBe(false);
    expect(shouldRunBiophysics({ ...snapshot, ddmutStatus: "unavailable" }, null, now)).toBe(true);
  });
});

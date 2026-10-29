import { BIOPHYSICS_RETRY_COOLDOWN_MS } from "../../shared/timeouts";
import type { CachedVariantBundle } from "./variantCache";

export function shouldRunBiophysics(snapshot: CachedVariantBundle | null | undefined, attemptedAt: number | null, now = Date.now()): boolean {
  if (attemptedAt !== null && now - attemptedAt <= BIOPHYSICS_RETRY_COOLDOWN_MS) return false;
  const remoteFailure = [snapshot?.dynamut2Status, snapshot?.ddmutStatus]
    .some(status => status === "error" || status === "unavailable" || status === "failed") || snapshot?.thermompnnStatus === "error";
  // FoldX that cannot run here (no binary, failed repair) is not fixed by another attempt; only a
  // transient remote-engine failure justifies re-dispatching the run.
  const foldxStructurallyUnavailable = Boolean(snapshot?.foldingEnergetics?.foldxBinaryMissing || snapshot?.foldingEnergetics?.foldxRepairFailed);
  if (foldxStructurallyUnavailable && !remoteFailure) return false;
  const foldx = snapshot?.foldingEnergetics?.foldxMean ?? snapshot?.foldingEnergetics?.foldx;
  const healthy = Boolean(snapshot?.mutantPdb && typeof foldx === "number" && Number.isFinite(foldx) && snapshot?.foldingStatus === "success");
  const refresh = snapshot?.foldingEnergetics?.foldxRepairRefresh;
  // Only the server can say that background repair was admitted. Keep the disclosed provisional
  // result visible, and bound solver-only refreshes by both the existing cooldown and a deadline.
  const repairRefreshDue = snapshot?.foldingEnergetics?.foldxRepairSkipped && refresh &&
    now >= refresh.after && now < refresh.until;
  return !healthy || remoteFailure || Boolean(repairRefreshDue);
}

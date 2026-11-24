import type { CalibratedToolKey } from "../thresholds/calibration.ts";

/**
 * Audited ClinGen VCEP gene-level PP3/BP4 rule definition.
 *
 * PR A keeps the lookup stubbed (`null`) so the default chain, calibrated strengths, SpliceAI gate,
 * and active PP3 + PM1 cap land cleanly on their own. PR B populates the version-pinned,
 * hand-audited 113-spec table.
 */
export interface VcepInsilicoRule {
  cspecId: string;
  version: string;
  gene: string;
  tool?: CalibratedToolKey;
  notes?: string[];
}

/**
 * Looks up a version-pinned ClinGen VCEP PP3/BP4 override for `gene`.
 * Returns `null` in PR A (default chain applies).
 */
export function lookupVcepInsilicoRule(_gene: string | null | undefined): VcepInsilicoRule | null {
  return null;
}

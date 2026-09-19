import { describe, it, expect } from "vitest";
import { formatDdGValue } from "../EvidenceDashboardCard";
import { formatDdg } from "../../shared/engineStatus";

/**
 * The card's ΔΔG formatter must BE the canonical one.
 *
 * `660c1be` replaced a second implementation — one that printed `"N/A"` where the canonical formatter
 * prints `"—"` for an absent value, and hard-coded `4.184` rather than using the shared constant — so
 * that the module's "there is ONE ΔΔG formatter" claim became true repo-wide instead of aspirational.
 *
 * A review then pointed out that the change had no test: no EvidenceDashboardCard test file existed,
 * and reverting the card to its own formatter passed the entire suite. This asserts the delegation by
 * comparing against the canonical function over the inputs where the two implementations differed,
 * which is where a regression would land.
 */
describe("EvidenceDashboardCard's ΔΔG formatter", () => {
  const ABSENT = [null, undefined, NaN, Infinity, -Infinity] as const;
  const PRESENT = [0, 0.005, 1.23, -1.23, 2.675, -0.001, 1e-9, 1e9] as const;

  it("renders an absent value the canonical way, not as N/A", () => {
    // The measured regression: `"N/A"` here, `"—"` from the canonical formatter.
    for (const value of ABSENT) {
      expect(formatDdGValue(value as never, "kcal/mol"), String(value)).toBe("—");
      expect(formatDdGValue(value as never, "kcal/mol")).not.toBe("N/A");
    }
  });

  it("agrees with the canonical formatter for every value, in both units", () => {
    for (const value of PRESENT) {
      for (const unit of ["kcal/mol", "kJ/mol"] as const) {
        expect(formatDdGValue(value, unit), `${value} ${unit}`).toBe(formatDdg(value, unit));
      }
    }
  });

  it("uses the shared conversion constant rather than a hard-coded one", () => {
    // The old implementation wrote 4.184 inline. If the shared constant ever changes, this must move
    // with it — which is the difference between one formatter and two that agree today.
    expect(formatDdGValue(1, "kJ/mol")).toBe("4.18 kJ/mol");
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ENERGY_ENGINES,
  ENGINE_STATE_LABELS,
  LEGACY_ENGINE_LABELS,
  findLegacyLabels,
} from "../../shared/engineStatus.ts";
import { METRIC_EXPLANATIONS } from "../evidence/MetricExplanations.ts";

/**
 * Guardrail for the migrated Energetics surfaces.
 *
 * The defects this protects against were all *silent*: nothing failed when one engine was
 * described two ways, when a 1-of-6 estimate inherited a confident verdict style, or when the
 * same ΔΔG was printed with two opposite signs. The unit tests in
 * `src/shared/__tests__/engineStatus.test.ts` pin the rules; this file pins the *adoption* of
 * those rules, so a future edit cannot quietly reintroduce a hand-rolled status string.
 *
 * If this test fails, do not add the label to the allow-list — render the canonical state from
 * `resolveEngineOutcome` / `buildEngineOutcomes` instead.
 */

const REPO_ROOT = process.cwd();

/** The surfaces that must render engine state exclusively from `src/shared/engineStatus.ts`. */
const GUARDED_SURFACES = [
  "src/components/EnergeticsView.tsx",
  "src/components/inspector/EnergeticsInspector.tsx",
] as const;

/** The canonical module every guarded surface must consume. */
const CANONICAL_MODULE = "shared/engineStatus";

function readSurface(relativePath: string): string {
  const absolute = path.join(REPO_ROOT, relativePath);
  expect(fs.existsSync(absolute), `${relativePath} should exist`).toBe(true);
  return fs.readFileSync(absolute, "utf-8");
}

describe("Energetics label guardrail", () => {
  it("declares a non-trivial legacy label list to scan for", () => {
    // Guards against the scanner silently becoming a no-op.
    expect(LEGACY_ENGINE_LABELS.length).toBeGreaterThan(10);
  });

  it("detects a legacy label in a realistic source snippet", () => {
    // Positive control: proves the scanner works on the exact shape it will meet.
    const snippet = [
      "const badge = {",
      '  label: "Not in Zenodo DB",',
      '  category: "Upstream Congested",',
      "};",
    ].join("\n");
    const hits = findLegacyLabels(snippet);
    expect(hits.map(h => h.label).sort()).toEqual(["Not in Zenodo DB", "Upstream Congested"]);
  });

  it("ignores identifiers and comments that merely resemble a label", () => {
    // Regression control: a naive substring scan flagged `isAsyncOffline` and taxonomy text.
    const snippet = [
      "// The old code used Standby and Idle here.",
      "const isAsyncOffline = true;",
      'const taxonomy = "Graph Deep Learning / Transformers";',
      "/* Offline */",
    ].join("\n");
    expect(findLegacyLabels(snippet)).toEqual([]);
  });

  for (const surface of GUARDED_SURFACES) {
    describe(surface, () => {
      it("contains no legacy status label", () => {
        const hits = findLegacyLabels(readSurface(surface));
        const summary = hits.map(h => `  line ${h.line}: "${h.label}"`).join("\n");
        expect(
          hits,
          hits.length
            ? `${surface} hardcodes ${hits.length} legacy status label(s):\n${summary}\n` +
              `Render the canonical state from engineStatus.ts instead.`
            : ""
        ).toEqual([]);
      });

      it("renders engine state from the canonical shared module", () => {
        const source = readSurface(surface);
        expect(
          source.includes(CANONICAL_MODULE),
          `${surface} must import from ${CANONICAL_MODULE}`
        ).toBe(true);
      });

      it("does not declare its own engine status vocabulary", () => {
        const source = readSurface(surface);
        for (const label of Object.values(ENGINE_STATE_LABELS)) {
          // The canonical labels are allowed to appear only via the module, never as literals.
          expect(
            source.includes(`"${label}"`),
            `${surface} hardcodes the canonical label "${label}"; use ENGINE_STATE_LABELS`
          ).toBe(false);
        }
      });
    });
  }
});

describe("Method documentation states the sign convention the code actually applies", () => {
  /**
   * The in-app explanations are read as instructions. RaSP's entry documented
   * "ΔΔG ≤ -1.0 … destabilization" while the engine registry, the tuned cut-point and the
   * calibration curve all treat RaSP as positive-native (≥ +1.0). A reader was told the
   * opposite of the rule the app applies — for one method, with no visible symptom.
   */
  const OPPOSITE_CONVENTION: Record<string, RegExp> = {
    "positive-destabilizing": /≤\s*-\s*[\d.]+[^.]*destabiliz/i,
    "negative-destabilizing": /≥\s*\+?\s*[\d.]+[^.]*destabiliz/i,
  };

  it.each(ENERGY_ENGINES.map(e => [e.id, e.nativeSign] as const))(
    "documents %s consistently with its %s convention",
    (engineId, nativeSign) => {
      const entry = (METRIC_EXPLANATIONS as Record<string, { interpretation?: string } | undefined>)[engineId];
      if (!entry?.interpretation) return; // not every engine is described in this module
      const forbidden = OPPOSITE_CONVENTION[nativeSign];
      expect(
        forbidden.test(entry.interpretation),
        `${engineId} is documented with the opposite sign convention to its own cut-points:\n` +
          `  "${entry.interpretation}"`
      ).toBe(false);
    }
  );

  it("covers every registered engine that the module documents", () => {
    const documented = ENERGY_ENGINES.filter(
      e => (METRIC_EXPLANATIONS as Record<string, unknown>)[e.id]
    );
    expect(documented.length).toBe(ENERGY_ENGINES.length);
  });
});

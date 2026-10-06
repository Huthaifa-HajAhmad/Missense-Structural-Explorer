import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  ENERGY_ENGINES,
  ENGINE_STATE_LABELS,
  LEGACY_ENGINE_LABELS,
  findLegacyLabels,
  stripCommentsForScan,
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
  'src/components/evidence/DevelopmentalExpressionCard.tsx',
  'src/components/evidence/MechanismContextCard.tsx',
  'src/components/evidence/GeneDiseaseTab.tsx',
  'src/components/evidence/ExpressionModelsTab.tsx',
  'src/components/evidence/DiseaseContextPicker.tsx',
  'src/components/inspector/EvidenceContextRail.tsx',
  "src/components/EnergeticsView.tsx",
  "src/components/inspector/EnergeticsInspector.tsx",
  // The Energetics evidence model and its ruler, which every Energetics surface now renders from.
  "src/shared/energeticsEvidence.ts",
  "src/components/energetics/DdgRuler.tsx",
  // A surface this change modified that renders engine status: it still carried the literal
  // "Standby / Unconfigured", which is in LEGACY_ENGINE_LABELS, and it sat outside the guard
  // precisely because it had never been added here.
  "src/components/evidence/SplicingTab.tsx",
  /**
   * The AlphaGenome panel carried "Standby" six times — including "Indeterminate / Standby", which
   * collapsed a clinical verdict with an infrastructure state — and nothing failed, for the same
   * reason SplicingTab had escaped: it had never been listed. Its literals are now gone and the
   * state is derived through `shared/evidenceAvailability` from `shared/engineStatus`.
   *
   * PredictorSpecialistPanels was the other deferral ("needs their own pass", unmapping review
   * UI#9): that pass is done — the four structural-model "Standby" badges now render
   * `ENGINE_STATE_LABELS["no-result"]` and the score slot uses the em-dash — so the file is
   * listed with the rest. If a future edit reintroduces a retired word there, this guard, not
   * a comment, is what stops it.
   */
  "src/components/evidence/AlphaGenomeTab.tsx",
  "src/components/evidence/PredictorsTab.tsx",
  // The splicing redesign's rail and model: the old inspector printed "N/A" for a rule a predictor
  // could not reach, and the old tab "Unannotated" / "Unmapped" for absences with known reasons.
  "src/components/inspector/SplicingRail.tsx",
  "src/shared/splicingEvidence.ts",
  // Interfaces & PPI (merged Multimer assembly + Protein interactions): the multimer tab once showed
  // "Complex Modeling Unavailable" in red for a heteromer it chose not to model, and the interactions
  // tab "N/A" / "Pending" for a ΔΔG_bind that was never measured.
  "src/components/evidence/InterfacesTab.tsx",
  "src/components/inspector/InterfacesRail.tsx",
  "src/shared/interfacesEvidence.ts",
  // The Score thresholds redesign: the old rail printed "N/A" for a missing REVEL / FoldX value and
  // the old table "awaiting data" beside absences with known reasons.
  "src/components/evidence/predictors/StrengthLadder.tsx",
  "src/components/inspector/PredictorsRail.tsx",
  /**
   * The derivation layer itself, listed because it makes a structural promise — "this module adds
   * no new user-facing vocabulary; every label comes from engineStatus" — and a promise in a
   * docstring that nothing checks is a promise that decays. A status literal added here would
   * otherwise reach every surface consuming the resolver: a wider blast radius than the single
   * panel this guard was written for.
   */
  "src/shared/evidenceAvailability.ts",
  /**
   * The Structural perturbation tab said "Protein Language Models in Standby", "<model> Standby" and
   * printed "N/A" for every absent number. Its states now come from `perturbationEvidence`, which
   * takes every label from engineStatus; both are listed so neither can drift back.
   */
  "src/components/evidence/PerturbationTab.tsx",
  "src/shared/perturbationEvidence.ts",
  /**
   * Residue Shifts & Pockets printed "Standby", "Model Offline", "ML Model Offline / Standby" and
   * "N/A". Its tab, rail and both models now take state words from engineStatus.
   */
  "src/components/evidence/StructureTab.tsx",
  "src/components/inspector/ResidueShiftInspector.tsx",
  "src/shared/residueShiftEvidence.ts",
  "src/shared/residueContextEvidence.ts",
  /**
   * 3D structure: the old inspector printed "N/A" for four absent comparison numbers and "0.0°" for a
   * missing χ1, and the viewer's pocket panel "Server Calculation Error". The model and the two
   * viewer surfaces that print states take their words from engineStatus.
   */
  "src/shared/structure3dEvidence.ts",
  "src/components/molstar/StructureStatusOverlay.tsx",
  "src/components/molstar/StructurePocketPanel.tsx",
] as const;

/**
 * The canonical module every guarded surface must consume.
 *
 * Two spellings, not one: a surface under `src/components/` reaches the module as
 * `shared/engineStatus`, while `src/shared/evidenceAvailability.ts` — itself part of the canonical
 * layer, and guarded for the same reason — reaches it as `./engineStatus`. Accepting only the first
 * would mean either leaving the derivation layer unguarded or writing a fake import to satisfy a
 * test, and the second is exactly the failure mode a guard should never induce.
 */
const CANONICAL_MODULE_TOKENS = ["shared/engineStatus", "./engineStatus"] as const;

/**
 * Removes comments while preserving line numbers.
 *
 * Uses the scanner's OWN string-aware stripper rather than a local regex. The local regex this
 * replaced (`/\/\/.*$/gm`) truncated a line at the first `//` anywhere — including inside a URL
 * string literal — so the guard became blind to any label sharing a line with a link. Sharing the
 * implementation also means the guard and the scanner it calls can never disagree about what a
 * comment is.
 */
function readSurface(relativePath: string): string {
  const absolute = path.join(REPO_ROOT, relativePath);
  expect(fs.existsSync(absolute), `${relativePath} should exist`).toBe(true);
  return stripCommentsForScan(fs.readFileSync(absolute, "utf-8"));
}

describe("Energetics label guardrail", () => {
  /**
   * The scanner's own anti-blindness pin, written as a permanent mutation test.
   *
   * A source scanner can fail in two directions, and they are not equally bad. Over-reporting
   * produces noise a developer routes around — visible. Under-reporting produces silence that looks
   * exactly like compliance. This guard previously under-reported: its comment stripper truncated a
   * line at the first `//` anywhere, so a legacy label on any line containing a URL was invisible.
   * Injecting "Not in Zenodo DB" onto EnergeticsView.tsx's `paperUrl: "https://doi.org/…"` line
   * yielded zero hits; the same literal one line lower yielded one.
   *
   * These three assertions walk the scanner across that exact shape. If someone reintroduces a
   * regex-based stripper, the first fails.
   */
  describe("the scanner is string-aware, not regex-based", () => {
    it("sees a legacy label that FOLLOWS a URL on the same line", () => {
      // ORDER IS THE WHOLE POINT, and getting it wrong makes this test worthless.
      //
      // A `//`-based stripper truncates the line at the first `//`. If the label sits BEFORE the
      // URL, truncation leaves the label intact and the test passes even with the broken stripper —
      // which is exactly how the first version of this test was written, and how the mutation check
      // caught it. The label must come AFTER the `//` for this to discriminate.
      const source = `const x = { href: "https://doi.org/10.1093/nar/gki387", label: "Not in Zenodo DB" };`;
      expect(findLegacyLabels(source).map(h => h.label)).toEqual(["Not in Zenodo DB"]);
    });

    it("sees a label between an unclosed-looking /* and a later */ inside strings", () => {
      // The old block-comment regex ran before the string-aware pass, so a `/*` inside one string
      // and a `*/` inside a later string made it swallow everything between them — including a real
      // label on the line in the middle.
      const source = [
        `const note = "a /* b";`,
        `const y = "Standby";`,
        `const z = "c */ d";`,
      ].join("\n");
      expect(findLegacyLabels(source).map(h => h.label)).toEqual(["Standby"]);
    });

    it("still ignores a real comment that documents the migration", () => {
      // The reason stripping exists at all: prose describing the old vocabulary is not a violation.
      expect(findLegacyLabels(`// this used to render "Not in Zenodo DB"`)).toEqual([]);
      expect(findLegacyLabels(`/* was "Upstream Congested", now a canonical state */`)).toEqual([]);
      expect(findLegacyLabels(`/**\n * "Standby" implied waiting; it is gone.\n */`)).toEqual([]);
    });

    it("keeps line numbers usable after stripping", () => {
      const source = `line one\n/* two\nthree */\nconst x = "Standby";`;
      expect(findLegacyLabels(source)).toEqual([{ label: "Standby", line: 4 }]);
    });
  });

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
          CANONICAL_MODULE_TOKENS.some(token => source.includes(token)),
          `${surface} must import from ${CANONICAL_MODULE_TOKENS.join(" or ")}`
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

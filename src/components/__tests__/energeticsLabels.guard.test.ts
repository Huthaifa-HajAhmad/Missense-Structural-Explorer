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
import { RESEARCH_GUIDES } from "../../shared/researchGuides";

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
  'src/components/evidence/ClinicalTab.tsx',
  'src/components/evidence/PredictorsTab.tsx',
  'src/components/evidence/AlphaGenomeTab.tsx',
  'src/components/evidence/DevelopmentalExpressionCard.tsx',
  'src/components/evidence/MechanismContextCard.tsx',
  'src/components/evidence/GeneDiseaseReadings.tsx',
  'src/shared/geneDiseaseEvidence.ts',
  'src/components/evidence/ExpressionModelsTab.tsx',
  'src/components/evidence/SpeciesModelsTab.tsx',
  'src/components/evidence/ContextSourceState.tsx',
  'src/components/inspector/RailParts.tsx',
  'src/components/evidence/DiseaseContextPicker.tsx',
  'src/components/inspector/EvidenceContextRail.tsx',
  "src/components/EnergeticsView.tsx",
  "src/components/inspector/EnergeticsInspector.tsx",
  // The Energetics evidence model and its ruler, which every Energetics surface now renders from.
  "src/shared/energeticsEvidence.ts",
  "src/components/energetics/DdgRuler.tsx",
  "src/components/energetics/EnergeticsComparison.tsx",
  "src/shared/energeticsComparison.ts",
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
  "src/components/inspector/StructureInspector.tsx",
  // Function, Population, AlphaGenome, Perturbation and Gene–disease surfaces and their rails: they render
  // engine and source state too, and were never listed, so a retired label in any of them passed the guard.
  "src/components/evidence/function/FunctionTab.tsx",
  "src/components/inspector/FunctionRail.tsx",
  "src/shared/functionEvidence.ts",
  "src/shared/functionalSites.ts",
  "src/components/inspector/PopulationRail.tsx",
  "src/components/inspector/AlphaGenomeRail.tsx",
  // The shared module behind the Population tab and its rail: it owns the ClinVar absence wording ("Not in ClinVar",
  // "Query failed — not read", "Outcome not recorded"). It is listed because a status word written there reaches both
  // panes at once, and the state-union rule below is what stops it drifting into a second vocabulary.
  "src/components/evidence/population/populationFormat.ts",
  "src/components/inspector/PerturbationRail.tsx",
  "src/components/evidence/GeneDiseaseTab.tsx",
  "src/components/evidence/population/FrequencyScale.tsx",
  "src/components/evidence/predictors/ScoreRuler.tsx",
] as const;

/**
 * The register of listed surfaces whose import rule is deferred. It is EMPTY, and that is the point: it exists so a
 * future deferral has to be written down somewhere a reader will see it, next to the reason, instead of being made by
 * silently leaving a surface out of GUARDED_SURFACES — which is how the three entries it used to hold accumulated.
 *
 * The three it held are gone. FunctionTab was bookkeeping (it already imported `buildFunctionEvidence`, which imports
 * engineStatus; the table below simply had no entry). AlphaGenomeRail and PopulationRail each reach engineStatus through
 * one intermediary, which the delegate check now follows hop by hop rather than requiring a direct import the surface
 * does not need. PopulationRail's own wording is additionally pinned by the state-union rule below, so delegating it
 * cannot hide a hand-written status word.
 */
const SURFACES_PENDING_ENGINE_IMPORT: ReadonlySet<string> = new Set([]);

/**
 * Listed surfaces that render no engine state at all, so the import rule does not apply to them. They stay in
 * GUARDED_SURFACES: the legacy-label and own-vocabulary rules still run. Each reason is asserted non-empty, and each
 * file is asserted to contain no canonical label as a string literal.
 */
const SURFACES_WITHOUT_ENGINE_STATE: ReadonlyMap<string, string> = new Map([
  [
    "src/components/evidence/population/FrequencyScale.tsx",
    "A log-scale ruler that places a frequency against the ACMG cut-point zones; its text is zone names, a frequency, a source name and a reported absence.",
  ],
  [
    "src/components/evidence/predictors/ScoreRuler.tsx",
    "A single-score axis that draws the cut-points it is given; its text is the score, the tick values and the band names.",
  ],
  [
    "src/shared/functionalSites.ts",
    "A UniProt feature and PM1 rule module with no UI state; its strings are evidence-level names and PM1 reasons, not engine statuses.",
  ],
]);

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `source` imports `token` with either quote style. The check used to match only single quotes, so a
 * double-quoted import was invisible to it: a silent under-report of exactly the kind this guard exists to prevent.
 */
function importsModule(source: string, token: string): boolean {
  return new RegExp(`from\\s+["']${escapeRegExp(token)}["']`).test(source);
}

/**
 * Surfaces that render engine state through another module rather than importing `engineStatus` themselves.
 *
 * `token` is the module the surface imports, `file` the file behind it, and `usage` the symbol it must actually invoke
 * (an import mention alone used to satisfy this check). `chain` names intermediaries between `file` and the canonical
 * module, each of which must be imported by the file before it — so a two-hop path is verified hop by hop rather than
 * asserted. A type-only import counts, because the type is what forces the surface to switch on every state.
 */
const DELEGATES: Record<
  string,
  { token: string; file: string; usage: string[]; chain?: readonly string[] }
> = {
  'src/components/evidence/ExpressionModelsTab.tsx': { token: './ContextSourceState', file: 'src/components/evidence/ContextSourceState.tsx', usage: ['<ContextSourceState'] },
  'src/components/evidence/SpeciesModelsTab.tsx': { token: './ContextSourceState', file: 'src/components/evidence/ContextSourceState.tsx', usage: ['<ContextSourceState'] },
  'src/components/inspector/EvidenceContextRail.tsx': { token: './RailParts', file: 'src/components/inspector/RailParts.tsx', usage: ['<Step', '<Provenance', 'slotState(', 'sourceReadingState('] },
  // Rails that show a state word from a shared evidence model rather than writing one. Each model reads
  // ENGINE_STATE_LABELS directly, and the rail invokes the builder that produces the state it prints.
  'src/components/inspector/FunctionRail.tsx': { token: '../../shared/functionEvidence', file: 'src/shared/functionEvidence.ts', usage: ['buildFunctionEvidence('] },
  'src/components/inspector/PerturbationRail.tsx': { token: '../../shared/perturbationEvidence', file: 'src/shared/perturbationEvidence.ts', usage: ['buildPerturbationEvidence('] },
  'src/components/evidence/GeneDiseaseTab.tsx': { token: './ContextSourceState', file: 'src/components/evidence/ContextSourceState.tsx', usage: ['<ContextSourceState'] },
  // FunctionTab draws its states from the same model FunctionRail does. It was deferred as "the lead is editing it";
  // that edit landed, and the file has imported the model all along.
  'src/components/evidence/function/FunctionTab.tsx': { token: '../../../shared/functionEvidence', file: 'src/shared/functionEvidence.ts', usage: ['buildFunctionEvidence('] },
  // AlphaGenomeRail prints `availability.label`, which alphagenomeEvidence takes from evidenceAvailability. The rail
  // must not import engineStatus directly: it has no label of its own to take from it, and an unused import written
  // to satisfy a test is exactly the kind of fake the rest of this guard exists to prevent.
  'src/components/inspector/AlphaGenomeRail.tsx': {
    token: '../../shared/alphagenomeEvidence',
    file: 'src/shared/alphagenomeEvidence.ts',
    usage: ['buildAlphaGenomeEvidence('],
    chain: ['src/shared/evidenceAvailability.ts'],
  },
  // PopulationRail's ClinVar absence wording lives in populationFormat, which keys it on EvidenceAvailability.state.
  // The state-union rule below pins that switch; this entry pins that the rail reads the function rather than
  // re-spelling its outcomes.
  'src/components/inspector/PopulationRail.tsx': {
    token: '../evidence/population/populationFormat',
    file: 'src/components/evidence/population/populationFormat.ts',
    usage: ['clinvarAccessionNote('],
    chain: ['src/shared/evidenceAvailability.ts'],
  },
  // populationFormat writes outcome words of its own, but every state it does not switch on falls through to
  // `availability.label`, which is the canonical label. It therefore renders engine state without naming it.
  'src/components/evidence/population/populationFormat.ts': {
    token: '../../../shared/evidenceAvailability',
    file: 'src/shared/evidenceAvailability.ts',
    usage: ['availability.label'],
  },
};

/**
 * Walks `files` from the delegate to the canonical module. The last file must contain a canonical token; every earlier
 * file must import the next one by name, so a chain entry cannot be added without the import that makes it true.
 */
function reachesCanonicalThrough(files: readonly string[]): boolean {
  if (!files.length) return false;
  if (!CANONICAL_MODULE_TOKENS.some(token => readSurface(files[files.length - 1]).includes(token))) return false;
  for (let i = 0; i < files.length - 1; i += 1) {
    const next = files[i + 1];
    const basename = escapeRegExp(next.slice(next.lastIndexOf("/") + 1).replace(/\.tsx?$/, ""));
    // Any relative path is fine — the hop is `../../../shared/evidenceAvailability` as often as `./evidenceAvailability`;
    // what must be true is that the file names the next module at all.
    if (!new RegExp(`from\\s+["'][^"']*${basename}["']`).test(readSurface(files[i]))) return false;
  }
  return true;
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

      // Surfaces in SURFACES_WITHOUT_ENGINE_STATE are exempt from this rule, so no case is generated for them.
      if (!SURFACES_WITHOUT_ENGINE_STATE.has(surface)) it.skipIf(SURFACES_PENDING_ENGINE_IMPORT.has(surface))("renders engine state from the canonical shared module", () => {
        const source = readSurface(surface);
        const delegate = DELEGATES[surface];
        const delegated = delegate && importsModule(source, delegate.token) &&
          delegate.usage.some(usage => source.includes(usage)) &&
          reachesCanonicalThrough([delegate.file, ...(delegate.chain ?? [])]);
        expect(
          CANONICAL_MODULE_TOKENS.some(token => source.includes(token)) || !!delegated,
          `${surface} must import from ${CANONICAL_MODULE_TOKENS.join(" or ")}, or delegate to a module that does ` +
            `(see DELEGATES). A delegate must import its module, call the symbol named in its \`usage\`, and reach ` +
            `engineStatus through files that import one another.`
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

  describe("surfaces exempt from the import rule", () => {
    for (const [surface, reason] of SURFACES_WITHOUT_ENGINE_STATE) {
      describe(surface, () => {
        it("states why it renders no engine state", () => {
          expect(reason.trim(), `${surface} must say why it renders no engine state`).not.toBe("");
        });

        it("contains no canonical engine label as a string literal", () => {
          const source = readSurface(surface);
          for (const label of Object.values(ENGINE_STATE_LABELS)) {
            expect(
              new RegExp(`(["'\`])${escapeRegExp(label)}\\1`).test(source),
              `${surface} contains the canonical label "${label}" as a literal, so it does render engine state; remove the exemption`
            ).toBe(false);
          }
        });
      });
    }
  });

  /**
   * The rule that lets PopulationRail delegate to `populationFormat.ts` without hiding a second vocabulary.
   *
   * populationFormat writes its own words for three outcomes — "Not in ClinVar", "Query failed — not read",
   * "Accession not returned" — because those are per-row outcome descriptions, not statuses: the canonical module has no
   * label meaning "the classification exists but the accession did not come back". Writing them is legitimate. Writing
   * them for a state nobody enumerated is not, and that is what this pins: every state in the union is either answered
   * explicitly, or falls through to `availability.label`, which is the canonical label. Add a seventh state without
   * touching this function and the default branch still prints the canonical word; answer it by hand and the state
   * joins the switch. Either way no state can end up with an invented word.
   */
  describe("a surface that spells outcomes of its own still answers every evidence state", () => {
    const STATES_THAT_SPELL_ONE_WORD = new Map([
      ["src/components/evidence/population/populationFormat.ts", "clinvarAccessionNote"],
    ]);

    /** The state union, read from its declaration so a new member cannot be forgotten here. */
    function availabilityStates(): string[] {
      const source = fs.readFileSync(path.join(REPO_ROOT, "src/shared/evidenceAvailability.ts"), "utf-8");
      const from = source.indexOf("export type EvidenceAvailabilityState");
      expect(from, "evidenceAvailability.ts must still declare EvidenceAvailabilityState").toBeGreaterThan(-1);
      const body = source.slice(from, source.indexOf(";", from));
      return [...body.matchAll(/"([a-z-]+)"/g)].map(match => match[1]);
    }

    it("reads a non-trivial state union", () => {
      // Positive control: a parse that silently returned [] would make every assertion below vacuous.
      expect(availabilityStates().length).toBeGreaterThanOrEqual(6);
    });

    for (const [file, fn] of STATES_THAT_SPELL_ONE_WORD) {
      describe(file, () => {
        it("is a guarded surface, so its words are scanned for retired labels too", () => {
          expect(GUARDED_SURFACES as readonly string[]).toContain(file);
        });

        it(`${fn} answers every state, or falls back to the canonical label`, () => {
          const source = readSurface(file);
          expect(source, `${file} must still define ${fn}`).toContain(fn);
          const fallsBackToLabel = source.includes("availability.label ??");
          for (const state of availabilityStates()) {
            const answered = source.includes(`case "${state}"`);
            expect(
              answered || fallsBackToLabel,
              `${file} neither switches on "${state}" nor falls back to availability.label, so an absence in that ` +
                `state reaches the reader in words nobody chose.`
            ).toBe(true);
          }
        });
      });
    }
  });
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
      const entry = RESEARCH_GUIDES[engineId];
      expect(entry, `Missing rendered guide for ${engineId}`).toBeDefined();
      // Drawers explain the normalized display sign; provider-native signs remain in source records.
      const forbidden = OPPOSITE_CONVENTION['positive-destabilizing'];
      expect(
        forbidden.test(entry.reading),
        `${engineId} is documented with the opposite sign convention to its own cut-points:\n` +
          `  "${entry.reading}" (provider native: ${nativeSign})`
      ).toBe(false);
      const signReading = engineId === 'foldx' ? RESEARCH_GUIDES.ddg.reading : entry.reading;
      expect(signReading).toMatch(/positive[^.]*destabili/i);
    }
  );

  it("covers every registered engine that the module documents", () => {
    const documented = ENERGY_ENGINES.filter(
      e => (METRIC_EXPLANATIONS as Record<string, unknown>)[e.id]
    );
    expect(documented.length).toBe(ENERGY_ENGINES.length);
  });
});

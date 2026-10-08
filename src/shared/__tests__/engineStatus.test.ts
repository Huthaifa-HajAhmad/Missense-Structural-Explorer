import { describe, it, expect } from "vitest";
import {
  ENERGY_ENGINES,
  ENERGY_ENGINE_IDS,
  ENGINE_STATE_IDS,
  ENGINE_STATE_LABELS,
  MIN_ENGINES_FOR_CONSENSUS,
  KJ_PER_KCAL,
  classifyRawDdg,
  buildEngineOutcomes,
  classifyRaspMissReason,
  describeCoverage,
  describeProvenance,
  findLegacyLabels,
  formatDdg,
  formatDdgPair,
  getEngine,
  resolveEngineOutcome,
  summarizeCoverage,
  toCanonicalDdg,
  type EnergyEngineId,
  type EngineObservation,
} from "../engineStatus.ts";

/**
 * These tests encode the contract that the Energetics surfaces rely on. They exist because the
 * defects they guard against (sign drift between panels, a 1-of-6 estimate presented as an
 * ensemble, a stalled engine reported as running) were all silent — nothing failed when they
 * were introduced.
 */

describe("engineStatus — registry integrity", () => {
  it("registers exactly six engines with unique ids", () => {
    expect(ENERGY_ENGINES).toHaveLength(6);
    expect(new Set(ENERGY_ENGINE_IDS).size).toBe(6);
  });

  it("gives every engine a non-empty name, taxonomy, summary and sane cut-points", () => {
    for (const engine of ENERGY_ENGINES) {
      expect(engine.name.trim(), engine.id).not.toBe("");
      expect(engine.taxonomy.trim(), engine.id).not.toBe("");
      expect(engine.summary.trim(), engine.id).not.toBe("");
      expect(engine.strongCut, engine.id).toBeGreaterThan(0);
      expect(engine.supportingCut, engine.id).toBeGreaterThan(0);
      expect(engine.strongCut, engine.id).toBeGreaterThanOrEqual(engine.supportingCut);
      expect(engine.stabilizingCut, engine.id).toBeLessThan(0);
    }
  });

  it("resolves every registered id back to its descriptor", () => {
    for (const id of ENERGY_ENGINE_IDS) {
      expect(getEngine(id).id).toBe(id);
    }
  });
});

describe("engineStatus — state vocabulary is total", () => {
  it("has a label and a tone for every state, and no orphans", () => {
    for (const state of ENGINE_STATE_IDS) {
      const label = ENGINE_STATE_LABELS[state];
      expect(label, state).toBeTruthy();
      expect(label.trim(), state).not.toBe("");
    }
    // No label defined for a state that is not in the canonical id list.
    expect(Object.keys(ENGINE_STATE_LABELS).sort()).toEqual([...ENGINE_STATE_IDS].sort());
  });

  it("keeps the state list free of duplicates", () => {
    expect(new Set(ENGINE_STATE_IDS).size).toBe(ENGINE_STATE_IDS.length);
  });
});

describe("engineStatus — one sign convention (regression: ΔΔG printed as +0.09 and −0.09)", () => {
  it("normalises provider-native sign so positive always means destabilizing", () => {
    expect(toCanonicalDdg("foldx", 1.0)).toBe(1.0);
    expect(toCanonicalDdg("rasp", 1.0)).toBe(1.0);
    expect(toCanonicalDdg("thermompnn", 1.0)).toBe(1.0);
    expect(toCanonicalDdg("stabilityoracle", 1.0)).toBe(1.0);
    expect(toCanonicalDdg("dynamut2", 1.0)).toBe(-1.0);
    expect(toCanonicalDdg("ddmut", 1.0)).toBe(-1.0);
  });

  it("reproduces the observed MACO1 DynaMut2 case in a single convention", () => {
    // Provider reported −0.09 (native negative = destabilizing); canonical is +0.09.
    const canonical = toCanonicalDdg("dynamut2", -0.09);
    expect(canonical).toBeCloseTo(0.09, 10);
    expect(formatDdg(canonical)).toBe("0.09 kcal/mol");
    // The same canonical value is what every panel must print — never the raw sign.
    expect(formatDdg(canonical, "kcal/mol")).toBe(formatDdg(canonical, "kcal/mol"));
  });

  it("returns null rather than 0 for missing or non-finite input", () => {
    expect(toCanonicalDdg("foldx", null)).toBeNull();
    expect(toCanonicalDdg("foldx", undefined)).toBeNull();
    expect(toCanonicalDdg("foldx", Number.NaN)).toBeNull();
    expect(toCanonicalDdg("foldx", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("formats units and signs without inventing precision", () => {
    expect(formatDdg(1.0, "kcal/mol")).toBe("1.00 kcal/mol");
    expect(formatDdg(1.0, "kJ/mol")).toBe("4.18 kJ/mol");
    expect(formatDdg(1.0, "kJ/mol", 3)).toBe("4.184 kJ/mol");
    expect(formatDdg(null)).toBe("—");
  });

  it("states the unit once for an ensemble mean and never fakes a missing spread", () => {
    expect(formatDdgPair(1.2, 0.3)).toBe("1.20 ± 0.30 kcal/mol");
    expect(formatDdgPair(1.2, 0.3, "kJ/mol")).toBe("5.02 ± 1.26 kJ/mol");
    // A missing spread must not read as perfect reproducibility.
    expect(formatDdgPair(1.2, null)).toBe("1.20 kcal/mol");
    expect(formatDdgPair(1.2, null)).not.toContain("0.00");
    expect(formatDdgPair(null, 0.3)).toBe("—");
  });
});

describe("engineStatus — each engine is judged on its own scale", () => {
  it("classifies a value that only clears the engine's own cut as destabilizing", () => {
    // RaSP's tuned cut is +1.0; applying FoldX's +1.5 would have called this "moderate".
    expect(classifyRawDdg("rasp", 1.2)?.id).toBe("high");
    expect(classifyRawDdg("thermompnn", 1.2)?.id).toBe("high");
    expect(classifyRawDdg("stabilityoracle", 1.2)?.id).toBe("high");
    // The same number under FoldX's own scale is supporting, not strong.
    expect(classifyRawDdg("foldx", 1.2)?.id).toBe("moderate");
  });

  it("classifies from the raw provider value, so a negative-native value is never inverted", () => {
    // This is the trap the API is designed to make unrepresentable: passing DynaMut2's raw
    // −1.2 must read as destabilizing, not stabilizing.
    expect(classifyRawDdg("dynamut2", -1.2)?.id).toBe("high");
    expect(classifyRawDdg("ddmut", -1.2)?.id).toBe("high");
    expect(classifyRawDdg("dynamut2", 0.6)?.id).toBe("stabilizing");
    // ...and the positive-native engines are unaffected by the same input.
    expect(classifyRawDdg("rasp", -1.2)?.id).toBe("stabilizing");
    expect(classifyRawDdg("rasp", 1.2)?.id).toBe("high");
  });

  it("walks the band boundaries inclusively and returns null for no value", () => {
    expect(classifyRawDdg("foldx", 1.5)?.id).toBe("high");
    expect(classifyRawDdg("foldx", 0.5)?.id).toBe("moderate");
    expect(classifyRawDdg("foldx", 0.0)?.id).toBe("neutral");
    expect(classifyRawDdg("foldx", -0.5)?.id).toBe("stabilizing");
    expect(classifyRawDdg("foldx", null)).toBeNull();
  });
});

/** The MACO1 p.Glu433Lys run as observed on screen. */
function maco1Observations(): EngineObservation[] {
  return [
    { id: "foldx", value: null, problem: "repair-failed", detail: "FoldX RepairPDB failed" },
    { id: "dynamut2", value: -0.09, status: "done" },
    { id: "ddmut", value: null, status: "unavailable" },
    { id: "rasp", value: null, problem: "coverage-miss", detail: "Residue position is not present in the pre-computed database" },
    { id: "thermompnn", value: null, status: "pending", runActive: false },
    { id: "stabilityoracle", value: null },
  ];
}

describe("engineStatus — resolution honesty rules", () => {
  it("names every engine's state without inventing a cause", () => {
    const byId = Object.fromEntries(
      maco1Observations().map(o => [o.id, resolveEngineOutcome(o)])
    ) as Record<EnergyEngineId, ReturnType<typeof resolveEngineOutcome>>;

    expect(byId.foldx.state).toBe("failed");
    expect(byId.dynamut2.state).toBe("computed");
    expect(byId.ddmut.state).toBe("upstream-busy");
    expect(byId.rasp.state).toBe("not-covered");
    // A pending engine whose run has ended has no route to a result; it is not "running".
    expect(byId.thermompnn.state).toBe("no-result");
    // Nothing is known about StabilityOracle, so the honest answer is not a guess.
    expect(byId.stabilityoracle.state).toBe("no-result");
  });

  it("never renders a legacy label", () => {
    const legacyLiterals = ["Standby", "In Progress", "Upstream Congested", "Not in Zenodo DB"];
    const outcomes = maco1Observations().map(resolveEngineOutcome);
    for (const outcome of outcomes) {
      for (const legacy of legacyLiterals) {
        expect(outcome.label, outcome.id).not.toBe(legacy);
      }
    }
  });

  it("lets a real value outrank a failure flag, but not the exclusion it implies", () => {
    const outcome = resolveEngineOutcome({
      id: "foldx",
      value: 2.0,
      problem: "repair-failed",
      detail: "repair was skipped",
    });
    // The value survives (it is information) and the state is not a failure...
    expect(outcome.state).toBe("computed");
    expect(outcome.canonicalDdg).toBe(2.0);
    // ...but a repair-failed FoldX is excluded by the consensus, and the resolver must agree.
    // It previously reported `contributesToConsensus: true` here while the builder reported
    // `false` for the same observation, so a surface calling the resolver directly counted an
    // engine the average had discarded — and derived a risk band from it.
    expect(outcome.contributesToConsensus).toBe(false);
    expect(outcome.reason).toContain("excluded from the consensus");
  });

  it("derives no risk band from an excluded value", () => {
    // The Splicing tab turns a high band into "Structural Destabilization". An excluded value is one
    // this app has decided not to trust, and one panel suppresses the number entirely, so a band
    // derived from it produced a screen that showed "FoldX ΔΔG: —" while asserting structural
    // destabilization from that same hidden value.
    for (const problem of ["repair-failed", "binary-missing"] as const) {
      const outcome = resolveEngineOutcome({ id: "foldx", value: 3.0, problem });
      expect(outcome.canonicalDdg).toBe(3.0);
      expect(outcome.risk, problem).toBeNull();
      expect(outcome.contributesToConsensus, problem).toBe(false);
    }
    // A counted value still carries its band.
    expect(resolveEngineOutcome({ id: "foldx", value: 3.0 }).risk?.id).toBe("high");
  });

  it("can show a value without counting it in the consensus", () => {
    const outcome = resolveEngineOutcome({
      id: "foldx",
      value: 2.0,
      detail: "FoldX RepairPDB failed",
      excludeFromConsensus: true,
    });
    // The number stays visible (it is information)...
    expect(outcome.state).toBe("computed");
    expect(outcome.canonicalDdg).toBe(2.0);
    // ...but it must not inflate the engine count.
    expect(outcome.contributesToConsensus).toBe(false);
    expect(outcome.reason).toContain("excluded from the consensus");
  });

  it("prefers a known cause over an inferred one", () => {
    // status says pending, but the caller knows the binary is absent.
    const outcome = resolveEngineOutcome({
      id: "thermompnn",
      value: null,
      status: "pending",
      runActive: true,
      problem: "not-configured",
    });
    expect(outcome.state).toBe("not-installed");
  });

  it("reports a genuinely in-flight engine as running", () => {
    const outcome = resolveEngineOutcome({
      id: "ddmut",
      value: null,
      status: "pending",
      runActive: true,
    });
    expect(outcome.state).toBe("running");
    expect(outcome.reason).toContain("in progress");
  });

  it("treats 'done with no value' as no-result rather than success", () => {
    const outcome = resolveEngineOutcome({ id: "dynamut2", value: null, status: "done" });
    expect(outcome.state).toBe("no-result");
  });

  it("keeps a server detail as supporting text, never as the label", () => {
    const outcome = resolveEngineOutcome({
      id: "rasp",
      value: null,
      problem: "coverage-miss",
      detail: "Pre-computed RaSP database unavailable",
    });
    expect(outcome.label).toBe(ENGINE_STATE_LABELS["not-covered"]);
    expect(outcome.detail).toBe("Pre-computed RaSP database unavailable");
    expect(outcome.reason).not.toContain("Zenodo");
  });

  it("renders every state with a non-empty reason except computed", () => {
    for (const state of ENGINE_STATE_IDS) {
      if (state === "computed") continue;
      // Drive each state through a representative observation.
      const probe: EngineObservation =
        state === "running"
          ? { id: "ddmut", value: null, status: "pending", runActive: true }
          : state === "skipped"
            ? { id: "ddmut", value: null, status: "pending", runActive: true, hidden: true }
            : state === "not-installed"
              ? { id: "thermompnn", value: null, status: "unavailable" }
              : state === "not-covered"
                ? { id: "rasp", value: null, detail: "Residue position is not present in the pre-computed database" }
                : state === "upstream-busy"
                  ? { id: "ddmut", value: null, status: "unavailable" }
                  : state === "upstream-error"
                    ? { id: "ddmut", value: null, status: "error" }
                    : state === "failed"
                      ? { id: "foldx", value: null, problem: "pipeline-failed" }
                      : { id: "stabilityoracle", value: null };
      const outcome = resolveEngineOutcome(probe);
      expect(outcome.state, JSON.stringify(probe)).toBe(state);
      expect(outcome.reason.trim(), state).not.toBe("");
    }
  });
});

describe("engineStatus — coverage must be visible and honest", () => {
  it("counts the observed single-engine run as insufficient", () => {
    const summary = summarizeCoverage(maco1Observations().map(resolveEngineOutcome));
    expect(summary.computed).toBe(1);
    expect(summary.intended).toBe(6);
    expect(summary.insufficient).toBe(true);
    expect(summary.label).toBe("1 of 6 engines");
    expect(summary.missing).toHaveLength(5);
    expect(describeCoverage(summary)).toContain("Single-engine estimate");
  });

  it("calls a full run sufficient", () => {
    const full = ENERGY_ENGINE_IDS.map(id => resolveEngineOutcome({ id, value: 0.1 }));
    const summary = summarizeCoverage(full);
    expect(summary.computed).toBe(6);
    expect(summary.insufficient).toBe(false);
    expect(summary.missing).toHaveLength(0);
    expect(summary.running).toHaveLength(0);
    expect(describeCoverage(summary)).toBe("All 6 engines returned a value.");
  });

  it("thresholds sufficiency at MIN_ENGINES_FOR_CONSENSUS", () => {
    const ids = ENERGY_ENGINE_IDS;
    const atThreshold = ids.map((id, i) =>
      resolveEngineOutcome({ id, value: i < MIN_ENGINES_FOR_CONSENSUS ? 0.1 : null })
    );
    const belowThreshold = ids.map((id, i) =>
      resolveEngineOutcome({ id, value: i < MIN_ENGINES_FOR_CONSENSUS - 1 ? 0.1 : null })
    );
    expect(summarizeCoverage(atThreshold).insufficient).toBe(false);
    expect(summarizeCoverage(belowThreshold).insufficient).toBe(true);
  });

  it("handles a run with no values at all", () => {
    const summary = summarizeCoverage(
      ENERGY_ENGINE_IDS.map(id => resolveEngineOutcome({ id, value: null }))
    );
    expect(summary.computed).toBe(0);
    expect(summary.insufficient).toBe(true);
    expect(describeCoverage(summary)).toBe("No engine returned a value (0 of 6).");
  });

  it("never lets the user's hide choice change the count", () => {
    const base: EngineObservation[] = [
      { id: "foldx", value: 1.0 },
      { id: "dynamut2", value: -0.09, status: "done" },
      { id: "ddmut", value: null, status: "pending", runActive: true },
    ];
    const visible = summarizeCoverage(base.map(resolveEngineOutcome));
    const hidden = summarizeCoverage(base.map(o => resolveEngineOutcome({ ...o, hidden: true })));
    expect(hidden.computed).toBe(visible.computed);
    expect(hidden.intended).toBe(visible.intended);
    expect(hidden.label).toBe(visible.label);
    // Hiding only renames the still-running row; it does not remove it from the tally.
    expect(hidden.running).toHaveLength(0);
    expect(visible.running).toEqual(["ddmut"]);
  });

  it("counts engines that are unavailable by design", () => {
    const summary = summarizeCoverage([
      // A dataset miss the lookup actually reported (a bare null no longer implies one — see below).
      resolveEngineOutcome({ id: "rasp", value: null, detail: "Residue position is not present in the pre-computed database" }),
      resolveEngineOutcome({ id: "thermompnn", value: null, status: "unavailable" }), // not installed
      resolveEngineOutcome({ id: "foldx", value: 1.0 }),
    ]);
    expect(summary.notAvailableInDeployment).toBe(2);
    expect(summary.computed).toBe(1);
  });
});

describe("engineStatus — RaSP 'Not covered' needs a lookup that said so", () => {
  /**
   * The FoldX cache-hit route served RaSP as null with no `raspReason` because it never queried the
   * index, and a bare null used to resolve to "Not covered" — a statement about the dataset that
   * nothing had checked, on every revisit. A null with no reason is now "No result".
   */
  it("reports a bare null as no-result, not not-covered", () => {
    expect(resolveEngineOutcome({ id: "rasp", value: null }).state).toBe("no-result");
    const built = buildEngineOutcomes({ rasp: null, raspReason: null }).find(o => o.id === "rasp")!;
    expect(built.state).toBe("no-result");
  });

  it("still reports a lookup's own miss as not-covered, and says how small the bundled set is", () => {
    const built = buildEngineOutcomes({
      rasp: null,
      raspReason: "Residue position is not present in the pre-computed database",
    }).find(o => o.id === "rasp")!;
    expect(built.state).toBe("not-covered");
    expect(built.reason).toContain("1,345 human proteins with experimental structures");
  });
});

describe("engineStatus — absence is attributed per engine, not by one rule", () => {
  /**
   * `unavailable` means two different things: a remote queue that did not answer (retryable) and
   * an engine this deployment cannot run at all (not retryable). Treating them alike told the
   * user to retry a service that will never be there.
   */
  const outcomes = buildEngineOutcomes({
    dynamut2: null,
    dynamut2Status: "unavailable",
    ddmut: null,
    ddmutStatus: "unavailable",
    thermompnn: null,
    thermompnnStatus: "unavailable",
    stabilityoracle: null,
  });
  const byId = Object.fromEntries(outcomes.map(o => [o.id, o]));

  it("treats a remote queue that did not answer as retryable", () => {
    expect(byId.dynamut2.state).toBe("upstream-busy");
    expect(byId.ddmut.state).toBe("upstream-busy");
    expect(byId.dynamut2.reason).toContain("did not answer in time");
  });

  it("does not call a missing local service 'busy'", () => {
    expect(byId.thermompnn.state).toBe("not-installed");
    expect(byId.thermompnn.label).toBe("Not available here");
    expect(byId.thermompnn.reason).not.toContain("did not answer in time");
    // The remedy is local and stated plainly, rather than suggesting a retry.
    expect(byId.thermompnn.reason).toContain("model service is not running");
  });

  it("reports an engine with no channel at all as no-result rather than guessing", () => {
    expect(byId.stabilityoracle.state).toBe("no-result");
  });
});

describe("engineStatus — provenance labels", () => {
  it("does not mislabel a client-supplied structure as a prediction", () => {
    const view = describeProvenance("client-provided");
    expect(view.label).toBe("Structure supplied by you");
    expect(view.label).not.toContain("AlphaFold");
    expect(view.isTemplate).toBe(false);
  });

  it("distinguishes templates from predictions and formats their detail", () => {
    expect(describeProvenance("experimental").isTemplate).toBe(true);
    expect(describeProvenance("homolog").isTemplate).toBe(true);
    expect(describeProvenance("alphafold").isTemplate).toBe(false);
    const experimental = describeProvenance("experimental", {
      pdbId: "1abc",
      resolution: 2.0,
      identity: 98.4,
    });
    expect(experimental.detail).toBe("1ABC · 2.0 Å · 98% identity");
    // A missing source cannot claim to be a template.
    expect(describeProvenance(null).isTemplate).toBe(false);
    expect(describeProvenance(null).label).toBe("Template Unresolved");
  });

  it("infers experimental structure when pdbId is present without an explicit source", () => {
    const view = describeProvenance(undefined, {
      pdbId: "6n7e",
      resolution: 3.5,
    });
    expect(view.label).toBe("Experimental structure");
    expect(view.isTemplate).toBe(true);
    expect(view.detail).toBe("6N7E · 3.5 Å");
  });
});

describe("engineStatus — legacy label scanner", () => {
  it("flags a legacy literal in code and ignores one in a comment", () => {
    const source = ['// Standby is the old label for this state', 'const a = "In Progress";'].join("\n");
    const hits = findLegacyLabels(source);
    expect(hits.map(h => h.label)).toEqual(["In Progress"]);
    expect(hits[0].line).toBe(2);
  });

  it("ignores block comments", () => {
    const source = ["/*", "  Never render 'Standby' again.", "*/", "const ok = 1;"].join("\n");
    expect(findLegacyLabels(source)).toEqual([]);
  });

  it("reports the line number of a real violation", () => {
    const source = ["const a = 1;", "const b = 2;", 'const label = "Upstream Congested";'].join("\n");
    const hits = findLegacyLabels(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ label: "Upstream Congested", line: 3 });
  });

  it("finds no legacy literal in this module's own label map", () => {
    // The canonical labels must be disjoint from the strings they replaced.
    const canonical = Object.values(ENGINE_STATE_LABELS).join("\n");
    expect(findLegacyLabels(canonical)).toEqual([]);
  });
});

/**
 * Regressions found by the post-change review. Each of these failed a reviewer's adversarial pass
 * against a specific defect, so they are pinned here in the shape the reviewer demonstrated.
 */
describe("engineStatus — review regressions", () => {
  describe("RaSP miss reasons are classified, not assumed", () => {
    const stateFor = (reason: string | null) =>
      buildEngineOutcomes({ rasp: null, raspReason: reason }).find(o => o.id === "rasp")!;

    it("reports a genuine dataset miss as coverage", () => {
      // The lookup returns this one sentence for both a protein outside the covered set and a
      // position within a covered protein.
      const decision = stateFor("Residue position is not present in the pre-computed database");
      expect(decision.state).toBe("not-covered");
      // ...and the copy must not assert a fact about the protein, because it cannot tell which case
      // it is. It previously said "No precomputed RaSP profile exists for this protein."
      expect(decision.reason).not.toContain("for this protein");
      expect(decision.reason).toContain("for this variant");
    });

    it.each([
      ["Pre-computed RaSP database unavailable", "no verified store"],
      ["the index file is not present", "file missing"],
      ["the index could not be read (SQLITE_CORRUPT)", "unreadable"],
      [
        "the index disagrees with its own record (recorded 8331709 rows / 1345 proteins, found 35000 / 6) — it is truncated or corrupted",
        "truncated",
      ],
      ["Error querying pre-computed RaSP database", "query error"],
    ])("reports a store fault (%s) as a deployment problem, not as biology", reason => {
      const decision = stateFor(reason);
      expect(decision.state).toBe("not-installed");
      expect(decision.reason).not.toContain("for this variant");
      // The precise sentence still travels in the detail, so an operator can diagnose it.
      expect(decision.detail).toBe(reason);
    });

    it("does not fall for the trap that broke the first attempt", () => {
      // A naive /not present/ test matches "position is not present" — the coverage sentence — and
      // reported the dataset miss as a deployment fault.
      expect(classifyRaspMissReason("Residue position is not present in the pre-computed database"))
        .toBe("coverage-miss");
      expect(classifyRaspMissReason("the index file is not present")).toBe("not-configured");
      expect(classifyRaspMissReason(null)).toBe("coverage-miss");
    });
  });

  describe("a remote engine that is still polling is not reported as finished", () => {
    it("treats a live pending engine as running even after the FoldX leg ends", () => {
      // `isFolding` clears when the FoldX leg completes, while `useJobPoller` keeps polling the
      // remote engine for up to ten minutes. Deriving activity from `isFolding` alone rendered a
      // running engine as "No result — the run ended" for that whole window.
      const outcome = buildEngineOutcomes({
        dynamut2: null,
        dynamut2Status: "pending",
        isFolding: false,
      }).find(o => o.id === "dynamut2")!;
      expect(outcome.state).toBe("running");
      expect(outcome.reason).toContain("in progress");
    });

    it("still reports a completed engine with no value as no-result", () => {
      // The settle rule converts a pending engine without a job id to `unavailable` at every
      // terminal commit, so a `pending` that survives implies a live poller — but "done with no
      // value" is a result, and must stay one.
      const outcome = buildEngineOutcomes({
        dynamut2: null,
        dynamut2Status: "done",
        isFolding: false,
      }).find(o => o.id === "dynamut2")!;
      expect(outcome.state).toBe("no-result");
    });

    it("covers all three remote engines", () => {
      for (const id of ["dynamut2", "ddmut", "thermompnn"] as const) {
        const outcome = buildEngineOutcomes({ [id]: null, [`${id}Status`]: "pending" } as never)
          .find(o => o.id === id)!;
        expect(outcome.state, id).toBe("running");
      }
    });
  });

  describe("FoldX's cause is composed with the exclusion, not replaced by it", () => {
    const foldxOf = (facts: Parameters<typeof buildEngineOutcomes>[0]) =>
      buildEngineOutcomes(facts).find(o => o.id === "foldx")!;

    it("explains WHY a visible value is untrusted, and that it is not counted", () => {
      // The defect this replaces: whenever a value existed the reason was overwritten by the generic
      // exclusion sentence, so the repair cause never rendered — and the cause rendered only in the
      // case it was not written for.
      const outcome = foldxOf({ foldxMean: 2.0, foldxRepairFailed: true });
      expect(outcome.state).toBe("computed");
      expect(outcome.canonicalDdg).toBe(2.0);
      expect(outcome.contributesToConsensus).toBe(false);
      expect(outcome.reason).toContain("Structure repair failed");
      expect(outcome.reason).toContain("excluded from the consensus");
    });

    it("enriches repair-failed reason with experimental template and resolution context", () => {
      const outcome = foldxOf({
        foldxMean: -2.12,
        foldxRepairFailed: true,
        structureProvenance: {
          source: "experimental",
          pdbId: "6N7E",
          resolution: 3.5,
        },
      });
      expect(outcome.state).toBe("computed");
      expect(outcome.canonicalDdg).toBe(-2.12);
      expect(outcome.contributesToConsensus).toBe(false);
      expect(outcome.reason).toBe(
        "Structure repair failed on experimental model 6N7E (3.5 Å), so this estimate came from an unminimised model. Shown for reference only — excluded from the consensus."
      );
    });

    it("enriches repair-failed reason with homology template and resolution context", () => {
      const outcome = foldxOf({
        foldxMean: 1.45,
        foldxRepairFailed: true,
        structureProvenance: {
          source: "homolog",
          pdbId: "2XYZ",
          resolution: 2.4,
        },
      });
      expect(outcome.state).toBe("computed");
      expect(outcome.canonicalDdg).toBe(1.45);
      expect(outcome.contributesToConsensus).toBe(false);
      expect(outcome.reason).toBe(
        "Structure repair failed on homology template 2XYZ (2.4 Å), so this estimate came from an unminimised model. Shown for reference only — excluded from the consensus."
      );
    });

    it("does not claim an estimate exists when none does", () => {
      // The reachable counterpart was factually wrong: it said the estimate "was produced from an
      // unminimised model" while canonicalDdg was null.
      const outcome = foldxOf({ foldxMean: null, foldxRepairFailed: true });
      expect(outcome.state).toBe("failed");
      expect(outcome.canonicalDdg).toBeNull();
      expect(outcome.reason).toContain("no estimate could be produced");
      expect(outcome.reason).not.toContain("unminimised model");
    });

    it("keeps the binary-missing remediation actionable in both cases", () => {
      for (const withValue of [true, false]) {
        const outcome = foldxOf({
          foldxMean: withValue ? 2.0 : null,
          foldxBinaryMissing: true,
        });
        expect(outcome.reason, String(withValue)).toContain("FoldX binary is not installed");
        expect(outcome.reason, String(withValue)).toContain("Install it and re-run");
      }
    });
  });
});

/**
 * The exclusion, stated on the outcome rather than inferred by each renderer.
 *
 * Plan item 6. `EngineOutcome.excluded` was asserted by no test, and neither was its absence: a
 * review demonstrated that mutating the returned object to `excluded: false` passed every test — the
 * "Not counted" badge, the muted dot and the attention filter could all silently vanish — and that
 * dropping `&& excluded` from the reason gate passed all three FoldX-copy tests while rendering
 * "excluded from the consensus" for a value that IS counted, a row contradicting itself.
 */
describe("engineStatus — the exclusion is stated, not inferred", () => {
  it("marks an excluded value, and does not mark a counted one", () => {
    const excluded = resolveEngineOutcome({ id: "foldx", value: 2.0, problem: "repair-failed" });
    expect(excluded.excluded).toBe(true);
    expect(excluded.contributesToConsensus).toBe(false);
    expect(excluded.risk).toBeNull();

    const counted = resolveEngineOutcome({ id: "foldx", value: 2.0 });
    expect(counted.excluded).toBe(false);
    expect(counted.contributesToConsensus).toBe(true);
    expect(counted.risk).not.toBeNull();
  });

  it("does NOT describe a counted value as excluded", () => {
    // The negative. Without it, the gate could lose `&& excluded` and every existing test would still
    // pass while the row asserted an exclusion that did not happen.
    const counted = resolveEngineOutcome({ id: "foldx", value: 2.0 });
    expect(counted.reason).not.toContain("excluded from the consensus");
    expect(counted.reason).not.toContain("reference only");
  });

  it("states the exclusion through the builder for every excluding cause", () => {
    for (const facts of [
      { foldxMean: 2.0, foldxRepairFailed: true },
      { foldxMean: 2.0, foldxBinaryMissing: true },
    ]) {
      const outcome = buildEngineOutcomes(facts).find(o => o.id === "foldx")!;
      expect(outcome.excluded, JSON.stringify(facts)).toBe(true);
      expect(outcome.reason).toContain("excluded from the consensus");
    }
  });

  it("does not list an excluded-but-shown value as missing", () => {
    /**
     * `CoverageSummary.missing` is documented as "engines that returned nothing, with the reason",
     * but its predicate was `!contributesToConsensus` — so a FoldX value of 3.00 that is DISPLAYED,
     * with a badge explaining it is not counted, was listed as missing. The field contradicted its own
     * meaning, and the bucket is the kind of thing a future surface would render verbatim.
     */
    const summary = summarizeCoverage(
      buildEngineOutcomes({ foldxMean: 3.0, foldxRepairFailed: true })
    );
    const missingIds = summary.missing.map(o => o.id);

    // The excluded value returned something, so it is not missing...
    expect(missingIds).not.toContain("foldx");
    // ...while engines that genuinely returned nothing still are.
    expect(missingIds).toContain("dynamut2");
    expect(missingIds).toContain("thermompnn");
  });

  it("lists a RUNNING engine as running, and not as missing", () => {
    /**
     * The predicate's `state !== "running"` clause was unpinned: deleting it passed every test, after
     * which an engine that is still calculating would appear in BOTH buckets — and any copy branching
     * on them would then contradict the spinner beside it.
     */
    const summary = summarizeCoverage(
      buildEngineOutcomes({ isFolding: true, dynamut2Status: "pending" })
    );

    expect(summary.running.length).toBeGreaterThan(0);
    expect(summary.missing).toEqual([]);
    // The two buckets are disjoint, which is the property the clause exists to hold.
    const missingIds = summary.missing.map(o => o.id);
    for (const id of summary.running) {
      expect(missingIds).not.toContain(id);
    }
  });
});

describe("engineStatus — a listening remote engine says so", () => {
  const build = (facts: Parameters<typeof buildEngineOutcomes>[0]) =>
    buildEngineOutcomes(facts).find(o => o.id === "dynamut2")!;

  it("stays Running but explains that the provider missed a poll and the value may still arrive", () => {
    const o = build({ dynamut2Status: "pending", dynamut2Listening: true });
    expect(o.state).toBe("running");
    expect(o.label).toBe("Running");
    expect(o.reason).toMatch(/did not answer in time/);
    expect(o.reason).toMatch(/Still listening/);
  });
  it("uses the plain copy when not listening", () => {
    expect(build({ dynamut2Status: "pending" }).reason).toBe("Calculation in progress.");
  });
  it("ignores a stale listening flag once the engine is no longer running", () => {
    const failed = build({ dynamut2Status: "unavailable", dynamut2Listening: true });
    expect(failed.state).toBe("upstream-busy");
    expect(failed.reason).not.toMatch(/listening/i);
    const done = build({ dynamut2: -1, dynamut2Status: "done", dynamut2Listening: true });
    expect(done.state).toBe("computed");
    expect(done.reason).toBe("");
  });
});

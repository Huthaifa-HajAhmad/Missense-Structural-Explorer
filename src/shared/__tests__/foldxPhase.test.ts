import { describe, it, expect } from "vitest";
import {
  FOLDX_PHASES,
  isFoldxPhase,
  describeFoldxPhase,
  type FoldxPhase,
} from "../foldxPhase";

/**
 * The phase vocabulary is what replaced a fabricated progress stepper, so the properties that
 * matter are: every phase is nameable, the stepper order is total and monotonic, and an UNKNOWN
 * phase resolves to null rather than to a guessed stage.
 */
describe("foldxPhase", () => {
  it("names every phase, once, with a distinct stage", () => {
    const stages = FOLDX_PHASES.map(phase => {
      const view = describeFoldxPhase(phase);
      expect(view, `${phase} has no user-facing view`).not.toBeNull();
      expect(view!.label.length).toBeGreaterThan(0);
      expect(view!.detail.length).toBeGreaterThan(0);
      return view!.stage;
    });

    expect(new Set(stages).size).toBe(FOLDX_PHASES.length);
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
    expect(stages[0]).toBe(1);
  });

  it("keeps the phase order the order a job passes through them", () => {
    // A FoldX run queues, repairs, models, then scores. The array IS the stepper, so a reorder that
    // does not match the worker's call order would make the stepper walk backwards on screen.
    expect(FOLDX_PHASES).toEqual(["queued", "repairing", "modelling", "finalizing"]);
  });

  it("reports an unknown phase as unknown, never as a stage", () => {
    // A newer server may know a phase this client does not. The honest render is "not reported".
    expect(describeFoldxPhase(null)).toBeNull();
    expect(describeFoldxPhase(undefined)).toBeNull();
    expect(describeFoldxPhase("warming-up" as FoldxPhase)).toBeNull();
    expect(isFoldxPhase("warming-up")).toBe(false);
    expect(isFoldxPhase(null)).toBe(false);
    expect(isFoldxPhase(7)).toBe(false);
  });

  it("uses the repaired-template vocabulary, not infrastructure names", () => {
    // A reader sees these strings. "RepairPDB"/"BuildModel" are the tool's own verbs and belong in
    // the detail sentence, not in the short stage label.
    const labels = FOLDX_PHASES.map(p => describeFoldxPhase(p)!.label).join(" | ");
    expect(labels).toContain("Structure repair");
    expect(labels).toContain("Mutant modelling");
  });
});

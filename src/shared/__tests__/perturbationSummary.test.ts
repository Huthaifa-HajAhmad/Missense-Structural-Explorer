import { describe, it, expect } from "vitest";
import { buildPerturbationEvidence, type PerturbationEvidence } from "../perturbationEvidence";
import { directionCount, directionLabel, selectLmReading } from "../perturbationSummary";
import { GATA4_RESULT } from "./fixtures/gata4Perturbation";

const GATA4 = buildPerturbationEvidence({
  result: GATA4_RESULT,
  residues: { wtCode: "S", mutCode: "C", wtLabel: "Ser", mutLabel: "Cys" }
});

/** GATA4 with the direction counts replaced, so each figure rule is tested on its own. */
const withCounts = (counts: Partial<PerturbationEvidence["direction"]>): PerturbationEvidence => ({
  ...GATA4,
  direction: { nScored: 0, nFavourNative: 0, nFavourVariant: 0, nEven: 0, nFlat: 0, ...counts }
});

describe("selectLmReading — the tab and its rail show the same model", () => {
  it("returns the preferred model when it has a result", () => {
    expect(selectLmReading(GATA4, "esmc")?.id).toBe("esmc");
  });

  it("prefers a model with a reading over a flat one when the preferred model has no result", () => {
    const [first, ...rest] = GATA4.scored;
    const flatFirst = { ...first, direction: "flat" as const };
    const ev: PerturbationEvidence = {
      ...GATA4,
      lms: GATA4.lms.map(l => (l.id === first.id ? flatFirst : l)),
      scored: [flatFirst, ...rest]
    };
    const unscored = { ...ev, lms: ev.lms.map(l => (l.id === "esmc" ? { ...l, availability: { ...l.availability, state: "failed" as const } } : l)) };
    expect(selectLmReading(unscored, "esmc")?.id).toBe(rest[0].id);
  });

  it("returns null when no model has scored", () => {
    expect(selectLmReading({ ...GATA4, scored: [] }, "nope" as never)).toBeNull();
  });
});

describe("directionCount — the hero figure states a majority or says Split", () => {
  it("states the majority with the residue position", () => {
    expect(directionCount(GATA4)).toEqual({ figure: "3 of 3", label: "models favour native Ser over Cys at residue 159" });
  });

  it("says the variant leads when most models favour it", () => {
    expect(directionCount(withCounts({ nScored: 3, nFavourVariant: 2, nEven: 1 })).label).toBe("models favour Cys over native Ser at residue 159");
  });

  it("lists every direction instead of naming a minority as the answer", () => {
    expect(directionCount(withCounts({ nScored: 2, nFavourNative: 1, nFlat: 1 }))).toEqual({
      figure: "Split",
      label: "1 favour native Ser · 1 with no preference at residue 159"
    });
  });

  it("shows a dash before any model has scored", () => {
    expect(directionCount(withCounts({}))).toEqual({ figure: "—", label: "no language model has scored this substitution yet" });
  });
});

describe("directionLabel", () => {
  it("names the favoured residue, and has no label without a direction", () => {
    const lm = GATA4.scored[0];
    expect(directionLabel(lm, "Ser", "Cys")).toBe("Favours Ser");
    expect(directionLabel({ ...lm, direction: "favours-variant" }, "Ser", "Cys")).toBe("Favours Cys");
    expect(directionLabel({ ...lm, direction: "even" }, "Ser", "Cys")).toBe("Near even");
    expect(directionLabel({ ...lm, direction: "flat" }, "Ser", "Cys")).toBe("No preference");
    expect(directionLabel({ ...lm, direction: null }, "Ser", "Cys")).toBeNull();
  });
});

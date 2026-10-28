import { describe, expect, it } from "vitest";
import { MAX_FOCUS_COMPANIONS, disulfideSelection, interfaceSelection, residueFocus } from "../residueFocus";

describe("residueFocus", () => {
  it("keeps valid, unique companions in ascending order and drops the selected residue", () => {
    expect(residueFocus(10, [30, 20, 20, 10, 0, -4, 2.5], "set")).toEqual({ companions: [20, 30], label: "set" });
  });

  it("returns null when no companion is left, or the set is too large to read", () => {
    expect(residueFocus(10, [10], "set")).toBeNull();
    expect(residueFocus(10, [], "set")).toBeNull();
    expect(residueFocus(1, Array.from({ length: MAX_FOCUS_COMPANIONS + 2 }, (_, i) => i + 2), "set")).toBeNull();
  });
});

describe("disulfideSelection", () => {
  const pair = { start: 150, end: 200, isPair: true };

  it("selects the first cysteine and draws the second", () => {
    expect(disulfideSelection({ ...pair, covers: false }, 116)).toEqual({
      index: 150,
      focus: { companions: [200], label: "Disulfide bond between Cys150 and Cys200" },
    });
  });

  it("selects the variant residue when it is one of the cysteines, and draws the other", () => {
    expect(disulfideSelection({ ...pair, covers: true }, 200).focus?.companions).toEqual([150]);
    expect(disulfideSelection({ ...pair, covers: true }, 200).index).toBe(200);
  });

  it("adds no companions for a row that is not a pair", () => {
    expect(disulfideSelection({ start: 85, end: 85, isPair: false, covers: false }, 116)).toEqual({ index: 85, focus: null });
  });
});

describe("interfaceSelection", () => {
  const partner = { label: "CCS", residues: [4, 52, 54, 144], n: 3 };

  it("selects the variant residue and draws the partner's interface residues, saying where they come from", () => {
    const selection = interfaceSelection(partner, 52);
    expect(selection?.index).toBe(52);
    expect(selection?.focus?.companions).toEqual([4, 54, 144]);
    expect(selection?.focus?.label).toMatch(/CCS interface: 4 residues observed in 3 solved structures \(PDBe-KB\), not computed on this model/);
  });

  it("falls back to the first interface residue when the variant position is unknown", () => {
    expect(interfaceSelection(partner, null)?.index).toBe(4);
  });

  it("returns null with nothing to select", () => {
    expect(interfaceSelection({ label: "X", residues: [], n: 1 }, null)).toBeNull();
  });
});

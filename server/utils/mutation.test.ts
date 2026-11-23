import { describe, expect, it } from "vitest";
import { applyMutation } from "./mutation.ts";

describe("applyMutation", () => {
  it("swaps the residue at a 1-based position and rejects a position past the end", () => {
    const seq = "MTEYKLVVVGAGGVGKSALTIQLI";
    const mutated = applyMutation(seq, { chain: "A", position: 12, wt: "G", mt: "V" });
    expect(mutated).toBe("MTEYKLVVVGAVGVGKSALTIQLI");
    expect(mutated[11]).toBe("V");

    expect(() => applyMutation(seq, { chain: "A", position: 100, wt: "G", mt: "V" })).toThrow();
  });
});

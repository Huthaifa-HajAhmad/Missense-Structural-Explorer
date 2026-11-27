import { describe, expect, it } from "vitest";
import { buildInterfacesEvidence } from "../interfacesEvidence";
import { ABCG1_INTERFACES as ABCG1 } from "./fixtures/abcg1Interfaces";
import { SOD1_INTERFACES as SOD1 } from "./fixtures/sod1Interfaces";

const build = (f: typeof ABCG1) =>
  buildInterfacesEvidence({ result: f.result, assembly: f.assembly, assemblyStatus: "ready", ppi: f.ppi, ppiStatus: "ready", shift: null, shiftLoading: false });

/** The binding-change card names each cause with one fixed label (B10). */
describe("binding change: one label per cause", () => {
  it("says no solved complex to score when the residue is not modelled in any solved complex", () => {
    const ev = build(ABCG1);
    expect(ev.binding.stateLabel).toBe("No solved complex to score");
    expect(ev.binding.reason).toMatch(/not modelled in any solved complex of ABCG1/);
  });

  it("says not measured, not 'Not covered', when a solved complex exists but the residue is not at its interface", () => {
    const ev = build(SOD1);
    expect(ev.binding.stateLabel).toBe("Not measured");
  });
});

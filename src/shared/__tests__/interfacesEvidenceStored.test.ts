import { describe, expect, it } from "vitest";
import saved from "./fixtures/tp53StoredMultimer.json";
import { SOD1_INTERFACES } from "./fixtures/sod1Interfaces";
import type { MultimerData } from "../contracts";
import { isStaleAssembly, buildInterfacesEvidence } from "../interfacesEvidence";
import { readObserved } from "../interfaces/observed";

const assembly = saved.body as unknown as MultimerData;
const input = { result: SOD1_INTERFACES.result, assembly, assemblyStatus: "ready" as const, ppi: null, ppiStatus: "ready" as const, shift: null, shiftLoading: false };
describe("saved pre-split TP53 interfaces", () => {
  it("refreshes the real 59-partner record before counting native contacts", () => {
    expect(assembly.experimental?.partners).toHaveLength(59);
    expect(assembly.experimental?.coverage?.["1ycq"]).toEqual([[17, 27]]);
    expect(isStaleAssembly(assembly)).toBe(true);
    expect(buildInterfacesEvidence(input).observed.partners).toEqual([]);
  });
  it("withholds old contact counts on direct read until entry-specific support is refreshed", () => {
    const observed = readObserved(assembly, input, "TP53", false);
    expect(observed.partners).toEqual([]);
    expect(observed.availability.state).toBe("pending");
  });
});

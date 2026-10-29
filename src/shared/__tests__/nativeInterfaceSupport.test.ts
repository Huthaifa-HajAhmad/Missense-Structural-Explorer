/**
 * nativeInterfaceSupport — the per-residue interface reading the Hotspots table shares with the Interfaces tab,
 * on SOD1's stored assembly (the densest real case). It must count exactly the partners the tab counts as
 * native, and say "not read" rather than "no interface" whenever it did not read.
 */
import { describe, it, expect } from "vitest";
import { buildInterfacesEvidence, nativeInterfaceSupport } from "../interfacesEvidence";
import { SOD1_INTERFACES as F } from "./fixtures/sod1Interfaces";

describe("nativeInterfaceSupport — SOD1", () => {
  const support = nativeInterfaceSupport(F.assembly, "SOD1");

  it("places Val6 at the dimer interface in the same number of structures the Interfaces tab reports", () => {
    const tab = buildInterfacesEvidence({ result: F.result, assembly: F.assembly, assemblyStatus: "ready", ppi: F.ppi, ppiStatus: "ready", shift: null, shiftLoading: false });
    // CCS (3 of 3 structures) outranks the dimer (k of 142) by share, the rule the tab uses for its best partner,
    // so the dimer is found by name; its count is the tab's.
    const dimer = support.byResidue.get(6)?.find(x => x.label === "SOD1, other chain");
    expect(dimer).toMatchObject({ n: 142 });
    expect(dimer!.k).toBe(tab.interface.nearest!.support);
    expect(support.byResidue.get(6)?.[0]).toMatchObject({ label: "CCS", k: 3, n: 3 });
  });

  it("does not place Ala5 at a native interface: its only contacts are the four amyloid fibrils, which are set apart", () => {
    expect(support.status).toBe("ok");
    expect(support.byResidue.get(5)).toBeUndefined();
  });

  it("never offers a fibril, crystal-packing or set-aside partner as a native interface", () => {
    const labels = new Set([...support.byResidue.values()].flat().map(x => x.label));
    expect([...labels].some(l => /fibril|outside the assembly/.test(l))).toBe(false);
  });

  it("orders a residue's partners by the share of their structures, best first", () => {
    for (const list of support.byResidue.values()) {
      const shares = list.map(x => x.k / x.n);
      expect(shares).toEqual([...shares].sort((a, b) => b - a));
    }
  });

  it("says not read, not none, when there is no assembly or the stored one predates per-residue support", () => {
    expect(nativeInterfaceSupport(null, "SOD1").status).toBe("unavailable");
    const stale = { ...F.assembly, experimental: { ...F.assembly.experimental, partners: F.assembly.experimental.partners.map((p: any) => { const { support: _s, ...rest } = p; return rest; }) } };
    expect(nativeInterfaceSupport(stale, "SOD1")).toMatchObject({ status: "unavailable" });
    expect(nativeInterfaceSupport({ ...F.assembly, experimental: { status: "failed", partners: [] } }, "SOD1").status).toBe("unavailable");
  });

  it("reports none only when the service answered and no native partner exists", () => {
    const fibrilsOnly = { ...F.assembly, experimental: { ...F.assembly.experimental, partners: F.assembly.experimental.partners.filter((p: any) => p.context === "fibril") } };
    expect(nativeInterfaceSupport(fibrilsOnly, "SOD1")).toMatchObject({ status: "none" });
  });
});

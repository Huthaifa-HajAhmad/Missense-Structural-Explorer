import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzePpiBinding, analyzeBindingShift, readInteractionSites } from "./ppi.ts";
import { clearJapanFoldCache } from "./japanfold-client.ts";
import { clearPdbeInterfaceCache } from "./pdbe-interfaces.ts";

const url = (u: any) => (typeof u === "string" ? u : u.toString());

/** NAE1 (Q13564) as UniProt records it: the reference variant for this tab is p.Asp116Gly. */
const NAE1_JSON = {
  entryType: "UniProtKB reviewed (Swiss-Prot)",
  sequence: { length: 534 },
  comments: [
    { commentType: "SUBUNIT", texts: [{ value: "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2." }] },
    {
      commentType: "INTERACTION",
      interactions: [
        { interactantTwo: { uniProtKBAccession: "P05067", geneName: "APP" }, numberOfExperiments: 3 },
        { interactantTwo: { uniProtKBAccession: "Q8TBC4", geneName: "UBA3" }, numberOfExperiments: 3 },
      ],
    },
  ],
  features: [
    { type: "Region", description: "Interaction with UBA3", location: { start: { value: 331 }, end: { value: 344 } } },
    { type: "Site", description: "Interaction with UBA3", location: { start: { value: 211 }, end: { value: 211 } } },
    { type: "Region", description: "Disordered", location: { start: { value: 1 }, end: { value: 20 } } },
    { type: "Binding site", description: "", ligand: { name: "ATP" }, location: { start: { value: 90 }, end: { value: 90 } } },
    { type: "Active site", description: "Glycyl thioester intermediate", location: { start: { value: 120 }, end: { value: 120 } } },
  ],
};

describe("readInteractionSites", () => {
  it("reads 'Interaction with X' regions and sites, keeps ranges, and drops ligand and catalytic features", () => {
    // The defect this pins: every Region and Site was excluded, so NAE1's two UBA3 contacts were
    // reported as "no residue-level interface annotation".
    const sites = readInteractionSites(
      [
        { type: "Region", description: "Interaction with UBA3", start: 331, end: 344 },
        { type: "Site", description: "Interaction with UBA3", start: 211, end: 211 },
        { type: "Binding site", description: "(Ligand: ATP)", start: 90, end: 90 },
        { type: "Active site", description: "Interaction with substrate", start: 120, end: 120 },
        { type: "Region", description: "Disordered", start: 1, end: 20 },
      ],
      340
    );
    expect(sites).toEqual([
      { type: "Site", start: 211, end: 211, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: false },
      { type: "Region", start: 331, end: 344, description: "Interaction with UBA3", partners: ["UBA3"], containsVariant: true },
    ]);
  });
});

describe("analyzePpiBinding", () => {
  beforeEach(() => {
    clearJapanFoldCache();
    clearPdbeInterfaceCache();
    vi.restoreAllMocks();
  });

  it("returns STRING partners, curated partners, mapped sites and solved interfaces for NAE1", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      const s = url(u);
      if (s.includes("string-db.org")) {
        return {
          ok: true,
          json: async () => [
            { preferredName_A: "NAE1", preferredName_B: "UBA3", score: "0.999" },
            { preferredName_A: "NAE1", preferredName_B: "UBE2F", score: "0.976" },
            // No score: skipped, never defaulted to a band floor.
            { preferredName_A: "NAE1", preferredName_B: "NOSCORE" },
          ],
        } as any;
      }
      if (s.includes("ebi.ac.uk/pdbe")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            Q13564: { data: [{ accession: "Q8TBC4", name: "NEDD8-activating enzyme E1 catalytic subunit", residues: [{ startIndex: 110, endIndex: 118, allPDBEntries: ["1r4m", "1yov"] }], allPDBEntries: ["1r4m", "1yov"] }] },
          }),
        } as any;
      }
      if (s.includes("rest.uniprot.org")) return { ok: true, status: 200, json: async () => NAE1_JSON } as any;
      return { ok: false, status: 500 } as any;
    });

    const result = await analyzePpiBinding("NAE1", "p.Asp116Gly", "Q13564");

    expect(result.position).toBe(116);
    expect(result.stringPartners.map(p => p.partner)).toEqual(["UBA3", "UBE2F"]);
    expect(result.subunitComment).toContain("Heterodimer of UBA3 and NAE1");
    expect(result.curatedInteractions?.map(c => c.gene)).toEqual(["APP", "UBA3"]);
    expect(result.interactionSites?.map(s => [s.start, s.end, s.containsVariant])).toEqual([[211, 211, false], [331, 344, false]]);
    expect(result.observedInterfaces?.[0]).toMatchObject({ accession: "Q8TBC4", variantAtInterface: true, homomeric: false });
    expect(result.lookups).toEqual({ stringPartners: "ok", uniprot: "ok", pdbe: "ok" });
    // The binding change is a separate request now; this payload never carries one.
    expect(result).not.toHaveProperty("bindingShift");
  });

  it("reports a failed lookup as failed rather than as an empty answer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: false, status: 500 }) as any);
    const result = await analyzePpiBinding("PPIFAILGENE", "p.Ala1Val", "P99999");
    expect(result.stringPartners).toEqual([]);
    expect(result.interactionSites).toEqual([]);
    expect(result.lookups?.stringPartners).toBe("failed");
    expect(result.lookups?.uniprot).toBe("failed");
    expect(result.lookups?.pdbe).toBe("failed");
  });

  it("keeps a real empty answer distinct from a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      if (url(u).includes("string-db.org")) return { ok: true, json: async () => [] } as any;
      return { ok: false, status: 500 } as any;
    });
    const result = await analyzePpiBinding("PPIEMPTYGENE", "p.Ala1Val", "P99998");
    expect(result.stringPartners).toEqual([]);
    expect(result.lookups?.stringPartners).toBe("ok");
  });

  it("marks the UniProt and PDBe lookups as skipped when no accession was resolved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      if (url(u).includes("string-db.org")) {
        return { ok: true, json: async () => [{ preferredName_A: "PPISKIPGENE", preferredName_B: "PARTNER", score: "0.9" }] } as any;
      }
      return { ok: false, status: 500 } as any;
    });
    const result = await analyzePpiBinding("PPISKIPGENE", "p.Ala1Val", undefined);
    expect(result.lookups).toEqual({ stringPartners: "ok", uniprot: "skipped", pdbe: "skipped" });
  });
});

describe("analyzeBindingShift", () => {
  const WT = "M" + "A".repeat(114) + "D" + "A".repeat(20); // residue 116 is Asp
  const PARTNER = "M" + "K".repeat(60);
  const COMPLEX = "ATOM      1  N   ASP A 116      11.1  12.2  13.3  1.00 20.00           N\nATOM      2  N   LYS B  10      14.1  15.2  16.3  1.00 20.00           N";

  beforeEach(() => {
    clearJapanFoldCache();
    vi.restoreAllMocks();
  });

  function mockServices(boltzBodies: any[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init: any) => {
      const s = url(u);
      if (s.includes("Q13564.fasta")) return { ok: true, status: 200, text: async () => `>sp|Q13564\n${WT}\n` } as any;
      if (s.includes("Q8TBC4.fasta")) return { ok: true, status: 200, text: async () => `>sp|Q8TBC4\n${PARTNER}\n` } as any;
      if (s.includes("/v1/predictions")) {
        boltzBodies.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ status: "success", complexPdb: COMPLEX, ipTm: 0.86, pTm: 0.8, interfaceContacts: [] }) } as any;
      }
      return { ok: false, status: 500 } as any;
    });
  }

  it("models the WILD-TYPE complex and scores the substitution on it, keeping DDMut-PPI's sign", async () => {
    // The defect this pins: the Multimer tab's complex (which already carries Gly116) was sent as the
    // wild type, and a negative ΔΔG — DDMut-PPI's "weaker binding" — was classed "Surface neutral".
    const bodies: any[] = [];
    mockServices(bodies);
    const ddmut = await import("../stability/ddmut-ppi.ts");
    const spy = vi.spyOn(ddmut, "evaluateDdmutPpi").mockResolvedValue({
      status: "done",
      result: { ddgBind: -1.42, distanceToInterface: null, provenance: "DDMut-PPI" },
    });

    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q13564", gene: "NAE1" },
      { id: "B", accession: "Q8TBC4", gene: "UBA3" },
    ]);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].chains[0].sequence[115]).toBe("D");
    expect(bodies[0].chains[1].sequence).toBe(PARTNER);
    expect(spy).toHaveBeenCalledWith(COMPLEX, "A", "D116G", 20000, undefined);
    expect(shift).toMatchObject({
      status: "ok",
      ddgBind: -1.42,
      signConvention: "negative-weakens",
      mutation: "D116G",
      wildType: { source: "boltz-2-model", ipTm: 0.86 },
    });
    expect(shift).not.toHaveProperty("classification");
  });

  it("refuses a variant whose reference residue does not match the sequence", async () => {
    mockServices([]);
    const shift = await analyzeBindingShift("NAE1", "p.Arg116Gly", "Q13564", [
      { id: "A", accession: "Q13564" },
      { id: "B", accession: "Q8TBC4" },
    ]);
    expect(shift.status).toBe("not-applicable");
    expect(shift.ddgBind).toBeNull();
  });

  it("refuses a single chain and a chain A that is not the analysed protein", async () => {
    const one = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [{ id: "A", accession: "Q13564" }]);
    expect(one.status).toBe("not-applicable");
    const swapped = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q8TBC4" },
      { id: "B", accession: "Q13564" },
    ]);
    expect(swapped.status).toBe("not-applicable");
  });

  it("says a DDMut-PPI job is still running rather than reporting no value", async () => {
    mockServices([]);
    const ddmut = await import("../stability/ddmut-ppi.ts");
    vi.spyOn(ddmut, "evaluateDdmutPpi").mockResolvedValue({ status: "running" });
    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q13564" },
      { id: "B", accession: "Q8TBC4" },
    ]);
    expect(shift.status).toBe("running");
    expect(shift.ddgBind).toBeNull();
  });
});

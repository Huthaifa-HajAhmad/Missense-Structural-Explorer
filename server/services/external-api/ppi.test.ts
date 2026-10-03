import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzePpiBinding, analyzeBindingShift, readInteractionSites } from "./ppi.ts";
import { clearBoltzJobs, clearJapanFoldCache } from "./japanfold-client.ts";
import { clearPdbeInterfaceCache } from "./pdbe-interfaces.ts";
import { parseIntactMitab } from "./intact.ts";
import { clearAllCaches } from "../infra/cache.ts";

const url = (u: any) => (typeof u === "string" ? u : u.toString());
const res = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as any;

/** NAE1 (Q13564) as UniProt records it: the reference variant of the earlier tab was p.Asp116Gly. */
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
  ],
};

/** MITAB 2.5 rows as IntAct's PSICQUIC returns them (columns 0, 1, 6 and 8 are read). */
const mitab = (a: string, b: string, method: string, pubmed: string) =>
  [`uniprotkb:${a}`, `uniprotkb:${b}`, "-", "-", "-", "-", `psi-mi:"MI:0000"(${method})`, "Author (2020)", `pubmed:${pubmed}|imex:IM-1`, "taxid:9606", "taxid:9606", "-", "-", "-", "-"].join("\t");

describe("readInteractionSites", () => {
  it("reads 'Interaction with X' regions and sites, keeps ranges, and drops ligand and catalytic features", () => {
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

describe("parseIntactMitab", () => {
  it("gathers methods and distinct studies per partner, and flags a two-hybrid-only pair", () => {
    // SLC12A4's eight UniProt partners: three Y2H assay versions in ONE paper, not three confirmations.
    const text = [
      mitab("Q9UP95", "Q9Y2T2", "two hybrid array", "32296183"),
      mitab("Q9UP95", "Q9Y2T2", "validated two hybrid", "32296183"),
      mitab("Q9Y2T2", "Q9UP95", "two hybrid prey pooling approach", "32296183"),
      mitab("Q9UP95", "P17931", "anti tag coimmunoprecipitation", "33961781"),
    ].join("\n");
    const by = parseIntactMitab(text, "Q9UP95");
    expect(by.get("Q9Y2T2")).toEqual({
      methods: ["two hybrid array", "two hybrid prey pooling approach", "validated two hybrid"],
      pubmed: ["32296183"],
      twoHybridOnly: true,
    });
    expect(by.get("P17931")).toMatchObject({ twoHybridOnly: false, pubmed: ["33961781"] });
  });
});

describe("analyzePpiBinding", () => {
  beforeEach(() => {
    clearAllCaches(true);
    clearJapanFoldCache();
    clearPdbeInterfaceCache();
    vi.restoreAllMocks();
  });

  it("returns STRING's physical and functional lists, curated partners with IntAct evidence, and mapped sites", async () => {
    const asked: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      const s = url(u);
      asked.push(s);
      if (s.includes("string-db.org/api/json/version")) return res([{ string_version: "12.5" }]);
      if (s.includes("string-db.org")) {
        return res([
          { preferredName_A: "NAE1", preferredName_B: "UBA3", score: 0.999 },
          { preferredName_A: "NAE1", preferredName_B: "UBE2F", score: 0.976 },
          // No score: skipped, never defaulted to a band floor.
          { preferredName_A: "NAE1", preferredName_B: "NOSCORE" },
        ]);
      }
      if (s.includes("psicquic")) return res(mitab("Q13564", "P05067", "anti tag coimmunoprecipitation", "111"));
      if (s.includes("rest.uniprot.org")) return res(NAE1_JSON);
      return res({}, 500);
    });

    const result = await analyzePpiBinding("NAE1", "p.Asp116Gly", "Q13564");

    expect(result.position).toBe(116);
    expect(result.string?.physical?.map(p => p.partner)).toEqual(["UBA3", "UBE2F"]);
    expect(result.string).toMatchObject({ limit: 500, minScore: 0.15 });
    expect(result.stringVersion).toBe("12.5");
    expect(asked.some(s => s.includes("network_type=physical") && s.includes("required_score=150"))).toBe(true);
    expect(result.curatedInteractions?.find(c => c.gene === "APP")?.evidence).toMatchObject({ twoHybridOnly: false, pubmed: ["111"] });
    expect(result.curatedInteractions?.find(c => c.gene === "UBA3")?.evidence).toBeNull();
    expect(result.interactionSites?.map(s => [s.start, s.end, s.containsVariant])).toEqual([[211, 211, false], [331, 344, false]]);
    expect(result.lookups).toEqual({ stringPartners: "ok", stringPhysical: "ok", intact: "ok", uniprot: "ok" });
    // Solved interfaces are read once, by the assembly service.
    expect(result.observedInterfaces).toBeUndefined();
    expect(result).not.toHaveProperty("bindingShift");
  });

  it("reports a failed lookup as failed rather than as an empty answer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => res({}, 500));
    const result = await analyzePpiBinding("PPIFAILGENE", "p.Ala1Val", "P99999");
    expect(result.stringPartners).toEqual([]);
    expect(result.interactionSites).toEqual([]);
    expect(result.lookups).toEqual({ stringPartners: "failed", stringPhysical: "failed", intact: "failed", uniprot: "failed" });
  });

  it("keeps a real empty answer distinct from a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => (url(u).includes("string-db.org") ? res([]) : res({}, 500)));
    const result = await analyzePpiBinding("PPIEMPTYGENE", "p.Ala1Val", "P99998");
    expect(result.string?.physical).toEqual([]);
    expect(result.lookups?.stringPhysical).toBe("ok");
  });

  it("marks the UniProt and IntAct lookups as skipped when no accession was resolved", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) =>
      url(u).includes("string-db.org") ? res([{ preferredName_A: "PPISKIPGENE", preferredName_B: "PARTNER", score: 0.9 }]) : res({}, 500)
    );
    const result = await analyzePpiBinding("PPISKIPGENE", "p.Ala1Val", undefined);
    expect(result.lookups).toEqual({ stringPartners: "ok", stringPhysical: "ok", intact: "skipped", uniprot: "skipped" });
  });
});

describe("analyzeBindingShift", () => {
  const WT = "M" + "A".repeat(114) + "D" + "A".repeat(20); // residue 116 is Asp
  const PARTNER = "M" + "K".repeat(60);
  const COMPLEX = "ATOM      1  N   ASP A 116      11.1  12.2  13.3  1.00 20.00           N\nATOM      2  N   LYS B  10      14.1  15.2  16.3  1.00 20.00           N";
  const SOLVED = "ATOM      1  N   ASP A 216      11.1  12.2  13.3  1.00 20.00           N";

  beforeEach(() => {
    clearAllCaches(true);
    clearJapanFoldCache();
    clearBoltzJobs();
    clearPdbeInterfaceCache();
    vi.restoreAllMocks();
  });

  /** PDBe: `iface` for interface_residues (404 = no solved complex); 1abc has residue 116 at author number 216. */
  function mockServices(opts: { iface: unknown | 404; boltzBodies?: any[]; pdbFormat?: boolean }) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init: any) => {
      const s = url(u);
      if (s.includes("Q13564.fasta")) return res(`>sp|Q13564\n${WT}\n`);
      if (s.includes("Q8TBC4.fasta")) return res(`>sp|Q8TBC4\n${PARTNER}\n`);
      if (s.includes("interface_residues")) return opts.iface === 404 ? res({}, 404) : res(opts.iface);
      if (s.includes("entry/experiment/1abc")) return res({ "1abc": [{ experimental_method: "X-ray diffraction", resolution: 2.1 }] });
      if (s.includes("entry/experiment/2xyz")) return res({ "2xyz": [{ experimental_method: "X-ray diffraction", resolution: 3.4 }] });
      if (s.includes("mappings/uniprot/1abc")) return res({ "1abc": { UniProt: { Q13564: { mappings: [{ chain_id: "A", unp_start: 1, unp_end: 136, start: { residue_number: 1 } }] } } } });
      if (s.includes("residue_listing/1abc/chain/A")) {
        return res({ "1abc": { molecules: [{ chains: [{ residues: [{ residue_number: 116, author_residue_number: 216, author_insertion_code: "", residue_name: "ASP", observed_ratio: 1 }] }] }] } });
      }
      if (s.includes("files.rcsb.org/download/1ABC.pdb")) return opts.pdbFormat === false ? res("", 404) : res(SOLVED);
      if (s.includes("/v1/predictions")) {
        opts.boltzBodies?.push(JSON.parse(init.body));
        return res({ status: "success", complexPdb: COMPLEX, ipTm: 0.86, pTm: 0.8, interfaceContacts: [] });
      }
      return res({}, 500);
    });
  }

  const IFACE = {
    Q13564: {
      data: [
        {
          accession: "Q8TBC4",
          name: "NEDD8-activating enzyme E1 catalytic subunit",
          allPDBEntries: ["1abc", "2xyz"],
          residues: [{ startIndex: 116, endIndex: 116, interactingPDBEntries: [{ pdbId: "2xyz" }, { pdbId: "1abc" }] }],
        },
      ],
    },
  };

  it("scores the substitution on a SOLVED complex, best resolution first, in the entry's author numbering", async () => {
    // DDMut-PPI was trained on experimental wild types; a model was used even when solved complexes existed.
    const bodies: any[] = [];
    mockServices({ iface: IFACE, boltzBodies: bodies });
    const ddmut = await import("../stability/ddmut-ppi.ts");
    const spy = vi.spyOn(ddmut, "evaluateDdmutPpi").mockResolvedValue({ status: "done", result: { ddgBind: -1.42, distanceToInterface: null, provenance: "DDMut-PPI" } });

    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", []);

    expect(bodies).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith(SOLVED, "A", "D216G", 20000, undefined);
    expect(shift).toMatchObject({
      status: "ok",
      ddgBind: -1.42,
      signConvention: "negative-weakens",
      mutation: "D216G",
      wildType: { source: "experimental", pdbId: "1abc", resolution: 2.1, chain: "A", authorResidue: 216 },
    });
    expect(shift).not.toHaveProperty("classification");
  });

  it("does not estimate a binding change when solved complexes exist and none has the residue at the interface", async () => {
    mockServices({ iface: { Q13564: { data: [{ ...IFACE.Q13564.data[0], residues: [{ startIndex: 300, endIndex: 300, interactingPDBEntries: [{ pdbId: "1abc" }] }] }] } } });
    const ddmut = await import("../stability/ddmut-ppi.ts");
    const spy = vi.spyOn(ddmut, "evaluateDdmutPpi");
    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q13564" },
      { id: "B", accession: "Q8TBC4" },
    ]);
    expect(shift.status).toBe("not-applicable");
    expect(shift.reason).toMatch(/not at the interface in any of the 2 solved complexes/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("models the WILD-TYPE complex only when no solved complex exists, keeping DDMut-PPI's sign", async () => {
    // The defect this pins: the variant complex (which already carries Gly116) was sent as the wild type.
    const bodies: any[] = [];
    mockServices({ iface: 404, boltzBodies: bodies });
    const ddmut = await import("../stability/ddmut-ppi.ts");
    const spy = vi.spyOn(ddmut, "evaluateDdmutPpi").mockResolvedValue({ status: "done", result: { ddgBind: -1.42, distanceToInterface: null, provenance: "DDMut-PPI" } });

    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q13564", gene: "NAE1" },
      { id: "B", accession: "Q8TBC4", gene: "UBA3" },
    ]);

    expect(bodies).toHaveLength(1);
    expect(bodies[0].chains[0].sequence[115]).toBe("D");
    expect(bodies[0].chains[1].sequence).toBe(PARTNER);
    expect(spy).toHaveBeenCalledWith(COMPLEX, "A", "D116G", 20000, undefined);
    expect(shift).toMatchObject({ status: "ok", ddgBind: -1.42, mutation: "D116G", wildType: { source: "boltz-2-model", ipTm: 0.86 } });
  });

  it("refuses a variant whose reference residue does not match the sequence", async () => {
    mockServices({ iface: 404 });
    const shift = await analyzeBindingShift("NAE1", "p.Arg116Gly", "Q13564", [
      { id: "A", accession: "Q13564" },
      { id: "B", accession: "Q8TBC4" },
    ]);
    expect(shift.status).toBe("not-applicable");
    expect(shift.ddgBind).toBeNull();
  });

  it("refuses a chain A that is not the analysed protein", async () => {
    mockServices({ iface: 404 });
    const swapped = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", [
      { id: "A", accession: "Q8TBC4" },
      { id: "B", accession: "Q13564" },
    ]);
    expect(swapped.status).toBe("not-applicable");
  });

  it("says a DDMut-PPI job is still running rather than reporting no value", async () => {
    mockServices({ iface: IFACE });
    const ddmut = await import("../stability/ddmut-ppi.ts");
    vi.spyOn(ddmut, "evaluateDdmutPpi").mockResolvedValue({ status: "running" });
    const shift = await analyzeBindingShift("NAE1", "p.Asp116Gly", "Q13564", []);
    expect(shift.status).toBe("running");
    expect(shift.ddgBind).toBeNull();
    expect(shift.wildType?.source).toBe("experimental");
  });
});

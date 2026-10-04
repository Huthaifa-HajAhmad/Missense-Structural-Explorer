import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearPdbeInterfaceCache, fetchPdbeInterfaces, isFibrilEntry, observedFor, parsePdbeInterfaces, splitEntryContexts, splitFibrilEntries } from "./pdbe-interfaces.ts";
import { clearAllCaches } from "../infra/cache.ts";

const res = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body, text: async () => JSON.stringify(body) }) as any;

/**
 * SOD1 (P00441) in miniature, shaped like the live PDBe-KB answer of 2026-10-04: Ala5 is listed at the
 * "interface with the other SOD1 chain" only in amyloid fibril entries (7VZF, 9JBO); Val6 is at the
 * native dimer interface in crystal structures; a nanobody and an unmapped chain sit beside them.
 */
const SOD1_IFACE = {
  P00441: {
    data: [
      {
        accession: "P00441",
        name: "Superoxide dismutase [Cu-Zn]",
        additionalData: { type: "UNP" },
        residues: [
          { startIndex: 5, endIndex: 5, allPDBEntries: ["1spd", "2c9v", "7vzf", "9jbo"], interactingPDBEntries: [{ pdbId: "7vzf" }, { pdbId: "9jbo" }] },
          { startIndex: 6, endIndex: 6, allPDBEntries: ["1spd", "2c9v", "7vzf", "9jbo"], interactingPDBEntries: [{ pdbId: "1spd" }, { pdbId: "2c9v" }, { pdbId: "7vzf" }] },
        ],
      },
      { accession: "IG-heavy chain", name: "NB1", additionalData: { type: "AB" }, residues: [{ startIndex: 40, endIndex: 41, interactingPDBEntries: [{ pdbId: "8abc" }] }] },
      { accession: "Other", name: "Other", additionalData: { type: "OTHER" }, residues: [{ startIndex: 10, endIndex: 10, interactingPDBEntries: [{ pdbId: "8abd" }] }] },
      { accession: "P08228", name: "Superoxide dismutase [Cu-Zn]", additionalData: { type: "UNP" }, residues: [{ startIndex: 6, endIndex: 6, interactingPDBEntries: [{ pdbId: "3gtv" }] }] },
    ],
  },
};

describe("isFibrilEntry", () => {
  it("reads RCSB's keyword or an amyloid/fibril title, and nothing that only looks like one", () => {
    expect(isFibrilEntry({ struct_keywords: { pdbx_keywords: "PROTEIN FIBRIL" }, struct: { title: "x" } })).toBe(true);
    expect(isFibrilEntry({ struct: { title: "Cryo-EM structure of human SOD1 (G93A) amyloid filament" } })).toBe(true);
    expect(isFibrilEntry({ struct: { title: "Fibrils of a segment" } })).toBe(true);
    expect(isFibrilEntry({ struct: { title: "Fibrillin-1 cbEGF domains" }, struct_keywords: { pdbx_keywords: "STRUCTURAL PROTEIN" } })).toBe(false);
    expect(isFibrilEntry({ struct: { title: "F-actin filament with ADP" }, struct_keywords: { pdbx_keywords: "CONTRACTILE PROTEIN" } })).toBe(false);
    expect(isFibrilEntry({ struct: { title: "AMYOTROPHIC LATERAL SCLEROSIS AND STRUCTURAL DEFECTS IN CU,ZN SUPEROXIDE DISMUTASE" }, struct_keywords: { pdbx_keywords: "OXIDOREDUCTASE" } })).toBe(false);
  });
});

describe("parsePdbeInterfaces — partners that are not proteins", () => {
  it("sets aside PDBe's antibody and unmapped chains by type, and a label in the accession slot", () => {
    const parsed = parsePdbeInterfaces(SOD1_IFACE, "P00441");
    const by = new Map(parsed.map(p => [p.accession, p]));
    expect(by.get("IG-heavy chain")?.artefact).toBe("antibody or nanobody, a tool binder");
    expect(by.get("Other")?.artefact).toBe("chain with no UniProt record");
    expect(by.get("P08228")?.artefact).toBeNull();
    // No type field: a label is still not an accession.
    const untyped = parsePdbeInterfaces({ P00441: { data: [{ accession: "Fab light chain", name: "Fab", residues: [{ startIndex: 3, endIndex: 3, interactingPDBEntries: [{ pdbId: "1xyz" }] }] }] } }, "P00441");
    expect(untyped[0].artefact).toBe("chain with no UniProt record");
  });
});

describe("splitFibrilEntries", () => {
  it("recounts support without fibrils, so a fibril-only contact leaves the native interface", () => {
    const parsed = parsePdbeInterfaces(SOD1_IFACE, "P00441");
    const split = splitFibrilEntries(parsed, new Set(["7vzf", "9jbo"]));
    const self = split.filter(p => p.accession === "P00441");
    expect(self.map(p => p.context)).toEqual(["native", "fibril"]);
    const [native, fibril] = self;
    expect(native.pdbEntries).toEqual(["1spd", "2c9v"]);
    expect(native.residues).toEqual([6]);
    expect(fibril.pdbEntries).toEqual(["7vzf", "9jbo"]);
    expect(fibril.residues).toEqual([5, 6]);

    // Ala5 as the variant: 0 of 2 native, 2 of 2 fibril. Before the split: "at the interface in 2 of 4".
    expect(observedFor(native, "P00441", 5)).toMatchObject({ variantAtInterface: false, context: "native" });
    expect(observedFor(fibril, "P00441", 5)).toMatchObject({ variantAtInterface: true, variantEntries: ["7vzf", "9jbo"], context: "fibril" });
    expect(observedFor(native, "P00441", 6).support).toEqual([2]);
  });

  it("leaves partners with no fibril entry untouched", () => {
    const parsed = parsePdbeInterfaces(SOD1_IFACE, "P00441");
    expect(splitFibrilEntries(parsed, new Set())).toBe(parsed);
    const p08228 = splitFibrilEntries(parsed, new Set(["7vzf"])).filter(p => p.accession === "P08228");
    expect(p08228).toHaveLength(1);
    expect(p08228[0].context).toBe("native");
  });
});

describe("splitEntryContexts — crystal packing", () => {
  it("sets a monomeric-assembly entry aside from the native interface", () => {
    const parsed = parsePdbeInterfaces(SOD1_IFACE, "P00441");
    const split = splitEntryContexts(parsed, { fibrils: new Set(["7vzf", "9jbo"]), crystals: new Set(["1spd"]) });
    const self = split.filter(p => p.accession === "P00441");
    expect(self.map(p => p.context)).toEqual(["native", "fibril", "crystal"]);
    const crystal = self.find(p => p.context === "crystal")!;
    expect(crystal.pdbEntries).toEqual(["1spd"]);
    expect(crystal.residues).toEqual([6]);
    // Ala5 is not at the crystal contact; Val6 is.
    expect(observedFor(crystal, "P00441", 5)).toMatchObject({ variantAtInterface: false, context: "crystal" });
    expect(observedFor(crystal, "P00441", 6)).toMatchObject({ variantAtInterface: true, context: "crystal" });
    // A fibril entry is never re-classed as a crystal contact even when its assembly is monomeric.
    const fibrilWithMonomer = splitEntryContexts(parsed, { fibrils: new Set(["7vzf"]), crystals: new Set(["7vzf"]) });
    expect(fibrilWithMonomer.filter(p => p.accession === "P00441").every(p => p.context !== "crystal")).toBe(true);
  });
});

describe("fetchPdbeInterfaces", () => {
  beforeEach(() => {
    clearAllCaches(true);
    clearPdbeInterfaceCache();
    vi.restoreAllMocks();
  });

  it("classes fibril entries with RCSB and names each partner's species from UniProt", async () => {
    const graphql: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init: any) => {
      const s = typeof u === "string" ? u : u.toString();
      if (s.includes("interface_residues/P00441")) return res(SOD1_IFACE);
      if (s.includes("data.rcsb.org/graphql")) {
        graphql.push(JSON.parse(init.body).query);
        return res({
          data: {
            entries: [
              { rcsb_id: "7VZF", struct: { title: "Cryo-EM structure of amyloid fibril formed by full-length human SOD1" }, struct_keywords: { pdbx_keywords: "PROTEIN FIBRIL" } },
              { rcsb_id: "9JBO", struct: { title: "Cryo-EM structure of human SOD1 (WT) amyloid filament" }, struct_keywords: { pdbx_keywords: "PROTEIN FIBRIL" } },
              { rcsb_id: "1SPD", struct: { title: "Structural defects in Cu,Zn superoxide dismutase" }, struct_keywords: { pdbx_keywords: "OXIDOREDUCTASE" } },
              { rcsb_id: "2C9V", struct: { title: "Atomic resolution structure of Cu-Zn human superoxide dismutase" }, struct_keywords: { pdbx_keywords: "OXIDOREDUCTASE" } },
            ],
          },
        });
      }
      if (s.includes("rest.uniprot.org/uniprotkb/accessions")) {
        return res({
          results: [
            { primaryAccession: "P00441", organism: { taxonId: 9606, commonName: "Human" }, genes: [{ geneName: { value: "SOD1" } }] },
            { primaryAccession: "P08228", organism: { taxonId: 10090, commonName: "Mouse" }, genes: [{ geneName: { value: "Sod1" } }] },
          ],
        });
      }
      return res({}, 500);
    });

    const lookup = await fetchPdbeInterfaces("P00441");
    expect(lookup.status).toBe("ok");
    if (lookup.status !== "ok") return;
    expect(lookup.entryKinds).toBe("ok");
    expect(lookup.crystalChecked).toBe(true);
    expect(graphql[0]).toMatch(/7VZF/);
    const self = lookup.partners.filter(p => p.accession === "P00441");
    expect(self.map(p => [p.context, p.pdbEntries.length])).toEqual([["native", 2], ["fibril", 2]]);
    expect(lookup.partners.find(p => p.accession === "P08228")).toMatchObject({ gene: "Sod1", organism: "Mouse" });
    expect(self[0]).toMatchObject({ gene: "SOD1", organism: null });
  });

  it("sets a crystal-packing entry aside when its biological assembly is a monomer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any, init: any) => {
      const s = typeof u === "string" ? u : u.toString();
      if (s.includes("interface_residues/P00441")) return res(SOD1_IFACE);
      if (s.includes("data.rcsb.org/graphql")) {
        return res({
          data: {
            entries: [
              { rcsb_id: "7VZF", struct: { title: "amyloid fibril" }, struct_keywords: { pdbx_keywords: "PROTEIN FIBRIL" } },
              { rcsb_id: "9JBO", struct: { title: "amyloid filament" }, struct_keywords: { pdbx_keywords: "PROTEIN FIBRIL" } },
              { rcsb_id: "1SPD", struct: { title: "SOD1" }, struct_keywords: { pdbx_keywords: "OXIDOREDUCTASE" } },
              { rcsb_id: "2C9V", struct: { title: "SOD1" }, struct_keywords: { pdbx_keywords: "OXIDOREDUCTASE" } },
            ],
            assemblies: [
              { rcsb_id: "1SPD-1", pdbx_struct_assembly: { oligomeric_details: "monomeric" }, rcsb_assembly_info: { polymer_entity_instance_count: 1 } },
              { rcsb_id: "2C9V-1", pdbx_struct_assembly: { oligomeric_details: "dimeric" }, rcsb_assembly_info: { polymer_entity_instance_count: 2 } },
            ],
          },
        });
      }
      if (s.includes("rest.uniprot.org/uniprotkb/accessions")) return res({ results: [] });
      return res({}, 500);
    });

    const lookup = await fetchPdbeInterfaces("P00441");
    expect(lookup.status).toBe("ok");
    if (lookup.status !== "ok") return;
    expect(lookup.crystalChecked).toBe(true);
    const self = lookup.partners.filter(p => p.accession === "P00441");
    expect(self.map(p => [p.context, p.pdbEntries])).toEqual([
      ["native", ["2c9v"]],
      ["fibril", ["7vzf", "9jbo"]],
      ["crystal", ["1spd"]],
    ]);
  });

  it("says when RCSB could not be read, and does not cache an unchecked answer", async () => {
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u: any) => {
      const s = typeof u === "string" ? u : u.toString();
      if (s.includes("interface_residues")) {
        calls += 1;
        return res(SOD1_IFACE);
      }
      return res({}, 503);
    });
    const first = await fetchPdbeInterfaces("P00441");
    expect(first).toMatchObject({ status: "ok", entryKinds: "failed" });
    await fetchPdbeInterfaces("P00441");
    expect(calls).toBe(2);
  });
});

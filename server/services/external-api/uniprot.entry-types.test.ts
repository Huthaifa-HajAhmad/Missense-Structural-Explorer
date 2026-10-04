import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchUniprotFeatures } from "./uniprot.ts";
import { clearAllCaches } from "../infra/cache.ts";

/**
 * SOD1 (P00441): UniParc lists two PROSITE patterns beside the Pfam domain, and carries no entry type. The Functional
 * domains tab drew the patterns as domain boxes nested inside the Pfam box until the InterPro entry type was read.
 */
const KB = {
  genes: [{ geneName: { value: "SOD1" } }],
  sequence: { length: 154 },
  features: [
    { type: "Chain", description: "Superoxide dismutase [Cu-Zn]", location: { start: { value: 2 }, end: { value: 154 } } },
    { type: "Natural variant", description: "in ALS1; dbSNP:rs121912444", location: { start: { value: 5 }, end: { value: 5 } }, alternativeSequence: { originalSequence: "A", alternativeSequences: ["V"] } },
  ],
};
const UNIPARC = {
  uniParcId: "UPI000012A0A8",
  sequenceFeatures: [
    { database: "PROSITE", databaseId: "PS00087", interproGroup: { id: "IPR018152", name: "SOD binding site" }, locations: [{ start: 45, end: 55 }] },
    { database: "Pfam", databaseId: "PF00080", interproGroup: { id: "IPR001424", name: "SOD Cu/Zn domain" }, locations: [{ start: 15, end: 150 }] },
  ],
};
const INTERPRO = {
  results: [
    { metadata: { accession: "IPR018152", type: "binding_site" } },
    { metadata: { accession: "IPR001424", type: "domain" } },
  ],
};

function route(interpro: "ok" | "down") {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    const u = String(url);
    const body = u.includes("ebi.ac.uk/interpro") ? INTERPRO : u.includes("/uniparc/") ? UNIPARC : KB;
    if (u.includes("ebi.ac.uk/interpro") && interpro === "down") return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
}

describe("UniProt features - InterPro entry types and the processed chain", () => {
  beforeEach(() => {
    clearAllCaches(true);
    vi.restoreAllMocks();
  });

  it("carries each match's InterPro entry type", async () => {
    route("ok");
    const res = await fetchUniprotFeatures("P00441");
    const byAcc = Object.fromEntries((res?.domainMatches ?? []).map((m) => [m.accession, m.entryType]));
    expect(byAcc).toEqual({ PS00087: "binding_site", PF00080: "domain" });
    expect(res?.entryTypesStatus).toBe("ok");
  });

  const interproCalls = () => (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("ebi.ac.uk/interpro")).length;

  it("does not cache a payload whose entry types were not read, so the next request asks InterPro again", async () => {
    route("down");
    await fetchUniprotFeatures("P00441");
    await fetchUniprotFeatures("P00441");
    expect(interproCalls()).toBe(2);
  });

  it("does cache a payload whose entry types were read", async () => {
    route("ok");
    await fetchUniprotFeatures("P00441");
    await fetchUniprotFeatures("P00441");
    expect(interproCalls()).toBe(1);
  });

  it("keeps the matches, with no entry type, when InterPro does not answer", async () => {
    route("down");
    const res = await fetchUniprotFeatures("P00441");
    expect(res?.domainMatchesStatus).toBe("ok");
    expect(res?.entryTypesStatus).toBe("error");
    expect(res?.domainMatches?.map((m) => m.accession).sort()).toEqual(["PF00080", "PS00087"]);
    expect(res?.domainMatches?.every((m) => m.entryType === undefined)).toBe(true);
  });

  it("reads the single mature chain, so residue 5 can be named residue 4 of the processed protein", async () => {
    route("ok");
    const res = await fetchUniprotFeatures("P00441");
    expect(res?.processedChain).toEqual({ start: 2, end: 154 });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeMultimerStructure } from "./multimer.ts";
import { clearBoltzJobs, clearJapanFoldCache } from "../external-api/japanfold-client.ts";
import { clearPdbeInterfaceCache } from "../external-api/pdbe-interfaces.ts";
import { clearAllCaches } from "../infra/cache.ts";

/**
 * The assembly service against UniProt's REAL response shape (SUBUNIT text at `texts`). The previous
 * tests mocked `note.texts` — the parser's own wrong path — so they passed while every protein in
 * production read as a monomer.
 */

// A 120-residue sequence with Asp at 116 (NAE1 p.Asp116Gly's reference residue).
const SELF_SEQ = "M".padEnd(115, "A") + "D" + "AAAA";
const PARTNER_SEQ = "M".padEnd(80, "K");

type Routes = {
  subunit?: string | null;
  interactions?: Array<{ accession: string; gene: string }>;
  pdbe?: unknown | 404;
  boltz?: unknown | null;
  /** HTTP status for the Boltz-2 submit when it is not a model (202 with a job, 413, 503 …). */
  boltzStatus?: number;
  /** Bodies the job's results URL answers, in order. */
  jobPolls?: unknown[];
};

function mockNet(routes: Routes) {
  const calls: string[] = [];
  const res = (body: unknown, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }) as any;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url);
    calls.push(url);
    if (url.includes("rest.uniprot.org/uniprotkb/Q13564.json")) {
      return res({
        genes: [{ geneName: { value: "NAE1" } }],
        sequence: { length: SELF_SEQ.length },
        comments: [
          ...(routes.subunit ? [{ commentType: "SUBUNIT", texts: [{ value: routes.subunit }] }] : []),
          ...(routes.interactions
            ? [{
                commentType: "INTERACTION",
                interactions: routes.interactions.map(p => ({
                  interactantOne: { uniProtKBAccession: "Q13564" },
                  interactantTwo: { uniProtKBAccession: p.accession, geneName: p.gene },
                  numberOfExperiments: 5,
                })),
              }]
            : []),
        ],
        features: [],
      });
    }
    if (url.includes("Q13564.fasta")) return res(`>Q13564\n${SELF_SEQ}`);
    if (url.includes("Q8TBC4.fasta")) return res(`>Q8TBC4\n${PARTNER_SEQ}`);
    if (url.includes("interface_residues")) {
      return routes.pdbe === 404 || routes.pdbe === undefined ? res({}, 404) : res(routes.pdbe);
    }
    if (url.includes("/v1/predictions")) {
      if (routes.boltzStatus) return res(routes.boltz ?? {}, routes.boltzStatus);
      return routes.boltz ? res(routes.boltz) : res({}, 503);
    }
    if (url.includes("/v1/jobs/")) {
      const next = routes.jobPolls?.shift();
      return next ? res(next) : res({ status: "running" });
    }
    if (url.includes("uniprotkb/search")) return res({ results: [] });
    return res({}, 404);
  });
  return calls;
}

describe("analyzeMultimerStructure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllCaches(true);
    clearJapanFoldCache();
    clearPdbeInterfaceCache();
    clearBoltzJobs();
  });

  it("reads the assembly without starting a model unless one is asked for", async () => {
    // The pipeline asks on every analysis; a GPU job per variant nobody opened is the cost this pins.
    const calls = mockNet({ subunit: "Homodimer.", boltz: { complexPdb: "ATOM", ipTm: 0.7, pTm: 0.7, interfaceContacts: [] } });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.status).toBe("not-requested");
    expect(res.chains?.map(c => c.id)).toEqual(["A", "B"]);
    expect(calls.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("reads NAE1's SUBUNIT record as a heterodimer with UBA3 and, on request, models it with the partner's sequence", async () => {
    const calls = mockNet({
      subunit: "Heterodimer of UBA3 and NAE1. The complex binds NEDD8 and UBE2M. Binds APP and TP53BP2",
      interactions: [{ accession: "Q8TBC4", gene: "UBA3" }],
      boltz: { complexPdb: "ATOM", ipTm: 0.86, pTm: 0.8, interfaceContacts: [{ resA: 116, resB: 40, distance: 3.2 }, { resA: 90, resB: 12, distance: 4.0 }] },
    });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true });
    expect(res.status).toBe("success");
    expect(res.assembly?.kind).toBe("heteromer");
    expect(res.assembly?.partners).toEqual([{ gene: "UBA3", accession: "Q8TBC4", resolvedBy: "interaction" }]);
    expect(res.chains?.map(c => [c.id, c.accession, c.carriesVariant])).toEqual([["A", "Q13564", true], ["B", "Q8TBC4", false]]);
    expect(res.variantAtInterface).toBe(true);
    expect(calls.some(u => u.includes("Q8TBC4.fasta"))).toBe(true);
    // The mutant chain carries Gly at 116; the partner is untouched.
    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls.find(c => String(c[0]).includes("/v1/predictions"))![1] as any).body
    );
    expect(body.chains[0].sequence[115]).toBe("G");
    expect(body.chains[1].sequence).toBe(PARTNER_SEQ);
  });

  it("never calls a protein with no SUBUNIT record a monomer", async () => {
    mockNet({ subunit: null });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.status).toBe("not-modelled");
    expect(res.notModelledReason).toBe("unstated");
    expect(res.assembly?.kind).toBe("unstated");
  });

  it("returns monomeric only for a stated monomer, without calling the model", async () => {
    const calls = mockNet({ subunit: "Monomer." });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.status).toBe("monomeric");
    expect(calls.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("does not model a heterodimer whose partner cannot be resolved, and says why", async () => {
    mockNet({ subunit: "Heterodimer with UBA3." });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.status).toBe("not-modelled");
    expect(res.notModelledReason).toBe("heteromer-partner");
  });

  it("refuses more chains than it models instead of labelling a partial ring as the assembly", async () => {
    const calls = mockNet({ subunit: "Homohexamer." });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.status).toBe("not-modelled");
    expect(res.notModelledReason).toBe("too-many-chains");
    expect(res.oligomericState).toBe("Homohexamer");
    expect(calls.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("refuses to model a variant whose reference residue is not in the sequence", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await analyzeMultimerStructure("NAE1", "p.Arg116Gly", "Q13564");
    expect(res.status).toBe("not-modelled");
    expect(res.notModelledReason).toBe("reference-mismatch");
  });

  it("places the variant at a homodimer interface only when the residue itself is in a contact", async () => {
    mockNet({
      subunit: "Homodimer.",
      boltz: { complexPdb: "ATOM", ipTm: 0.7, pTm: 0.7, interfaceContacts: [{ resA: 113, resB: 20, distance: 3.5 }, { resA: 118, resB: 21, distance: 3.9 }] },
    });
    const near = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true });
    expect(near.status).toBe("success");
    // ±2 and ±3 in sequence: the old rule (±4) called this "directly disrupts".
    expect(near.variantAtInterface).toBe(false);
  });

  it("reports a provider failure as failed with its HTTP status, not as a monomer or absence", async () => {
    mockNet({ subunit: "Homodimer.", boltz: null });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true });
    expect(res.status).toBe("failed");
    expect(res.failure).toMatchObject({ kind: "http", httpStatus: 503 });
    expect(res.error).toBe("Boltz-2 answered HTTP 503.");
    expect(res.assembly?.label).toBe("Homodimer");
  });

  it("keeps a rejection apart from a fault, with the service's own words", async () => {
    mockNet({ subunit: "Homodimer.", boltzStatus: 413, boltz: { detail: "Too many tokens" } });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true });
    expect(res.failure).toMatchObject({ kind: "rejected", httpStatus: 413, detail: "Too many tokens" });
    expect(res.error).toBe("Boltz-2 refused this complex (HTTP 413). Too many tokens.");
  });

  it("follows a submitted job instead of reading a 202 as no model, and resumes it on the next call", async () => {
    // The old client read a 202 as "no model" and gave up at 60 s: a false negative for every large complex.
    const calls = mockNet({ subunit: "Homodimer.", boltzStatus: 202, boltz: { id: "job-1" }, jobPolls: [{ status: "running" }] });
    const first = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true, waitMs: 30 });
    expect(first).toMatchObject({ status: "running", jobId: "job-1" });
    const submits = () => calls.filter(u => u.includes("/v1/predictions")).length;
    expect(submits()).toBe(1);

    vi.restoreAllMocks();
    const again = mockNet({ subunit: "Homodimer.", jobPolls: [{ status: "completed", complexPdb: "ATOM", ipTm: 0.82, pTm: 0.8, interfaceContacts: [{ resA: 116, resB: 116, distance: 3.1 }] }] });
    const second = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { model: true, waitMs: 5000 });
    expect(second.status).toBe("success");
    expect(second.variantAtInterface).toBe(true);
    // Resumed, never submitted twice.
    expect(again.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("adds solved-structure interfaces with per-residue support, and flags construct tags", async () => {
    mockNet({
      subunit: "Monomer.",
      pdbe: {
        Q13564: {
          data: [
            {
              accession: "Q8TBC4", name: "NEDD8-activating enzyme E1 catalytic subunit", allPDBEntries: ["1r4m", "1yov"],
              residues: [
                { startIndex: 114, endIndex: 115, interactingPDBEntries: [{ pdbId: "1r4m" }, { pdbId: "1yov" }] },
                { startIndex: 116, endIndex: 116, interactingPDBEntries: [{ pdbId: "1yov" }] },
                { startIndex: 117, endIndex: 118, interactingPDBEntries: [{ pdbId: "1r4m" }, { pdbId: "1yov" }] },
              ],
            },
            { accession: "P0AEX9", name: "Maltose-binding periplasmic protein", allPDBEntries: ["9zzz"], residues: [{ startIndex: 116, endIndex: 116, interactingPDBEntries: [{ pdbId: "9zzz" }] }] },
            { accession: "P12345", name: "Other", residues: [{ startIndex: 10, endIndex: 12 }] },
          ],
        },
      },
    });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.experimental?.status).toBe("ok");
    const uba3 = res.experimental!.partners.find(p => p.accession === "Q8TBC4")!;
    expect(uba3.variantAtInterface).toBe(true);
    expect(uba3.residues).toEqual([114, 115, 116, 117, 118]);
    expect(uba3.pdbEntries).toEqual(["1r4m", "1yov"]);
    // 116 is at the interface in one of the two structures, not "in 2 solved structures".
    expect(uba3.support).toEqual([2, 2, 1, 2, 2]);
    expect(uba3.variantEntries).toEqual(["1yov"]);
    expect(uba3.artefact).toBeNull();
    const mbp = res.experimental!.partners.find(p => p.accession === "P0AEX9")!;
    expect(mbp.artefact).toBe("maltose-binding protein fusion tag");
    expect(res.experimental!.partners.find(p => p.accession === "P12345")!.variantAtInterface).toBe(false);
  });

  it("types a PDBe 404 as no interface, and anything else as an error", async () => {
    mockNet({ subunit: "Monomer.", pdbe: 404 });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.experimental?.status).toBe("none");
  });
});

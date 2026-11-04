import { describe, it, expect, vi, beforeEach } from "vitest";
import { analyzeMultimerStructure, importMultimerModel } from "./multimer.ts";
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

  it("leaves no unhandled rejection when the PDBe read is aborted while the UniProt reads fail", async () => {
    // The PDBe read starts first and is awaited last. An abort that failed the UniProt reads
    // ahead of it used to leave its AbortError with no handler, which exits the Node process.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const controller = new AbortController();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
        const url = String(typeof input === "string" ? input : input?.url);
        if (url.includes("interface_residues")) {
          // Settles after the UniProt reads have already failed.
          await new Promise(r => setTimeout(r, 20));
          controller.abort();
          throw new DOMException("aborted", "AbortError");
        }
        throw new Error("UniProt unreachable");
      });
      await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", controller.signal).catch(() => undefined);
      await new Promise(r => setTimeout(r, 100));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

/** One ATOM line, columns as the PDB format defines them. */
function atomLine(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, y: number, z: number): string {
  return `ATOM  ${String(serial).padStart(5)} ${name.padStart(4)} ${resName.padStart(3)} ${chain}${String(resSeq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 90.00           C`;
}

/**
 * A complete model of the assembly: chain A numbered 1..120 (GLY at 116 — the mutant this variant
 * asks for — unless `wildType`), chain B 1..80. The two chains sit on parallel ladders 10 Å apart so
 * exactly one residue pair is within the 4.5 Å cutoff: A's `residueNumber` against B's residue 40.
 *
 * Complete chains on purpose: the import checks that chain A is the construct the job folded, and a
 * one-residue stub cannot satisfy that check.
 */
function importedModel({
  gap = 3.2,
  residueNumber = 116,
  partner = true,
  extraChain = false,
  lengthA = 120,
  wildType = false,
  numberOffset = 0,
}: {
  gap?: number;
  residueNumber?: number;
  partner?: boolean;
  extraChain?: boolean;
  lengthA?: number;
  wildType?: boolean;
  numberOffset?: number;
} = {}): string {
  const lines: string[] = [];
  let serial = 1;
  for (let i = 1; i <= lengthA; i += 1) {
    const resName = i === residueNumber ? (wildType ? "ASP" : "GLY") : "ALA";
    lines.push(atomLine(serial++, "CA", resName, "A", i + numberOffset, 10 * i, 0, 0));
  }
  // The partner chain hangs off one column of A: its residue 40 sits `gap` Å from A's `residueNumber`,
  // and each neighbour is 10 Å further away, so exactly one residue pair is inside the cutoff.
  for (const chain of partner ? (extraChain ? ["B", "C"] : ["B"]) : []) {
    const sign = chain === "C" ? -1 : 1;
    for (let j = 1; j <= 80; j += 1) {
      lines.push(atomLine(serial++, "CA", "ALA", chain, j, 10 * residueNumber, sign * (gap + 10 * (j - 40)), 0));
    }
  }
  return lines.join("\n");
}

describe("LocalFold hand-off", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllCaches(true);
    clearJapanFoldCache();
    clearPdbeInterfaceCache();
    clearBoltzJobs();
  });

  it("hands the same chains over as an AlphaFold 3 job, without starting a provider job", async () => {
    // The free path: no job is submitted anywhere, and the file folds in the reader's browser.
    const calls = mockNet({ subunit: "Homodimer." });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { handoff: true });
    expect(res.status).toBe("not-requested");
    expect(res.handoff?.url).toBe("https://localfold.org/?model=boltz2");
    expect(res.handoff?.residues).toBe(SELF_SEQ.length * 2);
    expect(res.handoff?.tooLarge).toBe(false);

    const job = JSON.parse(res.handoff!.jobJson);
    expect(job[0].dialect).toBe("alphafold3");
    expect(job[0].version).toBe(2);
    expect(job[0].sequences.map((s: any) => s.protein.id)).toEqual([["A"], ["B"]]);
    // Chain A is the mutant; B is the wild type. A merged `count: 2` would fold the wild type twice.
    expect(job[0].sequences[0].protein.sequence[115]).toBe("G");
    expect(job[0].sequences[1].protein.sequence).toBe(SELF_SEQ);
    expect(calls.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("hands a heterodimer the partner's sequence, not the variant chain's", async () => {
    // The homodimer test cannot see this: there B legitimately IS the self sequence. The branch that
    // resolves a partner's FASTA is the one a merged job would break.
    mockNet({
      subunit: "Heterodimer of UBA3 and NAE1.",
      interactions: [{ accession: "Q8TBC4", gene: "UBA3" }],
    });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564", undefined, { handoff: true });
    const job = JSON.parse(res.handoff!.jobJson);
    expect(job[0].sequences[0].protein.sequence[115]).toBe("G");
    expect(job[0].sequences[1].protein.sequence).toBe(PARTNER_SEQ);
    expect(res.handoff!.residues).toBe(SELF_SEQ.length + PARTNER_SEQ.length);
  });

  it("does not carry a hand-off unless it is asked for", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await analyzeMultimerStructure("NAE1", "p.Asp116Gly", "Q13564");
    expect(res.handoff).toBeUndefined();
  });
});

describe("importMultimerModel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearAllCaches(true);
    clearJapanFoldCache();
    clearPdbeInterfaceCache();
    clearBoltzJobs();
  });

  it("reads a LocalFold model back, measuring contacts and naming the machine", async () => {
    const calls = mockNet({ subunit: "Homodimer." });
    const pdb = importedModel();
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", pdb);
    expect(res.status).toBe("success");
    expect(res.provenance).toBe("Boltz-2 via LocalFold (browser)");
    expect(res.complexPdb).toBe(pdb);
    // The PDB carries no confidence scores, so none is invented.
    expect(res.ipTm).toBeNull();
    expect(res.pTm).toBeNull();
    expect(res.interfaceContacts).toEqual([{ resA: 116, resB: 40, distance: 3.2 }]);
    expect(res.variantAtInterface).toBe(true);
    expect(calls.some(u => u.includes("/v1/predictions"))).toBe(false);
  });

  it("refuses a monomer fold and names the chains the assembly folds", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel({ partner: false }));
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/folds A, B/);
    expect(res.interfaceContacts).toEqual([]);
  });

  it("refuses a model of a different construct rather than reporting no contact", async () => {
    mockNet({ subunit: "Homodimer." });
    // The wild type's own fold: residue 116 is Asp, and this job asked for Gly.
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel({ wildType: true }));
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/asked for G/);
    expect(res.interfaceContacts).toEqual([]);
  });

  it("refuses a model whose chain A is numbered from somewhere else", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel({ numberOffset: 200 }));
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/no residue 116/);
  });

  it("refuses a chain A of the wrong length", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel({ lengthA: 119 }));
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/119 residues; this chain has 120/);
  });

  it("refuses a file that also holds a chain the assembly did not fold", async () => {
    // A contact with a third chain would be printed as a contact with the modelled partner: the
    // contact type names no chain.
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel({ extraChain: true }));
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/also holds chain C/);
  });

  it("refuses a variant whose position cannot be read, instead of accepting an unchecked model", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "not-a-variant", "Q13564", importedModel());
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/no residue position/);
  });

  it("says an mmCIF file is not read, instead of reading an empty interface", async () => {
    mockNet({ subunit: "Homodimer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", "data_test\n#\nATOM 1 N MET A 1 1.0 2.0 3.0\n");
    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/mmCIF/);
  });

  it("will not read a complex for a protein UniProt states as a monomer", async () => {
    mockNet({ subunit: "Monomer." });
    const res = await importMultimerModel("NAE1", "p.Asp116Gly", "Q13564", importedModel());
    expect(res.status).toBe("monomeric");
    expect(res.error).toMatch(/monomer/);
    // Nothing was imported, so the payload must not claim a LocalFold model.
    expect(res.provenance).not.toMatch(/LocalFold/);
  });
});

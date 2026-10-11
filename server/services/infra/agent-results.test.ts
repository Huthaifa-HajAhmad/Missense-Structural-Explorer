import { describe, it, expect, afterEach } from "vitest";
import { validateFoldxAgentResult, validateP2RankAgentResult, toolVersionProblem } from "./agent-results.ts";

function atom(serial: number, name: string, res: string, chain: string, seq: number, x: number) {
  return `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${res} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${"0.000".padStart(8)}${"0.000".padStart(8)}  1.00 50.00           ${name[0]}`;
}
const pdb = (res: string[], chain = "A") => res.flatMap((r, i) => [atom(i * 2 + 1, "N", r, chain, i + 1, i * 3.8), atom(i * 2 + 2, "CA", r, chain, i + 1, i * 3.8 + 1.4)]).join("\n") + "\nEND\n";

const WT = pdb(["ALA", "VAL", "GLY", "LEU"]);
const job = { wtPdb: WT, mutation: "VA2E" };
const ok = (over: Record<string, unknown> = {}) => ({
  status: "success",
  pdb: pdb(["ALA", "GLU", "GLY", "LEU"]),
  ddG: 1.8,
  foldedResidueIndex: 2,
  resolvedChain: "A",
  energetics: { foldxMean: 1.8, rawDdGs: [1.7, 1.9] },
  ...over,
});

afterEach(() => {
  delete process.env.AGENT_ACCEPTED_FOLDX_VERSIONS;
});

describe("validateFoldxAgentResult", () => {
  it("accepts a result for the job it was given, and drops fields it does not know", () => {
    const v = validateFoldxAgentResult(job, { ...ok(), injected: "<script>" }, "5.1");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.result).not.toHaveProperty("injected");
  });

  it.each([
    ["a result for another residue", ok({ foldedResidueIndex: 3 }), /residue 3/],
    ["another chain", ok({ resolvedChain: "B" }), /chain B/],
    ["the wild type at the site", ok({ pdb: WT }), /is VAL, not GLU/],
    ["a structure missing most of the template", ok({ pdb: pdb(["ALA", "GLU"]) }), /keeps 2 of the template's 4/],
    ["an impossible ddG", ok({ ddG: 5000, energetics: { foldxMean: 5000 } }), /ddG/],
    ["a non-number ddG", ok({ ddG: "1.8" }), /ddG/],
    ["a mean that disagrees with ddG", ok({ energetics: { foldxMean: -3 } }), /disagree/],
    ["a soft failure sent as a result", ok({ status: "failed" }), /status/],
  ])("refuses %s", (_label, result, why) => {
    const v = validateFoldxAgentResult(job, result, "5.1");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.join(" ")).toMatch(why);
  });

  it("checks the tool version, and the admin's allow-list when one is set", () => {
    expect(toolVersionProblem("foldx", "5.1")).toBeNull();
    expect(toolVersionProblem("foldx", "rm -rf /")).toMatch(/not a version/);
    process.env.AGENT_ACCEPTED_FOLDX_VERSIONS = "5.1, 5.2";
    expect(validateFoldxAgentResult(job, ok(), "5.0").ok).toBe(false);
    expect(validateFoldxAgentResult(job, ok(), "5.2").ok).toBe(true);
  });
});

describe("validateP2RankAgentResult", () => {
  const job = { pdbText: WT }; // ALA1 VAL2 GLY3 LEU4, chain A
  const pocket = {
    pocketResidues: [{ index: 4, chain: "A", name: "LEU", distance: 3.2, score: 0.4 }],
    pocketScore: 61,
    pocketVolume: 0,
    likelyCofactor: "x",
    status: "success",
    provenance: { engine: "p2rank", scoreSource: "probability", volumeSource: "unavailable" },
  };
  it("accepts P2Rank's answers and refuses anything else", () => {
    expect(validateP2RankAgentResult(job, pocket, "2.6-alpha").ok).toBe(true);
    expect(validateP2RankAgentResult(job, { ...pocket, pocketResidues: [], status: "none_detected", provenance: undefined }, "2.6-alpha").ok).toBe(true);
    expect(validateP2RankAgentResult(job, { ...pocket, provenance: { ...pocket.provenance, engine: "fpocket" } }, "2.6-alpha").ok).toBe(false);
    expect(validateP2RankAgentResult(job, { ...pocket, status: "fallback" }, "2.6-alpha").ok).toBe(false);
    expect(validateP2RankAgentResult(job, { ...pocket, pocketScore: -1 }, "2.6-alpha").ok).toBe(false);
  });

  it("refuses pocket residues that are not in the job's structure", () => {
    const v = validateP2RankAgentResult(job, { ...pocket, pocketResidues: [{ index: 4, chain: "A", name: "TRP", distance: 3, score: 0.4 }] }, "2.6-alpha");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reasons.join(" ")).toMatch(/not in the job's structure/);
    expect(validateP2RankAgentResult(job, { ...pocket, pocketResidues: [{ index: 99, chain: "A", name: "LEU", distance: 3, score: 0.4 }] }, "2.6-alpha").ok).toBe(false);
  });
});

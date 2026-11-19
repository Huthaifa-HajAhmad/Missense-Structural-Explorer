import { describe, expect, it } from "vitest";
import { compareChainCandidates, scoreLocalQuality, type ChainCandidate } from "./chain-quality.ts";

/** One PDB ATOM line in fixed columns. */
function atom(serial: number, name: string, resName: string, chain: string, resSeq: number, x: number, y: number, z: number, element: string, record = "ATOM"): string {
  const atomField = name.length === 4 ? name : ` ${name.padEnd(3)}`;
  return `${record.padEnd(6)}${String(serial).padStart(5)} ${atomField} ${resName.padStart(3)} ${chain}${String(resSeq).padStart(4)}    ` +
    `${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${element.padStart(2)}`;
}

const BACKBONE = ["N", "CA", "C", "O"];
const SIDE: Record<string, string[]> = { ALA: ["CB"], ARG: ["CB", "CG", "CD", "NE", "CZ", "NH1", "NH2"], GLY: [], VAL: ["CB", "CG1", "CG2"], MET: ["CB", "CG", "SD", "CE"] };

/** A residue with its CA at x (residues 3.8 Å apart on a line) and every expected atom unless `omit` names some. */
function residue(resName: string, resSeq: number, chain = "A", omit: string[] = [], record = "ATOM"): string[] {
  const names = [...BACKBONE, ...(SIDE[resName] ?? [])].filter(n => !omit.includes(n));
  return names.map((n, i) => atom(resSeq * 10 + i, n, resName, chain, resSeq, resSeq * 3.8 + (n === "CA" ? 0 : 0.5), 0, 0, n[0], record));
}

function chainOf(parts: string[][]): string {
  return parts.flat().join("\n") + "\nEND\n";
}

describe("scoreLocalQuality", () => {
  it("reports a complete target and a complete neighbourhood", () => {
    const pdb = chainOf([residue("ALA", 9), residue("ARG", 10), residue("VAL", 11)]);
    const q = scoreLocalQuality(pdb, "A", 10, "R");
    expect(q).not.toBeNull();
    expect(q!.targetComplete).toBe(true);
    expect(q!.neighbourFraction).toBe(1);
    expect(q!.meetsNeighbourMark).toBe(true);
  });

  it("marks a target whose side chain lacks atoms as incomplete", () => {
    const pdb = chainOf([residue("ALA", 9), residue("ARG", 10, "A", ["NH1", "NH2", "CZ"]), residue("VAL", 11)]);
    expect(scoreLocalQuality(pdb, "A", 10, "R")!.targetComplete).toBe(false);
  });

  it("reads only the first model of a multi-model (NMR) file, the one FoldX builds on", () => {
    // Model 1 lacks the target's guanidinium group; model 2 has it. Model 2 must not fill the gap.
    const model1 = [residue("ALA", 9), residue("ARG", 10, "A", ["NH1", "NH2", "CZ"]), residue("VAL", 11)].flat();
    const model2 = [residue("ALA", 9), residue("ARG", 10), residue("VAL", 11)].flat();
    const pdb = ["MODEL        1", ...model1, "ENDMDL", "MODEL        2", ...model2, "ENDMDL", "END"].join("\n");
    expect(scoreLocalQuality(pdb, "A", 10, "R")!.targetComplete).toBe(false);
  });

  it("counts incomplete neighbours against the 90% mark", () => {
    const pdb = chainOf([residue("ALA", 9, "A", ["CB"]), residue("ARG", 10), residue("VAL", 11)]);
    const q = scoreLocalQuality(pdb, "A", 10, "R")!;
    expect(q.neighbourFraction).toBe(0.5);
    expect(q.meetsNeighbourMark).toBe(false);
  });

  it("refuses a chain whose residue at the site is not the wild type", () => {
    const pdb = chainOf([residue("ALA", 9), residue("VAL", 10), residue("VAL", 11)]);
    expect(scoreLocalQuality(pdb, "A", 10, "R")).toBeNull();
  });

  it("reads selenomethionine as methionine, with selenium in place of the sulfur", () => {
    const mse = residue("MET", 10, "A", [], "HETATM").map(l => l.replace("MET", "MSE").replace(" SD ", "SE  "));
    const pdb = chainOf([residue("ALA", 9), mse, residue("VAL", 11)]);
    const q = scoreLocalQuality(pdb, "A", 10, "M");
    expect(q).not.toBeNull();
    expect(q!.targetComplete).toBe(true);
  });

  it("refuses a target without its full backbone", () => {
    const pdb = chainOf([residue("ALA", 9), residue("ARG", 10, "A", ["O"]), residue("VAL", 11)]);
    expect(scoreLocalQuality(pdb, "A", 10, "R")).toBeNull();
  });

  it("only reads the requested chain", () => {
    const pdb = chainOf([residue("ARG", 10, "B")]);
    expect(scoreLocalQuality(pdb, "A", 10, "R")).toBeNull();
  });
});

describe("compareChainCandidates", () => {
  const make = (pdbId: string, chainId: string, over: Partial<ChainCandidate>): ChainCandidate => ({
    pdbId, chainId, resolution: 2.0, coverage: 0.5, targetComplete: true, meetsNeighbourMark: true, neighbourFraction: 1, ...over,
  });

  it("prefers a complete target over a better resolution", () => {
    const sharp = make("1aaa", "A", { resolution: 1.2, targetComplete: false });
    const complete = make("2bbb", "A", { resolution: 3.0 });
    expect([sharp, complete].sort(compareChainCandidates)[0]).toBe(complete);
  });

  it("then a complete neighbourhood, then resolution, then completeness, then coverage", () => {
    const a = make("1aaa", "A", { meetsNeighbourMark: false, resolution: 1.0 });
    const b = make("2bbb", "A", { resolution: 2.5 });
    const c = make("3ccc", "A", { resolution: 1.8 });
    const d = make("4ddd", "A", { resolution: 1.8, neighbourFraction: 0.95 });
    const e = make("5eee", "A", { resolution: 1.8, coverage: 0.9 });
    expect([a, b, c, d, e].sort(compareChainCandidates).map(x => x.pdbId)).toEqual(["5eee", "3ccc", "4ddd", "2bbb", "1aaa"]);
  });

  it("puts a missing resolution after any measured one", () => {
    const unknown = make("1aaa", "A", { resolution: null });
    const poor = make("2bbb", "A", { resolution: 4.5 });
    expect([unknown, poor].sort(compareChainCandidates)[0]).toBe(poor);
  });

  it("gives the same choice whatever order the candidates arrive in", () => {
    const list = [make("9xyz", "b", {}), make("9xyz", "B", {}), make("1abc", "A", {}), make("1abc", "C", {})];
    const first = [...list].sort(compareChainCandidates)[0];
    for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) {
      expect(order.map(i => list[i]).sort(compareChainCandidates)[0]).toBe(first);
    }
    expect(first.pdbId).toBe("1abc");
    expect(first.chainId).toBe("A");
  });
});

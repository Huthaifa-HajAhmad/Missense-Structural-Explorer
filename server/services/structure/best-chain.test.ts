import { describe, expect, it, vi } from "vitest";
import { chooseBestChain, MAX_CHAINS_DOWNLOADED, MAX_CHAINS_EXAMINED, type BestStructureRow } from "./best-chain.ts";

/** A UniProt-numbered chain with residues `from`..`to`; residue 10 is ARG, complete unless told otherwise. */
function chain(chainId: string, opts: { targetComplete?: boolean; neighboursComplete?: boolean } = {}): string {
  const lines: string[] = [];
  let serial = 1;
  const put = (name: string, resName: string, resSeq: number, x: number) => {
    const field = ` ${name.padEnd(3)}`;
    lines.push(`ATOM  ${String(serial++).padStart(5)} ${field} ${resName} ${chainId}${String(resSeq).padStart(4)}    ${x.toFixed(3).padStart(8)}   0.000   0.000  1.00 20.00           ${name[0]}`);
  };
  for (const [resName, resSeq, complete] of [["ALA", 9, opts.neighboursComplete !== false], ["ARG", 10, opts.targetComplete !== false], ["ALA", 11, opts.neighboursComplete !== false]] as const) {
    const side = resName === "ARG" ? ["CB", "CG", "CD", "NE", "CZ", "NH1", "NH2"] : ["CB"];
    for (const n of ["N", "CA", "C", "O", ...(complete ? side : [])]) put(n, resName, resSeq, resSeq * 3.8);
  }
  return lines.join("\n") + "\nEND\n";
}

const row = (pdb_id: string, chain_id: string, resolution: number | null, coverage = 0.5): BestStructureRow =>
  ({ pdb_id, chain_id, resolution, coverage, unp_start: 1, unp_end: 100, start: 1 });

describe("chooseBestChain", () => {
  it("picks the locally complete chain over PDBe's first, coverage-led row", async () => {
    const rows = [row("9r2q", "K", 3.2, 1.0), row("2ocj", "A", 2.05, 0.5)];
    const texts: Record<string, string> = { "9r2q:K": chain("K", { targetComplete: false, neighboursComplete: false }), "2ocj:A": chain("A") };
    const choice = await chooseBestChain(rows, 10, "R", async r => texts[`${r.pdb_id}:${r.chain_id}`] ?? null);
    expect(choice.best?.row.pdb_id).toBe("2ocj");
    expect(choice.examined).toBe(2);
  });

  it("examines at most a fixed number of chains, best resolution first, and says how many it left out", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(`${i + 1}abc`, "A", 1 + i * 0.1));
    const verify = vi.fn(async (r: BestStructureRow) => chain(r.chain_id));
    const choice = await chooseBestChain([...rows].reverse(), 10, "R", verify);
    // Every chain here is eligible, so examination stops once MAX_CHAINS_EXAMINED of them are found.
    expect(verify).toHaveBeenCalledTimes(MAX_CHAINS_EXAMINED);
    expect(choice.omitted).toBe(7 - MAX_CHAINS_EXAMINED);
    expect(choice.best?.row.pdb_id).toBe("1abc");
  });

  it("gives the same chain whatever order PDBe lists the rows in", async () => {
    const rows = [row("3ccc", "B", 2.0), row("1aaa", "A", 2.0), row("2bbb", "A", 2.0)];
    const verify = async (r: BestStructureRow) => chain(r.chain_id);
    const first = await chooseBestChain(rows, 10, "R", verify);
    const second = await chooseBestChain([rows[2], rows[0], rows[1]], 10, "R", verify);
    expect(second.best?.row.pdb_id).toBe(first.best?.row.pdb_id);
    expect(first.best?.row.pdb_id).toBe("1aaa");
  });

  it("skips chains that are not the wild type and keeps examining until it has enough wild-type ones", async () => {
    // TP53: the sharpest chains are engineered constructs with stabilising mutations elsewhere (3D06).
    const rows = Array.from({ length: 8 }, (_, i) => row(`${i + 1}abc`, "A", 1 + i * 0.1));
    const engineered = new Set(["1abc", "2abc", "3abc", "4abc"]);
    const verify = vi.fn(async (r: BestStructureRow) => chain(r.chain_id));
    const choice = await chooseBestChain(rows, 10, "R", verify, (r) => (engineered.has(r.pdb_id) ? ["N239Y"] : []));
    expect(choice.best?.row.pdb_id).toBe("5abc");
    expect(choice.notWildType).toBe(4);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(MAX_CHAINS_DOWNLOADED);
  });

  it("names the first refused chain in the fixed order, with its differences, so the screen can say why", async () => {
    // Listed out of order on purpose: the record must not depend on PDBe's order or on which download ends first.
    const rows = [row("3ccc", "A", 1.5), row("1aaa", "A", 1.2), row("2bbb", "A", 1.3)];
    const verify = async (r: BestStructureRow) => chain(r.chain_id);
    const choice = await chooseBestChain(rows, 10, "R", verify, (r) => (r.pdb_id === "2bbb" ? [] : [`${r.pdb_id}-diff`]));
    expect(choice.firstNotWildType).toEqual({ row: rows[1], differences: ["1aaa-diff"] });
    expect(choice.best?.row.pdb_id).toBe("2bbb");
  });

  it("stops downloading after a fixed number of chains even when few are eligible", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`${String(i).padStart(2, "0")}zz`, "A", 1 + i * 0.01));
    const verify = vi.fn(async (r: BestStructureRow) => chain(r.chain_id));
    const choice = await chooseBestChain(rows, 10, "R", verify, () => ["N239Y"]);
    expect(choice.best).toBeNull();
    expect(verify).toHaveBeenCalledTimes(MAX_CHAINS_DOWNLOADED);
  });

  it("compares only the first four eligible chains, never a fifth found in the same batch", async () => {
    // Batch one gives 3 eligible chains; batch two must fetch only 1 more, so a sharper 6th cannot win.
    const rows = Array.from({ length: 8 }, (_, i) => row(`${i + 1}abc`, "A", 1 + i * 0.1));
    const texts: Record<string, string> = {};
    for (const r of rows) texts[r.pdb_id] = chain("A", { neighboursComplete: r.pdb_id !== "6abc" ? false : true });
    texts["2abc"] = "";
    const verify = vi.fn(async (r: BestStructureRow) => texts[r.pdb_id] || null);
    const choice = await chooseBestChain(rows, 10, "R", verify);
    expect(verify).toHaveBeenCalledTimes(5);
    expect(choice.best?.row.pdb_id).not.toBe("6abc");
  });

  it("keeps the same duplicate mapping whichever order PDBe lists it in", async () => {
    const a = { ...row("1aaa", "A", 2.0), coverage: 0.9 };
    const b = { ...row("1aaa", "A", 2.0), coverage: 0.3 };
    const verify = async (r: BestStructureRow) => chain(r.chain_id);
    const first = await chooseBestChain([a, b], 10, "R", verify);
    const second = await chooseBestChain([b, a], 10, "R", verify);
    expect(first.best?.quality.coverage).toBe(second.best?.quality.coverage);
    expect(first.best?.quality.coverage).toBe(0.9);
  });

  it("reports no chain when none is eligible, and counts chains that did not verify", async () => {
    const rows = [row("1aaa", "A", 2.0)];
    expect((await chooseBestChain(rows, 10, "W", async r => chain(r.chain_id))).best).toBeNull();
    // A chain that does not verify is counted apart, so the caller can tell a failed lookup from "none qualify".
    const failed = await chooseBestChain(rows, 10, "R", async () => null);
    expect(failed.best).toBeNull();
    expect(failed.unverified).toBe(1);
  });
});

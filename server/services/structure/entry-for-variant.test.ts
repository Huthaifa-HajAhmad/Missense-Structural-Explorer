import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEntryForVariant } from "./structure-fetcher.ts";
import { pdbCache } from "../infra/cache.ts";
import { AnalysisDatabase } from "../infra/analysis-db.ts";

/**
 * A loaded PDB entry is shown in the variant's own numbering, or says why not.
 *
 * The fixture is a two-chain entry: chain A a 25-residue partner, chain B the protein itself in
 * author numbering offset by +100 from UniProt. Loaded whole, residue 10 of the variant would have
 * been highlighted on whatever the authors numbered 10 — here, the partner's glycine.
 */

const ACCESSION = "Q8TES1";
const SEQUENCE = "MSTNPKPQRKTKRNTNRRPQDVKFPGGGQI"; // 30 aa; residue 10 is K
const THREE: Record<string, string> = {
  M: "MET", S: "SER", T: "THR", N: "ASN", P: "PRO", K: "LYS", Q: "GLN", R: "ARG", D: "ASP", V: "VAL", F: "PHE", G: "GLY", I: "ILE",
};

function atom(serial: number, res: string, chain: string, seq: number): string {
  return (
    "ATOM  " + String(serial).padStart(5) + "  CA  " + res + " " + chain + String(seq).padStart(4) +
    "    " + (seq * 1.1).toFixed(3).padStart(8) + (seq * 0.7).toFixed(3).padStart(8) + "   0.000  1.00 30.00           C"
  );
}

function entryText(): string {
  const lines = ["HEADER    TEST COMPLEX"];
  let serial = 1;
  for (let i = 1; i <= 25; i++) lines.push(atom(serial++, "GLY", "A", i));
  lines.push("TER");
  [...SEQUENCE].forEach((aa, i) => lines.push(atom(serial++, THREE[aa], "B", 101 + i)));
  lines.push("TER", "END");
  return lines.join("\n");
}

function stubNetwork(opts: { pdbId: string; sifts: "chain-b" | "down" }) {
  vi.stubGlobal("fetch", vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes(`files.rcsb.org/download/${opts.pdbId}.pdb`)) return new Response(entryText(), { status: 200 });
    if (u.includes(`rest.uniprot.org/uniprotkb/${ACCESSION}.fasta`)) return new Response(`>sp|${ACCESSION}|TEST\n${SEQUENCE}\n`, { status: 200 });
    if (u.includes(`pdbe/api/mappings/uniprot/${opts.pdbId.toLowerCase()}`)) {
      if (opts.sifts === "down") return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          [opts.pdbId.toLowerCase()]: {
            UniProt: {
              [ACCESSION]: {
                mappings: [{ chain_id: "B", unp_start: 1, unp_end: 30, start: { author_residue_number: 101 }, end: { author_residue_number: 130 } }],
              },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("not found", { status: 404 });
  }));
}

const residueAt = (text: string, pos: number) =>
  text.split("\n").filter(l => l.startsWith("ATOM") && Number(l.slice(22, 26)) === pos).map(l => `${l.slice(17, 20)}${l.charAt(21)}`);

describe("fetchEntryForVariant", () => {
  beforeEach(() => {
    pdbCache.clear();
    AnalysisDatabase.resetInstance(":memory:");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the chain PDBe maps to the protein, renumbered to UniProt", async () => {
    stubNetwork({ pdbId: "9ZZA", sifts: "chain-b" });
    const entry = await fetchEntryForVariant("9ZZA", ACCESSION, 10, "K");
    expect(entry?.numbering).toBe("uniprot");
    expect(entry?.chainId).toBe("B");
    expect(entry?.mapping).toBe("sifts");
    expect(residueAt(entry!.pdbText, 10)).toEqual(["LYSB"]);
    // The partner chain is not drawn as if it were the protein.
    expect(entry!.pdbText).not.toMatch(/GLY A/);
  });

  it("falls back to the sequence alignment when PDBe cannot be reached", async () => {
    stubNetwork({ pdbId: "9ZZB", sifts: "down" });
    const entry = await fetchEntryForVariant("9ZZB", ACCESSION, 10, "K");
    expect(entry?.numbering).toBe("uniprot");
    expect(entry?.chainId).toBe("B");
    expect(entry?.mapping).toBe("needleman_wunsch");
    expect(residueAt(entry!.pdbText, 10)).toEqual(["LYSB"]);
  });

  it("keeps the whole entry in its own numbering, with the reason, when no chain carries the wild type there", async () => {
    stubNetwork({ pdbId: "9ZZC", sifts: "chain-b" });
    const entry = await fetchEntryForVariant("9ZZC", ACCESSION, 10, "W");
    expect(entry?.numbering).toBe("author");
    expect(entry?.chainId).toBeNull();
    expect(entry?.reason).toBe(`No chain of 9ZZC carries W10 under a verified mapping to ${ACCESSION}.`);
    expect(entry!.pdbText).toMatch(/GLY A/);
  });
});

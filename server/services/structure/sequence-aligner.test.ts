import { describe, it, expect, vi, afterEach } from "vitest";
import {
  extractPdbChainSequence,
  alignNeedlemanWunsch,
  resolvePdbCoordinatesDeterministically,
  renumberChainToUniprot
} from "./sequence-aligner.ts";

describe("Deterministic Sequence Aligner (Needleman-Wunsch & Coordinate Validation)", () => {
  const samplePdb = [
    "ATOM      1  N   MET A   1      11.104  13.205   3.120  1.00 20.00           N",
    "ATOM      2  CA  MET A   1      12.500  13.500   3.500  1.00 20.00           C",
    "ATOM      3  N   ALA A   2      13.104  14.205   4.120  1.00 20.00           N",
    "ATOM      4  CA  ALA A   2      14.500  14.500   4.500  1.00 20.00           C",
    "ATOM      5  N   PRO A   3      15.104  15.205   5.120  1.00 20.00           N",
    "ATOM      6  CA  PRO A   3      16.500  15.500   5.500  1.00 20.00           C",
    "TER       7      PRO A   3                                                  ",
    "END"
  ].join("\n");

  const shiftedPdb = [
    "ATOM      1  N   MET A  10      11.104  13.205   3.120  1.00 20.00           N",
    "ATOM      2  CA  MET A  10      12.500  13.500   3.500  1.00 20.00           C",
    "ATOM      3  N   ALA A  11      13.104  14.205   4.120  1.00 20.00           N",
    "ATOM      4  CA  ALA A  11      14.500  14.500   4.500  1.00 20.00           C",
    "ATOM      5  N   PRO A  12      15.104  15.205   5.120  1.00 20.00           N",
    "ATOM      6  CA  PRO A  12      16.500  15.500   5.500  1.00 20.00           C",
    "TER       7      PRO A  12                                                  ",
    "END"
  ].join("\n");

  it("extracts unique amino acids and sequence from PDB ATOM lines", () => {
    const extraction = extractPdbChainSequence(samplePdb, "A");
    expect(extraction.sequence).toBe("MAP");
    expect(extraction.residues.length).toBe(3);
    expect(extraction.residues[0].resSeq).toBe(1);
    expect(extraction.residues[0].resName1).toBe("M");
    expect(extraction.residues[1].resName1).toBe("A");
    expect(extraction.residues[2].resName1).toBe("P");
  });

  it("aligns shifted PDB sequence to UniProt canonical reference using Needleman-Wunsch", () => {
    const extraction = extractPdbChainSequence(shiftedPdb, "A");
    const uniprotSequence = "MAPTVR"; // First 3 are MAP
    const alignment = alignNeedlemanWunsch(extraction, uniprotSequence);

    expect(alignment.identity).toBeGreaterThan(0.4);
    // UniProt pos 1 maps to Pdb residue 10 (M)
    const res1 = alignment.uniprotPosToPdbResidueMap.get(1);
    expect(res1).toBeDefined();
    expect(res1?.resSeq).toBe(10);
    expect(res1?.resName1).toBe("M");

    // UniProt pos 2 maps to Pdb residue 11 (A)
    const res2 = alignment.uniprotPosToPdbResidueMap.get(2);
    expect(res2).toBeDefined();
    expect(res2?.resSeq).toBe(11);
    expect(res2?.resName1).toBe("A");
  });

  it("successfully resolves coordinates when residue identity matches expected wild-type", async () => {
    const result = await resolvePdbCoordinatesDeterministically({
      pdbId: "1XYZ",
      chainId: "A",
      rawPdbText: shiftedPdb,
      uniprotAccession: "P12345",
      uniprotSequence: "MAPTVR",
      targetPos: 2, // Ala at pos 2
      expectedWt1: "A"
    });

    expect(result.valid).toBe(true);
    expect(result.source).toBe("needleman_wunsch");
    expect(result.pdbText).toBeDefined();
    expect(result.pdbText).toContain("ALA A   2"); // Rewritten coordinate to match UniProt numbering
  });

  it("rejects coordinate resolution and triggers AlphaFold fallback on wild-type mismatch (No Heuristics)", async () => {
    const result = await resolvePdbCoordinatesDeterministically({
      pdbId: "1XYZ",
      chainId: "A",
      rawPdbText: shiftedPdb,
      uniprotAccession: "P12345",
      uniprotSequence: "MAPTVR",
      targetPos: 2,
      expectedWt1: "V" // Expecting Val, but PDB has Ala!
    });

    expect(result.valid).toBe(false);
    expect(result.source).toBe("alphafold_fallback");
    expect(result.pdbText).toBeNull();
    expect(result.reason).toContain("failed sequence validation");
  });
});

/**
 * Per-residue renumbering.
 *
 * The resolver used one shift, taken at the variant's position, for the whole chain. A construct
 * with an engineered insertion, a deletion or a tag was then numbered right only on the site's
 * segment. These fixtures carry a three-residue insertion (GGG) between two UniProt segments.
 */
const THREE: Record<string, string> = {
  A: "ALA", R: "ARG", N: "ASN", D: "ASP", C: "CYS", Q: "GLN", E: "GLU", G: "GLY", H: "HIS", I: "ILE",
  L: "LEU", K: "LYS", M: "MET", F: "PHE", P: "PRO", S: "SER", T: "THR", W: "TRP", Y: "TYR", V: "VAL",
};
const UNIPROT = "MKTAYIAKQRQISFVKSHFSRQ"; // 22 aa

function atomLine(record: "ATOM  " | "HETATM", serial: number, res: string, chain: string, seq: number, atom = "CA"): string {
  return (
    record + String(serial).padStart(5) + " " + (" " + atom).padEnd(4) + " " + res.padStart(3) + " " + chain +
    String(seq).padStart(4) + "    " + (seq * 1.1).toFixed(3).padStart(8) + "   0.000   0.000  1.00 30.00           C"
  );
}

/** UniProt 1–10, then GGG (not in UniProt), then UniProt 11–22; author numbers run 1–25 without a break. */
function insertionChain(): string {
  const seq = UNIPROT.slice(0, 10) + "GGG" + UNIPROT.slice(10);
  return [...seq].map((aa, i) => atomLine("ATOM  ", i + 1, THREE[aa], "A", i + 1)).join("\n");
}

const namesAt = (text: string, pos: number) =>
  text.split("\n").filter(l => (l.startsWith("ATOM") || l.startsWith("HETATM")) && Number(l.slice(22, 26)) === pos).map(l => l.slice(17, 20).trim());

describe("renumberChainToUniprot", () => {
  it("numbers each residue from the map, drops unmapped residues, waters and other chains, and moves a colliding ligand", () => {
    const text = [
      "HEADER    TEST",
      atomLine("ATOM  ", 1, "HIS", "A", -1), // tag
      atomLine("ATOM  ", 2, "HIS", "A", 0), // tag
      atomLine("ATOM  ", 3, "MET", "A", 1),
      atomLine("ATOM  ", 4, "LYS", "A", 2),
      atomLine("ATOM  ", 5, "GLY", "A", 3), // insertion
      atomLine("HETATM", 6, "MSE", "A", 4),
      atomLine("ATOM  ", 7, "THR", "A", 5),
      atomLine("ATOM  ", 8, "ALA", "B", 1), // partner chain
      atomLine("HETATM", 9, "NAD", "A", 21, "C1"), // collides with UniProt 21 once renumbered
      atomLine("HETATM", 10, " ZN", "A", 301, "ZN"),
      atomLine("HETATM", 11, "HOH", "A", 401, "O"),
      "CONECT    9   10",
      "END",
    ].join("\n");
    const map = new Map<string, number>([["1|", 20], ["2|", 21], ["4|", 22], ["5|", 23]]);
    const result = renumberChainToUniprot(text, "A", map)!;
    expect(namesAt(result.pdbText, 20)).toEqual(["MET"]);
    expect(namesAt(result.pdbText, 21)).toEqual(["LYS"]);
    expect(namesAt(result.pdbText, 22)).toEqual(["MSE"]);
    expect(namesAt(result.pdbText, 23)).toEqual(["THR"]);
    expect(result.unmappedResidues).toBe(3); // two tag residues and the insertion
    expect(result.pdbText).not.toMatch(/ HIS | GLY |ALA B|HOH|CONECT/);
    expect(namesAt(result.pdbText, 9000)).toEqual(["NAD"]);
    expect(namesAt(result.pdbText, 301)).toEqual(["ZN"]);
    expect(result.pdbText).toContain("HEADER    TEST");
  });

  it("refuses a UniProt number the PDB format cannot hold", () => {
    expect(renumberChainToUniprot(atomLine("ATOM  ", 1, "MET", "A", 1), "A", new Map([["1|", 12000]]))).toBeNull();
  });
});

describe("resolvePdbCoordinatesDeterministically — insertions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("numbers both sides of an insertion from the alignment, not from one shift at the site", async () => {
    // "1XYZ" skips the SIFTS tier, so the alignment tier decides.
    const result = await resolvePdbCoordinatesDeterministically({
      pdbId: "1XYZ", chainId: "A", rawPdbText: insertionChain(), uniprotAccession: "P12345",
      uniprotSequence: UNIPROT, targetPos: 15, expectedWt1: UNIPROT[14],
    });
    expect(result.valid).toBe(true);
    expect(result.source).toBe("needleman_wunsch");
    // Before the insertion: one shift taken at 15 would have put these three residues off by three.
    expect(namesAt(result.pdbText!, 2)).toEqual([THREE[UNIPROT[1]]]);
    expect(namesAt(result.pdbText!, 10)).toEqual([THREE[UNIPROT[9]]]);
    expect(namesAt(result.pdbText!, 15)).toEqual([THREE[UNIPROT[14]]]);
    expect(namesAt(result.pdbText!, 22)).toEqual([THREE[UNIPROT[21]]]);
    expect(result.unmappedResidues).toBe(3);
  });

  it("numbers both segments of a two-segment SIFTS mapping", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: any) => {
      if (String(url).includes("pdbe/api/mappings/uniprot/9zze")) {
        return new Response(JSON.stringify({
          "9zze": { UniProt: { P12345: { mappings: [
            { chain_id: "A", unp_start: 1, unp_end: 10, start: { author_residue_number: 1 }, end: { author_residue_number: 10 } },
            { chain_id: "A", unp_start: 11, unp_end: 22, start: { author_residue_number: 14 }, end: { author_residue_number: 25 } },
          ] } } },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }));
    const result = await resolvePdbCoordinatesDeterministically({
      pdbId: "9ZZE", chainId: "A", rawPdbText: insertionChain(), uniprotAccession: "P12345",
      uniprotSequence: UNIPROT, targetPos: 15, expectedWt1: UNIPROT[14],
    });
    expect(result.valid).toBe(true);
    expect(result.source).toBe("sifts");
    expect(namesAt(result.pdbText!, 2)).toEqual([THREE[UNIPROT[1]]]);
    expect(namesAt(result.pdbText!, 15)).toEqual([THREE[UNIPROT[14]]]);
    expect(namesAt(result.pdbText!, 22)).toEqual([THREE[UNIPROT[21]]]);
    expect(result.unmappedResidues).toBe(3);
  });

  it("reads a selenomethionine as Met when aligning", () => {
    const text = [atomLine("ATOM  ", 1, "LYS", "A", 1), atomLine("HETATM", 2, "MSE", "A", 2), atomLine("ATOM  ", 3, "THR", "A", 3)].join("\n");
    expect(extractPdbChainSequence(text, "A").sequence).toBe("KMT");
  });
});


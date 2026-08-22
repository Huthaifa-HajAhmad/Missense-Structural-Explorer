import { describe, it, expect, vi } from "vitest";
import {
  extractPdbChainSequence,
  alignNeedlemanWunsch,
  resolvePdbCoordinatesDeterministically,
  rewritePdbCoordinates
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

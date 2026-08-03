import { describe, it, expect } from "vitest";
import { 
  parseResiduesFromPdb,
  parseResiduesFromPdbMaybeAsync, 
  parseAtomsFromPdbMaybeAsync,
  getResidueDetails,
  extractSequenceFromPdb
} from "./pdb-parser.ts";

describe("Async & Sync PDB Parsers", () => {
  const mockPdbLines: string[] = [];
  for (let i = 1; i <= 4000; i++) {
    const resSeqStr = String(i).padStart(4, " ");
    mockPdbLines.push(`ATOM      1  CA  ASP A${resSeqStr}      1.000   1.000   1.000  1.00  0.00           C`);
  }
  const smallPdbText = mockPdbLines.slice(0, 10).join("\n");
  const largePdbText = mockPdbLines.join("\n");

  it("should parse residues asynchronously for large PDB files and synchronously for small ones", async () => {
    const smallRes = await parseResiduesFromPdbMaybeAsync(smallPdbText);
    expect(smallRes.length).toBe(10);
    
    const largeRes = await parseResiduesFromPdbMaybeAsync(largePdbText);
    expect(largeRes.length).toBe(4000);
  });

  it("should parse atoms asynchronously for large PDB files and synchronously for small ones", async () => {
    const smallAtoms = await parseAtomsFromPdbMaybeAsync(smallPdbText);
    expect(smallAtoms.length).toBe(10);
    
    const largeAtoms = await parseAtomsFromPdbMaybeAsync(largePdbText);
    expect(largeAtoms.length).toBe(4000);
  });

  it("should return detailed residue property annotations", () => {
    const aspDetails = getResidueDetails("ASP");
    expect(aspDetails.properties).toContain("Acidic");
    
    const unknownDetails = getResidueDetails("XYZ");
    expect(unknownDetails.properties).toBe("Unknown");
  });

  it("should extract sequence and min position from PDB string", () => {
    const result = extractSequenceFromPdb(smallPdbText, "A");
    expect(result.sequence).toContain("D");
    expect(result.minPos).toBe(1);
  });
});

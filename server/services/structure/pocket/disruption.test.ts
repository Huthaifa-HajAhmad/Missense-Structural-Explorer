import { describe, it, expect, vi } from "vitest";
import { predictStructuralDisruption } from "./disruption.ts";

describe("predictStructuralDisruption (Geometric & Secondary Structure Rules)", () => {
  // Minimal synthetic PDB with HELIX and ATOM records
  const mockHelixPdb = [
    "HELIX    1   1 ALA A    1  ALA A    5  1                                   5",
    "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 90.00           N",
    "ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 90.00           C",
    "ATOM      3  C   ALA A   1       2.000   1.400   0.000  1.00 90.00           C",
    "ATOM      4  O   ALA A   1       1.300   2.400   0.000  1.00 90.00           O",
    "ATOM      5  N   ALA A   2       3.300   1.400   0.000  1.00 90.00           N",
    "ATOM      6  CA  ALA A   2       4.000   2.700   0.000  1.00 90.00           C",
    "ATOM      7  N   ALA A   3       5.000   2.700   0.000  1.00 90.00           N",
    "ATOM      8  CA  ALA A   3       6.000   3.700   0.000  1.00 90.00           C"
  ].join("\n");

  it("predicts high disruption when Proline is introduced into a helical segment (Rule A)", async () => {
    const result = await predictStructuralDisruption(mockHelixPdb, "A", 2, "P", "A");
    expect(result.level).toBe("high");
    expect(result.reason).toContain("Proline introduced at position 2");
    expect(result.reason).toContain("helix");
    // This executes the real sidecar through tools/.venv rather than a mocked
    // subprocess, guarding the deployment path that previously returned no RSA.
    expect(result.rsa).toEqual(expect.any(Number));
    expect(result.sasaUnavailableReason).toBeUndefined();
  }, 15000);

  it("predicts low disruption for conservative substitution in a helix", async () => {
    const result = await predictStructuralDisruption(mockHelixPdb, "A", 2, "V", "A");
    expect(result.level).toBe("low");
  }, 15000);

  it("reports an AlphaFold model's B column as pLDDT", async () => {
    const result = await predictStructuralDisruption(mockHelixPdb, "A", 2, "V", "A", "alphafold");
    expect(result.plddt).toBe(90);
    expect(result.bFactorKind).toBe("plddt");
  }, 15000);

  it("never reports a crystal structure's temperature factor as pLDDT", async () => {
    // NAE1 p.Asp116Gly: the inspector printed "pLDDT 94.5 (Very High)" for 1YOV's B-factor.
    const result = await predictStructuralDisruption(mockHelixPdb, "A", 2, "V", "A", "experimental");
    expect(result.plddt).toBeNull();
    expect(result.bFactor).toBe(90);
    expect(result.bFactorKind).toBe("temperature-factor");
  }, 15000);

  it("returns unknown when target residue is not present in structure", async () => {
    const result = await predictStructuralDisruption(mockHelixPdb, "A", 99, "P", "A");
    expect(result.level).toBe("unknown");
    expect(result.reason).toContain("Target residue not found in structure");
  });
});

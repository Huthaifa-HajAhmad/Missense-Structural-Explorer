import { describe, expect, it } from "vitest";
import { describeStructureSource } from "../../../shared/residueContextEvidence";
import { PDB_SOURCE_ALPHAFOLD, PDB_SOURCE_RCSB } from "../../../shared/contracts";

/**
 * The panel header names the structure the burial word came from.
 *
 * Two mistakes are possible and both were made: calling every source "the modelled structure"
 * (wrong for an experimental PDB entry) and naming no entry at all. The inverse is worse — a
 * label fused to an id of a different provenance is a false identity — so the id is only
 * fused when the shape agrees with the source.
 *
 * The predicted case has no id in production: `core-data-fetcher` sets `resolvedPdbId` only
 * from a PDB mapping, while `resolvedPdbSource` defaults to AlphaFold. A helper that keyed off
 * the id alone therefore lost the provenance for every predicted payload.
 */
describe("describeStructureSource", () => {
  it("names an experimental entry and its provenance", () => {
    expect(describeStructureSource("1abc", PDB_SOURCE_RCSB)).toBe("experimental structure 1abc (RCSB PDB)");
    expect(describeStructureSource(" 1ABC ", PDB_SOURCE_RCSB)).toBe("experimental structure 1ABC (RCSB PDB)");
  });

  it("names a predicted model even when the payload carries no id", () => {
    // The production AlphaFold state: provenance present, id null.
    expect(describeStructureSource(null, PDB_SOURCE_ALPHAFOLD)).toBe("an AlphaFold model of this protein");
    expect(describeStructureSource(undefined, PDB_SOURCE_ALPHAFOLD)).toBe("an AlphaFold model of this protein");
  });

  it("names a predicted model by id when the id is a model id", () => {
    expect(describeStructureSource("AF-Q9H116-F1-model_v4", PDB_SOURCE_ALPHAFOLD)).toBe(
      "the AlphaFold model AF-Q9H116-F1-model_v4"
    );
  });

  it("never fuses a label to an id of a different provenance", () => {
    // Both pairs are representable: `pdbId` and `pdbSource` are independent optional strings.
    expect(describeStructureSource("1ABC", PDB_SOURCE_ALPHAFOLD)).toBe("an AlphaFold model of this protein");
    expect(describeStructureSource("AF-Q9H116-F1", PDB_SOURCE_RCSB)).toBe("structure AF-Q9H116-F1");
  });

  it("states the provenance alone when the entry is unnamed", () => {
    expect(describeStructureSource(null, PDB_SOURCE_RCSB)).toBe("an experimental structure (RCSB PDB)");
  });

  it("says plainly when the structure is unnamed or unrecognised", () => {
    expect(describeStructureSource(null, null)).toBe("the structure used for this analysis");
    expect(describeStructureSource("   ", undefined)).toBe("the structure used for this analysis");
    // A source this build does not know: name the id, claim no provenance.
    expect(describeStructureSource("1ABC", "PDBe")).toBe("structure 1ABC");
    expect(describeStructureSource("1ABC")).toBe("structure 1ABC");
  });
});

import { describe, it, expect } from "vitest";
import {
  LOCALFOLD_MAX_RESIDUES,
  LOCALFOLD_URL,
  buildLocalFoldJobJson,
  localFoldHandoff,
} from "../multimerHandoff";

/**
 * The file that moves a complex fold into the reader's browser.
 *
 * What matters: LocalFold reads one entry per chain with an `id` LIST whose length is the copy count,
 * so two chains that differ by one residue must stay two entries (merging them folds the wild type
 * twice); the dialect/version pair is one LocalFold accepts; the size warning flips exactly at the
 * budget; and the saved name is a name, not a path.
 */

const SELF = "M".repeat(115) + "G" + "AAAA";
const PARTNER = "K".repeat(80);

describe("buildLocalFoldJobJson", () => {
  it("writes one protein entry per chain, one id each, and the dialect LocalFold reads", () => {
    const job = JSON.parse(buildLocalFoldJobJson("NAE1 p.Asp116Gly", [
      { id: "A", sequence: SELF },
      { id: "B", sequence: PARTNER },
    ]));
    expect(job).toHaveLength(1);
    expect(job[0].name).toBe("NAE1 p.Asp116Gly");
    expect(job[0].dialect).toBe("alphafold3");
    expect(job[0].version).toBe(2);
    // An integer seed: the string form belongs to the server dialect.
    expect(job[0].modelSeeds).toEqual([0]);
    expect(job[0].sequences.map((entry: any) => entry.protein.id)).toEqual([["A"], ["B"]]);
    expect(job[0].sequences[0].protein.sequence).toBe(SELF);
    expect(job[0].sequences[1].protein.sequence).toBe(PARTNER);
  });

  it("carries nothing but id and sequence on a chain, so no reader guesses at an alignment", () => {
    const job = JSON.parse(buildLocalFoldJobJson("X", [{ id: "A", sequence: SELF }]));
    expect(Object.keys(job[0].sequences[0].protein).sort()).toEqual(["id", "sequence"]);
    expect(Object.keys(job[0]).sort()).toEqual(["dialect", "modelSeeds", "name", "sequences", "version"]);
  });
});

describe("localFoldHandoff", () => {
  it("names the page, sums the residues and sanitises the file name", () => {
    const handoff = localFoldHandoff("NAE1 p.Asp116Gly", [
      { id: "A", sequence: SELF },
      { id: "B", sequence: PARTNER },
    ]);
    expect(handoff.url).toBe(LOCALFOLD_URL);
    expect(handoff.residues).toBe(SELF.length + PARTNER.length);
    expect(handoff.filename).toBe("NAE1_p_Asp116Gly_localFold_job.json");
    // A name, not a path: no separators can survive, whatever the gene or variant contained.
    expect(handoff.filename).not.toMatch(/[\\/]/);
  });

  it("warns exactly past the browser budget, never at it", () => {
    const at = localFoldHandoff("X", [{ id: "A", sequence: "M".repeat(LOCALFOLD_MAX_RESIDUES) }]);
    const over = localFoldHandoff("X", [{ id: "A", sequence: "M".repeat(LOCALFOLD_MAX_RESIDUES + 1) }]);
    expect(at.residues).toBe(LOCALFOLD_MAX_RESIDUES);
    expect(at.tooLarge).toBe(false);
    expect(over.tooLarge).toBe(true);
  });
});

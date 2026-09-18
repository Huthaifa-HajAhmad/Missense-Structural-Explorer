import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPocketDescriptorVolume } from "./runner";

/**
 * P2Rank only writes a real per-pocket volume into its
 * `-export_pocket_descriptors` output, and that export's file name and column set
 * are documented outside the bundled distribution. The reader therefore discovers
 * both, and these tests pin the contract that matters: it returns a number only
 * when it found one, and null otherwise, so the caller never publishes an invented
 * volume in cubic Ångströms.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2rank-descriptors-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeDescriptor(name: string, contents: string) {
  fs.writeFileSync(path.join(dir, name), contents, "utf8");
}

describe("readPocketDescriptorVolume", () => {
  it("reads the volume of the matching pocket from the descriptor export", () => {
    writeDescriptor(
      "wt.pdb_pocket_descriptors.csv",
      ["rank,volume,sphericity", "1,412.5,0.62", "2,88.0,0.31"].join("\n")
    );

    expect(readPocketDescriptorVolume(dir, 1)).toBe(412.5);
    expect(readPocketDescriptorVolume(dir, 2)).toBe(88);
  });

  it("finds the file by pattern rather than a hard-coded name", () => {
    // The export's exact file name is not documented in the bundle, so the reader
    // must tolerate the variants P2Rank might use.
    writeDescriptor("wt.pdb_pocket-descriptor_export.csv", ["id,Volume(A3)", "3,275"].join("\n"));
    expect(readPocketDescriptorVolume(dir, 3)).toBe(275);
  });

  it("returns null when there is no descriptor export at all", () => {
    expect(readPocketDescriptorVolume(dir, 1)).toBeNull();
  });

  it("returns null when the export has no volume column", () => {
    writeDescriptor("wt.pdb_pocket_descriptors.csv", ["rank,sphericity", "1,0.62"].join("\n"));
    expect(readPocketDescriptorVolume(dir, 1)).toBeNull();
  });

  it("returns null when the requested pocket is absent instead of using another row", () => {
    writeDescriptor("wt.pdb_pocket_descriptors.csv", ["rank,volume", "1,412.5"].join("\n"));
    expect(readPocketDescriptorVolume(dir, 7)).toBeNull();
  });

  it("ignores non-positive and unparseable values", () => {
    writeDescriptor("wt.pdb_pocket_descriptors.csv", ["rank,volume", "1,0", "2,not-a-number"].join("\n"));
    expect(readPocketDescriptorVolume(dir, 1)).toBeNull();
    expect(readPocketDescriptorVolume(dir, 2)).toBeNull();
  });

  it("returns null for a missing directory rather than throwing", () => {
    expect(readPocketDescriptorVolume(path.join(dir, "nope"), 1)).toBeNull();
  });
});

/**
 * The 3D-clustering adoption record must stay in step with the thresholds it was graded against.
 *
 * The benchmark itself needs the committed gz slices and a few seconds per gene, so it is not run in the
 * unit suite. What is cheap and worth locking: the recorded decision, the grade for every pre-registered
 * gene, and the hash of the thresholds file the decision was computed from. A later edit to
 * `thresholds.json` (or to the recorded result) fails here instead of leaving the docs quoting numbers the
 * code no longer produces.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "scripts", "hotspot_benchmark");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

describe("3D-clustering benchmark record", () => {
  const results = JSON.parse(read("results.json"));

  it("was graded against the thresholds that are committed now", () => {
    expect(results.thresholdsSha256).toBe(createHash("sha256").update(read("thresholds.json")).digest("hex"));
  });

  it("adopted the score only because both pre-registered gates passed", () => {
    expect(results.decision).toBe("adopt");
    expect(results.grades.P3.pass).toBe(true);
    expect(results.grades.P5.pass).toBe(true);
  });

  it("carries a row for every gene the thresholds name, and no runtime in the scored record", () => {
    const thresholds = JSON.parse(read("thresholds.json"));
    const named: string[] = thresholds.genes;
    for (const gene of named) expect(results.genes.map((g: any) => g.gene)).toContain(gene);
    for (const gene of results.genes) expect(gene).not.toHaveProperty("runtimeMs");
  });
});

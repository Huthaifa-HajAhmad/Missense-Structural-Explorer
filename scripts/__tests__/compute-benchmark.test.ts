import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderBenchmarkMarkdown, stepPriorMs, type BenchmarkReport } from "../compute-benchmark.ts";

const report: BenchmarkReport = {
  hostClass: "arm64-emulated-2c-12g",
  measuredAt: "2026-10-12T09:00:00.000Z",
  host: { os: "linux", arch: "arm64", emulated: true, cores: 2, cpuModel: "Neoverse-N1", totalRamGiB: 12 },
  tools: [{ name: "foldx", version: "5.1", verified: true }, { name: "p2rank", version: "2.6-alpha", verified: true }],
  foldxBuildExpires: "2026-12-31",
  steps: [
    { tool: "foldx", step: "BuildModel x5", gene: "SLC12A4", residues: 1085, state: "completed", wallMs: 170_000, peakRssBytes: 900 * 1024 * 1024 },
    { tool: "p2rank", step: "predict", gene: "SLC12A4", residues: 1085, state: "failed", wallMs: 3_000, peakRssBytes: null, note: "a | b" },
  ],
};

describe("compute benchmark report", () => {
  it("renders one section per machine with the date, tools, licence date and every step", () => {
    const md = renderBenchmarkMarkdown([report]);
    expect(md).toContain("## arm64-emulated-2c-12g");
    expect(md).toContain("Measured 2026-10-12 on linux/arm64 (FoldX under Box64), 2 cores");
    expect(md).toContain("this FoldX build stops working on 2026-12-31");
    expect(md).toMatch(/\| FoldX \| BuildModel x5 \| SLC12A4 \| 1085 \| completed \| .+ \| .+ \| 900 MiB \|/);
    // A note cannot break the table, and an unmeasured peak says so.
    expect(md).toContain("| failed (a / b) |");
    expect(md).toContain("| n/a |");
  });

  it("says there is nothing yet when no machine has been measured", () => {
    expect(renderBenchmarkMarkdown([])).toContain("No measurements yet");
  });

  it("compares against the engine's current prior, per step", () => {
    expect(stepPriorMs({ tool: "foldx", step: "BuildModel x5", residues: 1085 }, true)).toBeCloseTo(167_200, -2);
    expect(stepPriorMs({ tool: "foldx", step: "RepairPDB", residues: 154 }, false)).toBeCloseTo(49_000, -2);
    expect(stepPriorMs({ tool: "p2rank", step: "predict", residues: 1085 }, true)).toBeNull();
  });

  it("marks a BuildModel row that ran on RepairPDB's output as not comparable", () => {
    const md = renderBenchmarkMarkdown([{ ...report, steps: [{ ...report.steps[0], step: "BuildModel x5", repairedInput: true }] }]);
    expect(md).toContain("| completed (repaired input) |");
  });

  it("the npm wrapper forwards flags to the script, not to node", () => {
    // `npm run compute:benchmark -- --render` becomes `node -e "…" --render`, which node rejects with
    // "bad option". The wrapper must end its -e string with ` --` so the flags arrive as argv.
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["compute:benchmark"]).toMatch(/" --$/);
  });

  it("renders the committed benchmark faithfully from its JSON, and its filename is the host class", () => {
    const dir = path.join(process.cwd(), "doc", "compute-benchmark");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const reports = files.map((f) => {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BenchmarkReport;
      expect(r.hostClass).toBe(path.basename(f, ".json"));
      return r;
    });
    const committed = fs.readFileSync(path.join(process.cwd(), "doc", "COMPUTE_BENCHMARK.md"), "utf8");
    expect(committed).toBe(renderBenchmarkMarkdown(reports));
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

/**
 * The process boundary is faked, not the runner.
 *
 * Every layer under test — the repair-cache lookup, the phase reports, the order of the stages, and
 * whether `wt_Repair.pdb` is still present when BuildModel runs — is the runner's own logic. Only
 * `execFile` is replaced: a real FoldX run is minutes of force-field work (measured: 205 s of repair),
 * and a scripted fake binary cannot stand in for it here, because modern Node refuses to `execFile` a
 * `.cmd`/`.bat` on Windows (spawn EINVAL) and CI is Linux.
 */
const foldxLog: string[] = [];
vi.mock("child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    options: { cwd?: string },
    callback: (err: Error | null, stdout: string, stderr: string) => void
  ) => {
    const command = (args.find(a => a.startsWith("--command=")) || "").split("=")[1] || "";
    const pdbArg = (args.find(a => a.startsWith("--pdb=")) || "").split("=")[1] || "wt.pdb";
    const cwd = options?.cwd || process.cwd();
    const repairPath = path.join(cwd, "wt_Repair.pdb");
    foldxLog.push(`${command} pdb=${pdbArg} repairPresent=${fs.existsSync(repairPath)}`);

    if (command === "RepairPDB") {
      fs.writeFileSync(repairPath, fs.readFileSync(path.join(cwd, pdbArg), "utf8") + "\nREMARK  99 REPAIRED\n");
    } else if (command === "BuildModel") {
      const base = path.basename(pdbArg, ".pdb");
      const mutant = fs.readFileSync(path.join(cwd, pdbArg), "utf8") + "\nREMARK  99 MUTANT\n";
      for (let run = 0; run < 5; run++) {
        fs.writeFileSync(path.join(cwd, `${base}_1_${run}.pdb`), mutant);
      }
      fs.writeFileSync(path.join(cwd, "Dif_wt.fxout"), makeDifFxout());
    }
    callback(null, `${command} done`, "");
  }
}));

const { generateMutantPdb } = await import("./runner.ts");
const {
  getRepairCacheKey,
  getRepairedStructureFromCache,
  repairedStructureCache,
  mutantCache,
  getFoldxCacheKey,
} = await import("./cache.ts");
const { cleanPdbForFoldX } = await import("./pdb-utils.ts");

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES OF THE FOLDX SAVING, DRIVEN THROUGH THE REAL RUNNER
 * ─────────────────────────────────────────────────────────────────────────────
 * Measured on this repository's own job directories: `RepairPDB` took 205.4 s while the five-run
 * mutant build took 2.2 s, and the mutant cache key contains the MUTATION — so before the repair
 * cache every variant on one template re-derived that 205 s artefact and then deleted it with the
 * job directory.
 *
 * Two things therefore have to hold, and neither is observable from the cache module alone:
 *
 *   1. A second run on the same structure does NOT invoke RepairPDB, and reports the reuse.
 *   2. The worker's real phases reach the caller, in order, and a cached repair is not announced
 *      as one that just happened.
 *
 * The FoldX binary is FAKE: a script that writes the files the runner looks for, and records every
 * invocation (and whether `wt_Repair.pdb` was present when BuildModel ran) in a log the assertions
 * read. That keeps the test hermetic — no real force-field run, no network.
 */

const MUTATION = "AA5W"; // Ala5Trp: [wt][chain][pos][mut], the FoldX form the route validates

/** A minimal, non-AlphaFold structure carrying the target residue on chain A. */
function makeWildTypePdb(marker: string): string {
  /**
   * Every residue carries a CA atom, and that is not decoration: `parseResiduesFromPdb` only records
   * a residue when it sees one (it is the atom the mapping logic keys on), so a fixture without CAs
   * parses to zero residues and the runner rejects the mutation as "not found in the structure".
   */
  const residues: Array<[string, string, number, string]> = [
    ["ALA", "A", 3, "CA"],
    ["GLY", "A", 4, "CA"],
    ["ALA", "A", 5, "CA"],
    ["SER", "A", 6, "CA"],
  ];
  const lines: string[] = [
    "HEADER    EXPERIMENTAL STRUCTURE",
    `REMARK   99 ${marker}`,
  ];
  let serial = 1;
  for (const [resName, chain, resSeq, atomName] of residues) {
    // Column-exact (the parser reads fixed offsets — see a real FoldX input):
    //   1-6 record · 7-11 serial · 13-16 atom · 18-20 resName · 22 chain · 23-26 resSeq
    //   · 31-38 x · 39-46 y · 47-54 z · 55-60 occupancy · 61-66 tempFactor
    const atom = (" " + atomName).padEnd(4);
    const x = (resSeq * 1.1).toFixed(3).padStart(8);
    const y = (resSeq * 0.7).toFixed(3).padStart(8);
    const z = (resSeq * 0.3).toFixed(3).padStart(8);
    lines.push(
      "ATOM  " +
        String(serial++).padStart(5) +
        " " +                       // column 12
        atom +                      // 13-16
        " " +                       // column 17 (altLoc)
        resName.padStart(3) +       // 18-20
        " " +                       // column 21
        chain +                     // column 22
        String(resSeq).padStart(4) + // 23-26
        "    " +                    // 27-30 (iCode + spacing)
        x + y + z +
        "  1.00 87.39"
    );
  }
  lines.push("TER", "END");
  return lines.join("\n");
}

/** The fxout table `parseFoldxDifFile` reads, in the shape FoldX 5.x writes. */
function makeDifFxout(): string {
  return [
    "FoldX 5.1 (2011)",
    "by the FoldX Consortium",
    "------------------------------------------------------",
    "",
    "PDB file analysed: batch",
    "Output type: BuildModel",
    "Pdb\ttotal energy\tBackbone Hbond\tSidechain Hbond\tVan der Waals\tElectrostatics\tSolvation Polar\tSolvation Hydrophobic\tVan der Waals clashes\tentropy sidechain\tentropy mainchain\tsloop_entropy\tmloop_entropy\tcis_bond\ttorsional clash\tbackbone clash\thelix dipole\twater bridge\tdisulfide\telectrostatic kon\tpartial covalent bonds\tenergy Ionisation\tEntropy Complex",
    "wt_1.pdb\t13.50\t2.50\t8.00\t1.50\t2.00\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0",
    "wt_2.pdb\t12.50\t3.04\t9.00\t2.10\t2.20\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0",
    "wt_3.pdb\t14.50\t3.04\t9.00\t2.10\t2.20\t1\t1\t1\t1\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0",
  ].join("\n");
}

const FAKE_FOLDX_JS = "";

let workspace: string;
let logPath: string;
const originalEnv: Record<string, string | undefined> = {};

function readLog(): string[] {
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

async function runFoldx(pdb: string, phases: string[], mutation: string = MUTATION) {
  const dir = fs.mkdtempSync(path.join(workspace, "job-"));
  return generateMutantPdb(pdb, mutation, "P00439", dir, undefined, { seed: 12345 }, phase => {
    phases.push(phase);
  });
}

describe("FoldX runner — repair reuse and phase reporting", () => {
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-runner-"));
    logPath = path.join(workspace, "foldx.log");

    for (const key of ["FOLDX_BINARY", "FOLDX_CACHE_DIR"]) {
      originalEnv[key] = process.env[key];
    }
    /**
     * Everything the runner validates on disk is built here, so this test does not depend on the
     * repository carrying FoldX's parameter files.
     *
     * It used to depend on exactly that, and the comment that stood here said so approvingly:
     * "`rotabase.txt`/`molecules/` resolve from the repository, which is what a real deployment does
     * too". That stopped being true on 2026-09-29, when FoldX's licensed parameters were untracked
     * (see .gitignore -- they ship under the CRG Academic License and cannot be redistributed). A
     * fresh clone has none of them, so CI failed with "FoldX parameter files missing: molecules/
     * directory not found in tools/foldx, tools/foldx_linux, or /app/tools/foldx" while every local
     * run stayed green, because the files are still sitting on a developer's disk.
     *
     * `detector.ts:69-71` sets `foldxDir = path.dirname(FOLDX_BINARY)`, so the fixtures belong
     * beside the fake binary and no production code has to change to accommodate the test.
     */
    const fakeBin = path.join(workspace, "foldx-fake.bin");
    fs.writeFileSync(fakeBin, "");
    fs.mkdirSync(path.join(workspace, "molecules"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "molecules", "placeholder.json"), "{}");
    fs.writeFileSync(path.join(workspace, "rotabase.txt"), "");
    process.env.FOLDX_BINARY = fakeBin;
    process.env.FOLDX_CACHE_DIR = path.join(workspace, "foldx_cache");

    foldxLog.length = 0;
    repairedStructureCache.clear();
    mutantCache.clear();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    foldxLog.length = 0;
    repairedStructureCache.clear();
    mutantCache.clear();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("reports repairing → modelling → finalizing, and caches the repaired template", async () => {
    const pdb = makeWildTypePdb("RUN-ONE");
    const phases: string[] = [];

    const result = await runFoldx(pdb, phases);

    expect(phases).toEqual(["repairing", "modelling", "finalizing"]);
    expect(result.energetics.foldxRepairFailed).toBe(false);
    expect(result.energetics.foldxRepairSkipped).toBe(false);
    // A fresh repair is NOT reported as a reuse.
    expect(result.energetics.foldxRepairCached).toBeUndefined();

    // The repaired coordinates are in the cache under the STRUCTURE's key — and that key cannot
    // contain the mutation, which is the whole reason a second variant is cheap.
    const pdbHash = crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex");
    const repairKey = getRepairCacheKey(pdbHash, { seed: 12345 });
    const cached = await getRepairedStructureFromCache(repairKey);
    expect(cached?.pdb, "the repaired template was not cached").toContain("REPAIRED");
    expect(repairKey).not.toContain(MUTATION);

    // The mutant cache key, by contrast, does vary by mutation.
    expect(getFoldxCacheKey(pdbHash, MUTATION, { seed: 12345 })).not.toBe(getFoldxCacheKey(pdbHash, "AA5F", { seed: 12345 }));

    const invocations = foldxLog;
    expect(invocations.filter(l => l.startsWith("RepairPDB"))).toHaveLength(1);
    expect(invocations.filter(l => l.startsWith("BuildModel"))).toHaveLength(1);
    /**
     * `wt_Repair.pdb` must be GONE before BuildModel runs.
     *
     * FoldX derives its input and its output names from the file it is handed, so leaving the
     * repaired file beside `wt.pdb` would change the template BuildModel selects — a silent change
     * to what is modelled, for a run whose outputs are looked up by name.
     */
    const buildLine = invocations.find(l => l.startsWith("BuildModel"));
    expect(buildLine, "BuildModel never ran").toBeTruthy();
    expect(buildLine).toContain("repairPresent=false");
  });

  it("does not invoke RepairPDB a second time for a different variant on the same structure", async () => {
    const pdb = makeWildTypePdb("RUN-TWO");

    const first = await runFoldx(pdb, []);
    expect(first.status).toBe("success");

    /**
     * A DIFFERENT substitution on the SAME structure — the case that used to re-pay the whole repair.
     *
     * (The same mutation twice would be served by the mutant cache before any of this runs, which
     * would make the assertion vacuous: it would prove the mutant cache works, not the repair cache.)
     */
    const phases: string[] = [];
    const second = await runFoldx(pdb, phases, "AA5F");

    expect(second.status).toBe("success");
    expect(phases, "a cached repair must not be announced as a fresh one").toEqual(["modelling", "finalizing"]);
    expect(second.energetics.foldxRepairCached).toBe(true);
    expect(second.energetics.foldxRepairFailed).toBe(false);

    const invocations = foldxLog;
    expect(
      invocations.filter(l => l.startsWith("RepairPDB")),
      "RepairPDB ran again for a structure whose repaired coordinates were already known"
    ).toHaveLength(1);
    expect(invocations.filter(l => l.startsWith("BuildModel"))).toHaveLength(2);
  });
});

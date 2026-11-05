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
let rejectCachedInput: "none" | "execution" | "missing-output" | "timeout" | "abort" = "none";
/** RepairPDB runs and writes no `wt_Repair.pdb`, the way a run that dies does. */
let repairWritesNothing = false;
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
    const fixFile = args.find(a => a.startsWith("--fix-residues-file="));
    foldxLog.push(`${command} pdb=${pdbArg} repairPresent=${fs.existsSync(repairPath)}${fixFile ? ` fix=${fs.readFileSync(path.join(cwd, fixFile.split("=")[1]), "utf8")}` : ""}`);

    if (command === "RepairPDB") {
      if (repairWritesNothing) { callback(null, "RepairPDB done, no file", ""); return; }
      fs.writeFileSync(repairPath, fs.readFileSync(path.join(cwd, pdbArg), "utf8") + "\nREMARK  99 REPAIRED\n");
    } else if (command === "BuildModel") {
      const input = fs.readFileSync(path.join(cwd, pdbArg), "utf8");
      if (input.includes("REJECTED") && rejectCachedInput !== "none") {
        fs.writeFileSync(path.join(cwd, "Dif_wt.fxout"), makeDifFxout());
        if (rejectCachedInput === "missing-output") { callback(null, "no model produced", ""); return; }
        const error = Object.assign(new Error("cached coordinates rejected"),
          rejectCachedInput === "timeout" ? { code: "ETIMEDOUT", killed: true }
            : rejectCachedInput === "abort" ? { name: "AbortError" } : {});
        queueMicrotask(() => callback(error, "partial output", ""));
        return { pid: undefined };
      }
      const base = path.basename(pdbArg, ".pdb");
      const mutant = fs.readFileSync(path.join(cwd, pdbArg), "utf8") + "\nREMARK  99 MUTANT\n";
      // FoldX writes its own B column; zeroed here so the test sees the template's values restored.
      const pairedWildType = fs.readFileSync(path.join(cwd, pdbArg), "utf8").replace(/ 87\.39/g, "  0.00") + "\nREMARK  99 PAIRED WT\n";
      for (let run = 0; run < 5; run++) {
        fs.writeFileSync(path.join(cwd, `${base}_1_${run}.pdb`), mutant);
        fs.writeFileSync(path.join(cwd, `WT_${base}_1_${run}.pdb`), pairedWildType);
      }
      fs.appendFileSync(path.join(cwd, "Dif_wt.fxout"), makeDifFxout());
    }
    callback(null, `${command} done`, "");
  }
}));

const { generateMutantPdb } = await import("./runner.ts");
const {
  clearRepairFailure,
  getRepairCacheKey,
  getRepairedStructureFromCache,
  writeRepairedStructureToCache,
  repairedStructureCache,
  mutantCache,
  getFoldxCacheKey,
} = await import("./cache.ts");
const { cleanPdbForFoldX } = await import("./pdb-utils.ts");
const { FIX_SHELL_MODE } = await import("../../../../src/shared/foldxRepairMode.ts");

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
/**
 * FoldX's fixtures (fake binary, `molecules/`, `rotabase.txt`) and its on-disk cache. Kept in a
 * separate temp directory from `workspace` on purpose -- see the cleanup note in `afterEach`.
 */
let foldxHome: string;
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
    foldxHome = fs.mkdtempSync(path.join(os.tmpdir(), "foldx-home-"));
    const fakeBin = path.join(foldxHome, "foldx-fake.bin");
    fs.writeFileSync(fakeBin, "");
    fs.mkdirSync(path.join(foldxHome, "molecules"), { recursive: true });
    fs.writeFileSync(path.join(foldxHome, "molecules", "placeholder.json"), "{}");
    fs.writeFileSync(path.join(foldxHome, "rotabase.txt"), "");
    process.env.FOLDX_BINARY = fakeBin;
    /**
     * Outside `workspace`, and that placement is load-bearing rather than tidy: the runner writes
     * this cache without awaiting it, so a write can still be in flight when `afterEach` deletes the
     * job tree. See the note there.
     */
    process.env.FOLDX_CACHE_DIR = path.join(foldxHome, "foldx_cache");

    foldxLog.length = 0;
    rejectCachedInput = "none";
    repairWritesNothing = false;
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
    /**
     * The retries are not decoration.
     *
     * `runner.ts:147` calls `writeMutantToCache(cacheKey, result)` WITHOUT awaiting it, which is
     * deliberate -- a FoldX result should not be held up by a cache write -- and that write goes to
     * `getFoldxCacheDir()`. While that directory sat inside `workspace`, a write still in flight
     * when this cleanup ran could create a file mid-removal and fail the test with
     *
     *   Error: ENOTEMPTY: directory not empty, rmdir '/tmp/foldx-runner-...'
     *
     * which is what CI reported on 332e748. The failure said nothing about FoldX, and it did not
     * reproduce in isolation because it needs the suite's timing. Two changes: the cache now lives
     * in `foldxHome`, outside the tree being deleted, and the retries absorb the un-awaited
     * `unlink`s in cache.ts that can likewise still be in flight.
     */
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fs.rmSync(foldxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("reports repairing → modelling → finalizing, and caches the repaired template", async () => {
    const pdb = makeWildTypePdb("RUN-ONE");
    const phases: string[] = [];

    const result = await runFoldx(pdb, phases);

    expect(phases).toEqual(["repairing", "modelling", "finalizing"]);
    // BuildModel's paired wild type travels with the variant, with the template's B-factors on it.
    expect(result.wtReferencePdb).toContain("PAIRED WT");
    expect(result.wtReferencePdb).toContain(" 87.39");
    expect(result.pdb).not.toContain("PAIRED WT");
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
    expect(getFoldxCacheKey(pdbHash, MUTATION, { seed: 12345, repairMode: "full" })).not.toBe(getFoldxCacheKey(pdbHash, "AA5F", { seed: 12345, repairMode: "full" }));

    // What the value rests on travels with it.
    expect(result.energetics).toMatchObject({
      repairMode: "full",
      repairModeIntended: "full",
      conditions: { pH: 7, temperature: 298, ionicStrength: 0.05 },
      templateExtent: { residueCount: 4, chainId: "A", firstResidue: 3, lastResidue: 6 }
    });
    expect(result.energetics.repairShell).toBeUndefined();
    expect(foldxLog.some(line => line.includes(" fix="))).toBe(false);

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

  it("repairs an AlphaFold template and preserves its confidence provenance", async () => {
    const pdb = makeWildTypePdb("ALPHAFOLD MODEL");
    const phases: string[] = [];
    const result = await runFoldx(pdb, phases);
    expect(phases).toEqual(["repairing", "modelling", "finalizing"]);
    expect(result.energetics.foldxRepairSkipped).toBe(false);
    expect(result.energetics.bFactorMetadata.source).toBe("alphafold");
    expect(result.wtReferencePdb).toContain(" 87.39");
  });

  describe("a template above 233 residues", () => {
    /** Residue i sits 5 Å along x, so the 15 Å sphere around residue 5 holds only residues 2 to 8. */
    function makeLargePdb(residues: number): string {
      const atom = makeWildTypePdb("large").split("\n").find(line => line.startsWith("ATOM"))!;
      return "REMARK   1 ALPHAFOLD MODEL\n" + Array.from({ length: residues }, (_, i) =>
        atom.slice(0, 22) + String(i + 1).padStart(4) + atom.slice(26, 30) + (i * 5).toFixed(3).padStart(8) + atom.slice(38)).join("\n");
    }

    it("is repaired locally, in the foreground, and says so", async () => {
      const pdb = makeLargePdb(442);
      const phases: string[] = [];
      const result = await runFoldx(pdb, phases);

      expect(phases).toEqual(["repairing", "modelling", "finalizing"]);
      expect(result.energetics).toMatchObject({
        repairMode: FIX_SHELL_MODE,
        repairModeIntended: FIX_SHELL_MODE,
        foldxRepairSkipped: false,
        foldxRepairFailed: false,
        // 7 residues in the sphere is under 25, so the 14 residues each side along the sequence may move too: 1 to 19.
        repairShell: { sphereResidues: 7, movableResidues: 19, totalResidues: 442, sequenceBufferApplied: true }
      });
      const repairLine = foldxLog.find(line => line.startsWith("RepairPDB"))!;
      const fixed = repairLine.split(" fix=")[1].replace(/;$/, "").split(",");
      // Everything that may NOT move is listed: the 423 residues outside 1 to 19.
      expect(fixed).toHaveLength(423);
      expect(fixed).not.toContain("AA5");
      expect(fixed[0]).toBe("AA20");
    });

    it("keeps the local repair per position: a second substitution there reuses it, another position repairs again", async () => {
      const pdb = makeLargePdb(442);
      await runFoldx(pdb, []);
      const phases: string[] = [];
      const sameSite = await runFoldx(pdb, phases, "AA5F");
      expect(phases).toEqual(["modelling", "finalizing"]);
      expect(sameSite.energetics).toMatchObject({ repairMode: FIX_SHELL_MODE, foldxRepairCached: true });
      expect(foldxLog.filter(line => line.startsWith("RepairPDB"))).toHaveLength(1);

      await runFoldx(pdb, [], "AA6F");
      expect(foldxLog.filter(line => line.startsWith("RepairPDB"))).toHaveLength(2);

      // The local repair is not the structure-wide one, so it can never be mistaken for it.
      const pdbHash = crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex");
      expect(await getRepairedStructureFromCache(getRepairCacheKey(pdbHash, { seed: 12345 }))).toBeNull();
      const site = { chain: "A", resSeq: 5, insCode: "" };
      expect((await getRepairedStructureFromCache(getRepairCacheKey(pdbHash, { seed: 12345 }, site)))?.pdb).toContain("REPAIRED");
    });

    it("does not repeat a local repair that just failed, and repairs again once the backoff is over", async () => {
      const pdb = makeLargePdb(442);
      const countOf = (command: string) => foldxLog.filter(line => line.startsWith(command)).length;

      repairWritesNothing = true;
      const failed = await runFoldx(pdb, []);
      expect(failed.energetics).toMatchObject({ repairMode: "none", repairModeIntended: FIX_SHELL_MODE, foldxRepairFailed: true });
      expect(countOf("RepairPDB")).toBe(1);

      // The next request skips the repair and says so, instead of paying the whole time cap again.
      const phases: string[] = [];
      const skipped = await runFoldx(pdb, phases);
      expect(skipped.energetics).toMatchObject({ repairMode: "none", foldxRepairFailed: true });
      expect(phases).toEqual(["modelling", "finalizing"]);
      expect(countOf("RepairPDB")).toBe(1);
      expect(countOf("BuildModel")).toBe(2); // neither fallback was cached

      // Another residue on the same structure is a different repair, so it still gets its attempt.
      await runFoldx(pdb, [], "AA6F");
      expect(countOf("RepairPDB")).toBe(2);

      // Once the backoff is over the repair runs again, succeeds, and that result is the one kept.
      repairWritesNothing = false;
      const pdbHash = crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex");
      clearRepairFailure(getRepairCacheKey(pdbHash, { seed: 12345 }, { chain: "A", resSeq: 5, insCode: "" }));
      const healed = await runFoldx(pdb, []);
      expect(healed.energetics).toMatchObject({ repairMode: FIX_SHELL_MODE, foldxRepairFailed: false });
      expect(countOf("RepairPDB")).toBe(3);
      const buildsSoFar = countOf("BuildModel");
      await runFoldx(pdb, []);
      expect(countOf("BuildModel")).toBe(buildsSoFar);
    });

    it("is cached under its own key, so the same variant is not computed twice", async () => {
      const pdb = makeLargePdb(442);
      await runFoldx(pdb, []);
      const again = await runFoldx(pdb, []);
      expect(again.energetics.repairMode).toBe(FIX_SHELL_MODE);
      expect(foldxLog.filter(line => line.startsWith("BuildModel"))).toHaveLength(1);
    });

    it("gives the same region on every run: the repair does not depend on cache warmth", async () => {
      const first = await runFoldx(makeLargePdb(442), []);
      repairedStructureCache.clear();
      mutantCache.clear();
      fs.rmSync(path.join(foldxHome, "foldx_cache"), { recursive: true, force: true });
      const second = await runFoldx(makeLargePdb(442), []);
      expect(second.energetics.repairShell).toEqual(first.energetics.repairShell);
      expect(second.energetics.rawDdGs).toEqual(first.energetics.rawDdGs);
    });
  });

  it.each(["execution", "missing-output"] as const)("invalidates a rejected cached repair and retries cleanly once (%s)", async failure => {
    const pdb = makeWildTypePdb("RECOVER");
    const key = getRepairCacheKey(crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex"));
    await writeRepairedStructureToCache(key, cleanPdbForFoldX(pdb) + "\nREMARK REJECTED\n");
    rejectCachedInput = failure;
    const result = await runFoldx(pdb, []);
    expect(result.energetics).toMatchObject({
      foldxRepairSkipped: true, foldxRepairSkippedReason: "cached-repair-rejected", foldxRepairFailed: false,
      // It ran on the unrepaired template, and says so.
      repairMode: "none", repairModeIntended: "full"
    });
    expect(result.energetics.foldxRepairCached).toBeUndefined();
    expect(result.energetics.rawDdGs).toHaveLength(3); // no appended partial results from attempt 1
    expect(await getRepairedStructureFromCache(key)).toBeNull();
    expect(foldxLog.filter(line => line.startsWith("BuildModel"))).toHaveLength(2);

    // The fallback is shown but NOT kept: its key promises a whole-chain repair, so asking again repairs
    // the template properly and caches that, instead of serving the unrepaired value for a day.
    const again = await runFoldx(pdb, []);
    expect(again.energetics).toMatchObject({ repairMode: "full", foldxRepairSkipped: false, foldxRepairFailed: false });
    expect(foldxLog.filter(line => line.startsWith("RepairPDB"))).toHaveLength(1);
    expect(foldxLog.filter(line => line.startsWith("BuildModel"))).toHaveLength(3);
  });

  it.each(["timeout", "abort"] as const)("does not blindly retry a cached-model %s", async failure => {
    const pdb = makeWildTypePdb("NO-RETRY");
    const key = getRepairCacheKey(crypto.createHash("sha256").update(cleanPdbForFoldX(pdb)).digest("hex"));
    await writeRepairedStructureToCache(key, cleanPdbForFoldX(pdb) + "\nREMARK REJECTED\n");
    rejectCachedInput = failure;
    await expect(runFoldx(pdb, [])).rejects.toThrow();
    expect(foldxLog.filter(line => line.startsWith("BuildModel"))).toHaveLength(1);
    // A user abort is not evidence that repaired coordinates are bad.
    expect(Boolean(await getRepairedStructureFromCache(key))).toBe(failure === "abort");
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

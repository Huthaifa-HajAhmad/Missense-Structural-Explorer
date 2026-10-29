import fs from "fs";
import Piscina from "piscina";
import os from "os";
import { fileURLToPath } from "url";
import path from "path";

let piscinaInstance: Piscina | null = null;

export function getBiophysicsPool(): Piscina {
  if (!piscinaInstance) {
    const prodCandidates = [
      path.resolve(process.cwd(), "dist/structural-diff-worker.cjs"),
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "structural-diff-worker.cjs") : null,
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "../dist/structural-diff-worker.cjs") : null,
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

    const devCandidates = [
      path.resolve(process.cwd(), "server/workers/structural-diff-worker.ts"),
      typeof __dirname !== "undefined" ? path.resolve(__dirname, "../../workers/structural-diff-worker.ts") : null,
    ].filter((p): p is string => Boolean(p && fs.existsSync(p)));

    const isProd = (process.env.NODE_ENV === "production" && prodCandidates.length > 0) ||
      (typeof __dirname !== "undefined" && __dirname.includes("dist"));

    const workerPath = isProd
      ? (prodCandidates[0] || path.resolve(process.cwd(), "dist/structural-diff-worker.cjs"))
      : (devCandidates[0] || path.resolve(process.cwd(), "server/workers/structural-diff-worker.ts"));

    const maxWorkersEnv = process.env.BIOPHYSICS_WORKERS ? parseInt(process.env.BIOPHYSICS_WORKERS, 10) : NaN;
    const maxWorkers = !isNaN(maxWorkersEnv) && maxWorkersEnv > 0 
      ? maxWorkersEnv 
      : Math.min(8, Math.max(1, os.cpus().length - 1));

    console.log(`[Biophysics Pool] Initializing worker pool with ${maxWorkers} threads. Worker path: ${workerPath}`);

    const execArgv = process.env.VITEST ? ["--import", "tsx"] : process.execArgv;

    piscinaInstance = new Piscina({
      filename: workerPath,
      maxThreads: maxWorkers,
      minThreads: 1,
      idleTimeout: 30000, // reclaim idle threads after 30s
      execArgv // propagate tsx in development
    });
  }
  return piscinaInstance;
}

export async function runStructuralDiffInWorker(params: {
  wtPdb: string;
  mutPdb: string;
  pos: number;
  chain: string;
}) {
  return getBiophysicsPool().run(params, { name: "runComputeStructuralDiff" });
}

export async function runAlignMutantToWtInWorker(params: {
  wtPdb: string;
  mutPdb: string;
  pos: number;
  chain: string;
  alignmentScope?: "local" | "global";
}) {
  return getBiophysicsPool().run(params, { name: "runAlignMutantToWt" });
}

/** The Hotspots view's 3D clustering and PathProx scores (src/shared/spatialClustering.ts), off the event loop. */
export async function runSpatialClusteringInWorker(params: { residues: number[]; coords: number[]; pathogenic: number[]; neutral: number[] }): Promise<{
  structureResidues: number; pathogenicResidues: number; neutralResidues: number; permutations: number;
  univariate: { area: number; p: number }; bivariate: { area: number; p: number }; clustered: boolean; threshold: number | null;
  scores: Array<[number, number]>; selfCheck: { auroc: number; pathogenic: number; neutral: number } | null;
} | null> {
  // A generous but finite cap: a permutation run over AlphaFold's 2,700-residue ceiling is minutes of
  // CPU on the pool every FoldX job shares, so a wedged run must hand its slot back rather than pin it.
  // The signal aborts inside Piscina only at task boundaries; for a pure computation the pool's own
  // abort is what releases the slot.
  const signal = AbortSignal.timeout(120_000);
  return getBiophysicsPool().run(params, { name: "runSpatialClustering", signal });
}

export async function shutdownPool() {
  if (piscinaInstance) {
    console.log("[Biophysics Pool] Draining and shutting down worker pool...");
    await piscinaInstance.destroy();
    piscinaInstance = null;
  }
}

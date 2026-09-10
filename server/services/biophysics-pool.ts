import Piscina from "piscina";
import os from "os";
import { fileURLToPath } from "url";
import path from "path";

let piscinaInstance: Piscina | null = null;

export function getBiophysicsPool(): Piscina {
  if (!piscinaInstance) {
    // Support both CommonJS (bundled prod) and ESM (tsx dev) formats without esbuild warnings
    let currentDir: string;
    if (typeof __dirname !== "undefined") {
      currentDir = __dirname;
    } else {
      // Fallback for ESM / tsx development mode where __dirname is undefined
      currentDir = path.resolve(process.cwd(), "server/services");
    }

    const isProd = process.env.NODE_ENV === "production" || currentDir.includes("dist");
    
    let workerPath: string;
    if (isProd) {
      // In production bundle, the build script will place the worker in dist/structural-diff-worker.cjs
      workerPath = path.resolve(currentDir, "structural-diff-worker.cjs");
    } else {
      workerPath = path.resolve(currentDir, "../workers/structural-diff-worker.ts");
    }

    const maxWorkersEnv = process.env.BIOPHYSICS_WORKERS ? parseInt(process.env.BIOPHYSICS_WORKERS, 10) : NaN;
    const maxWorkers = !isNaN(maxWorkersEnv) && maxWorkersEnv > 0 
      ? maxWorkersEnv 
      : Math.min(8, Math.max(1, os.cpus().length - 1));

    console.log(`[Biophysics Pool] Initializing worker pool with ${maxWorkers} threads. Worker path: ${workerPath}`);

    piscinaInstance = new Piscina({
      filename: workerPath,
      maxThreads: maxWorkers,
      minThreads: 1,
      idleTimeout: 30000, // reclaim idle threads after 30s
      execArgv: process.execArgv // propagate tsx in development
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

export async function shutdownPool() {
  if (piscinaInstance) {
    console.log("[Biophysics Pool] Draining and shutting down worker pool...");
    await piscinaInstance.destroy();
    piscinaInstance = null;
  }
}

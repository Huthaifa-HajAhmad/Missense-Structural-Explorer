/**
 * dbnsfp-reader-pool.ts — the worker that runs gene-sized dbNSFP reads (see dbnsfp-reader-core.ts).
 *
 * Same resolution rule as the analysis-db pool: the bundled `dist/dbnsfp-reader-worker.cjs` in
 * production, the TypeScript source (through tsx) in development and under Vitest.
 * `DBNSFP_READER_WORKERS` sets the thread count. Default 2: a small window (±100 residues, a point of
 * a few ms) must not queue behind a whole-gene read that takes seconds cold; measured with one thread,
 * TTN's landscape-overview waited behind the resolver's gene scan (median 14.9 s vs 7.4 s inline).
 */
import fs from "fs";
import path from "path";
import Piscina from "piscina";

let pool: Piscina | null = null;

function workerPath(): string {
  const prod = [
    path.resolve(process.cwd(), "dist/dbnsfp-reader-worker.cjs"),
    typeof __dirname !== "undefined" ? path.resolve(__dirname, "dbnsfp-reader-worker.cjs") : null,
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));
  const dev = [
    path.resolve(process.cwd(), "server/workers/dbnsfp-reader-worker.ts"),
    typeof __dirname !== "undefined" ? path.resolve(__dirname, "../../workers/dbnsfp-reader-worker.ts") : null,
  ].filter((p): p is string => Boolean(p && fs.existsSync(p)));
  const isProd = (process.env.NODE_ENV === "production" && prod.length > 0) ||
    (typeof __dirname !== "undefined" && __dirname.includes("dist"));
  return isProd
    ? (prod[0] || path.resolve(process.cwd(), "dist/dbnsfp-reader-worker.cjs"))
    : (dev[0] || path.resolve(process.cwd(), "server/workers/dbnsfp-reader-worker.ts"));
}

export function getDbnsfpReaderPool(): Piscina {
  if (!pool) {
    const requested = Number(process.env.DBNSFP_READER_WORKERS);
    const maxThreads = Number.isInteger(requested) && requested > 0 ? requested : 2;
    pool = new Piscina({
      filename: workerPath(),
      maxThreads,
      // One thread stays warm once the first gene-sized read has happened: spawning a thread, loading
      // the worker and opening the store per burst added ~1 s to a first-touch landscape read.
      minThreads: 1,
      idleTimeout: 60_000,
      execArgv: process.env.VITEST ? ["--import", "tsx"] : process.execArgv,
    });
  }
  return pool;
}

/** Stops the worker (store replaced or closed, shutdown, tests). The next read starts a new one. */
export async function closeDbnsfpReaderPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.destroy().catch(() => {});
}

#!/usr/bin/env tsx
/**
 * build-rasp-sqlite.ts — CLI entry point for the RaSP index builder.
 *
 * The implementation lives in `server/services/stability/build-rasp-sqlite.ts`, not here, because the
 * SERVER calls it: `server/services/stability/energy-models.ts` rebuilds the index when it finds one
 * that is missing, truncated or stale. It used to live in this directory and be imported across the
 * boundary — a server→scripts dependency that the documented layering rule forbids and that
 * `scripts/check-boundaries.ts` could not see, because the checker did not scan `scripts/`.
 *
 * Moving the implementation into the server makes that rule enforceable with no allow-list, and this
 * wrapper keeps the CLI, the documented usage and `npm run migrate:rasp` working unchanged.
 *
 * Usage:
 *   node scripts/build-rasp-sqlite.ts        # plain Node runs this file via type stripping
 *   npx tsx scripts/build-rasp-sqlite.ts
 *   npm run migrate:rasp
 *
 * Requires Node >=22.5.0 (`node:sqlite`).
 *
 * CORRECTION, because the first version of this comment described a guard that did not exist: the
 * implementation's block was DELETED, not relocated, and this file then called the builder
 * UNCONDITIONALLY. Importing the wrapper therefore started a 726 MB build, and the only thing
 * preventing that was an unwritten rule — "nothing imports the wrapper". The check below is the guard
 * the comment always claimed: importing this module is now inert, and the CLI still runs.
 */
import { pathToFileURL } from "node:url";
import { buildRaspSqliteDatabase } from "../server/services/stability/build-rasp-sqlite.ts";

/**
 * True only when this file is the process ENTRY point.
 *
 * Comparing the module URL against the entry path is the ESM idiom, and unlike a filename-suffix match
 * it cannot be confused with the implementation — which is named `build-rasp-sqlite.ts` as well.
 */
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href;

/**
 * `--proteome <dir>` (or RASP_PROTEOME_DIR) adds the authors' proteome-wide PRISM predictions —
 * download `rasp_preds_alphafold_UP000005640_9606_HUMAN_v2.zip` from https://sid.erda.dk/sharelink/fFPJWflLeE
 * and unzip it. Without it the index holds the experimental-structure CSV only (~1,345 proteins).
 *
 *   npm run migrate:rasp -- --proteome data/rasp_preds_alphafold_UP000005640_9606_HUMAN_v2
 */
function proteomeArg(argv: string[]): string | null {
  const i = argv.indexOf("--proteome");
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return process.env.RASP_PROTEOME_DIR?.trim() || null;
}

if (invokedDirectly) {
  buildRaspSqliteDatabase(undefined, undefined, { proteomeDir: proteomeArg(process.argv.slice(2)) }).catch(err => {
    console.error("[RaSP SQLite] Fatal:", err);
    process.exit(1);
  });
}
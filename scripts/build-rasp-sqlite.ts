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
 * The auto-run guard lives HERE and nowhere else. It matches on the file NAME, so when the
 * implementation also carried it, invoking this wrapper would have fired both — two concurrent builds
 * of the same index, into the same `<dbPath>.building`, with the atomic swap racing itself.
 */
import { buildRaspSqliteDatabase } from "../server/services/stability/build-rasp-sqlite.ts";

buildRaspSqliteDatabase().catch(err => {
  console.error("[RaSP SQLite] Fatal:", err);
  process.exit(1);
});
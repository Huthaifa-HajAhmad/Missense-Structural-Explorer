#!/usr/bin/env node
/**
 * Run the live-network proof suites under tests/proof/.
 *
 * `e2e.config.ts` excludes tests/proof/** from the default discovery, and `e2e run <path>` only narrows
 * the discovered set — it cannot re-include an excluded glob. This wrapper sets E2E_PROOF so the config
 * drops the exclusion, then runs only the proof directory. Cross-platform: no shell env syntax, and the
 * e2e CLI is spawned through this Node binary (npm.cmd cannot be resolved by a Windows spawn).
 *
 * Usage: npm run test:e2e:proof [-- <e2e args>]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const cli = resolve("node_modules/e2e/dist/cli/bin.js");
if (!existsSync(cli)) {
  console.error("e2e is not installed. Run `npm install` first.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [cli, "run", "tests/proof", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, E2E_PROOF: "1" },
});
process.exit(result.status ?? 1);

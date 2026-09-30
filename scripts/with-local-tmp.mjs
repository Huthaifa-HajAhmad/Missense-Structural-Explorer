/**
 * with-local-tmp.mjs — run a Node script with its temp directory inside the repository on Windows.
 *
 *   node scripts/with-local-tmp.mjs node_modules/vite/bin/vite.js build
 *
 * Why: esbuild (under Vite) writes large transform inputs to `os.tmpdir()` and deletes them again.
 * On Windows that delete fails with "remove C:\Users\<you>\AppData\Local\Temp\esbuild-…: Access is
 * denied" whenever antivirus or an indexer briefly holds the file, and the whole build fails even
 * though every module transformed. Pointing TEMP/TMP at `node_modules/.cache/tmp` (a directory the
 * scanner has no reason to hold, and one `.gitignore` already excludes) made the same `vite build`
 * pass where the default temp directory failed, so the build no longer depends on machine state.
 *
 * Other platforms are left alone: the failure is Windows-specific, and Docker/CI builds keep the
 * default temp directory they have always used.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The environment to hand a child process: `process.env`, with the temp directory moved on Windows. */
export function localTmpEnv(baseEnv = process.env) {
  if (process.platform !== "win32") return baseEnv;
  const tmp = path.join(root, "node_modules", ".cache", "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  return { ...baseEnv, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [script, ...args] = process.argv.slice(2);
  if (!script) {
    console.error("usage: node scripts/with-local-tmp.mjs <node-script> [args...]");
    process.exit(2);
  }
  const result = spawnSync(process.execPath, [path.resolve(root, script), ...args], {
    cwd: root,
    stdio: "inherit",
    env: localTmpEnv(),
  });
  process.exit(result.status ?? 1);
}

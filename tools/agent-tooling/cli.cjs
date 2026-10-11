#!/usr/bin/env node
/**
 * tools/agent-tooling/cli.cjs
 *
 * One entry point for the tools this directory owns, so `npm run search*` and `npm run graft` (and the
 * `graft` MCP server in `.mcp.json`) keep working even though the packages are installed HERE rather
 * than at the repository root.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `@zvec/zvec-grep` and `@nanonets/graft` are developer/agent tools. Nothing CI runs imports them —
 * not `lint`, not the tests, not `build` — and the production image never sees them either, because
 * `deploy/Dockerfile.oci` installs with `npm ci --omit=dev`. But while they sat in the root
 * `devDependencies`, every one of ~200 CI runs a cycle paid to install them: these two and their
 * transitive trees were 1,595 MB of a 2,073 MB `node_modules` — 77% of it — for tools the run never
 * touches. `@zvec/zvec-grep` alone brought `node-llama-cpp` (712 MB) and `@huggingface/transformers`
 * -> `onnxruntime-node` (298 MB). A third, `@alibaba-group/open-code-review` (57 MB), was removed
 * outright in the same change because its only consumer was `scripts/review.ts`.
 *
 * `npm ci --omit=optional` is NOT the fix: 314 packages in this lockfile are optional, and that set
 * includes the Linux platform binaries for `tsx`, `esbuild`, `rollup`, `tailwindcss` and `typescript`.
 * Omitting optional deps would strip the very binaries `lint` and `build` execute under.
 *
 * So they live in their own package instead, with their own lockfile, installed by
 * `npm run tools:install`. The root `npm ci` no longer knows they exist, and CI stops paying for them.
 *
 * WHY IT READS package.json OFF DISK INSTEAD OF RESOLVING
 * ------------------------------------------------------
 * `require.resolve("@zvec/zvec-grep/package.json")` fails: that package's `exports` map does not expose
 * `./package.json`, so Node refuses the subpath even though the file is there. Rather than depend on
 * each package's export surface, this wrapper reads the manifest from the directory npm installs it
 * into — relative to this file — and takes the bin path from the manifest. The location is ours and
 * standard; the export map is the package's business and may change.
 *
 * TWO EXECUTION MODES, AND WHY
 * ---------------------------
 * `zg` is spawned. Nothing about it needs to share this process, and a child gives clean stdio and an
 * exact exit-code pass-through.
 *
 * `graft` is loaded IN THIS PROCESS, because it needs a require-hook installed first (see
 * `patchTreeSitterGrammars`). That hook cannot be installed in a spawned wrapper's parent and reach the
 * grandchild, so graft is imported directly — the same shape the previous, untracked `tools/graft/cli.cjs`
 * used. That file's workaround is preserved here so it survives a fresh clone instead of living in a
 * gitignored directory that no clone has.
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

/**
 * Tool name (as typed) -> where it lives and how to run it.
 *
 * `patch` names the require-hook a tool needs before it can be loaded, if any.
 */
const TOOLS = {
  zg: { pkg: "@zvec/zvec-grep", bin: "dist/cli/index.js", mode: "spawn" },
  graft: { pkg: "@nanonets/graft", bin: "dist/cli.js", mode: "in-process", patch: "treeSitterGrammars" },
};

/**
 * Stub the tree-sitter grammars that ship no prebuilt binary for this platform.
 *
 * `@nanonets/graft` requires every grammar it supports at load time, and `tree-sitter-kotlin` /
 * `tree-sitter-swift` have no Windows prebuild, so `node-gyp-build` throws "No native build was found"
 * and takes the whole CLI down before it parses a single argument. Intercepting the loader for those two
 * grammars keeps graft working for the languages that DO have builds.
 *
 * What it costs, stated plainly: kotlin and swift files are not parsed, so graft under-reports symbols
 * in them on a platform without a prebuild. On a platform that has them, this hook changes nothing —
 * `node-gyp-build` would have resolved the real binding, and the stub is only returned for these two.
 */
function patchTreeSitterGrammars() {
  const Module = require("node:module");
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (id, ...rest) {
    if (id !== "node-gyp-build") {
      return originalRequire.call(this, id, ...rest);
    }
    const realLoad = originalRequire.call(this, id);
    return function (dir) {
      if (typeof dir === "string" && /tree-sitter-(kotlin|swift)\b/.test(dir)) {
        return { name: "stub" };
      }
      return realLoad(dir);
    };
  };
}

const PATCHES = { treeSitterGrammars: patchTreeSitterGrammars };

const [name, ...args] = process.argv.slice(2);
const known = Object.keys(TOOLS);

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (!name || !TOOLS[name]) {
  fail(
    `tools/agent-tooling/cli.cjs: expected a tool name, got ${name ? `"${name}"` : "nothing"}.\n` +
      `Known tools: ${known.join(", ")}\n` +
      `Usage: node tools/agent-tooling/cli.cjs <${known.join("|")}> [args...]`,
  );
}

const tool = TOOLS[name];
const pkgDir = path.join(__dirname, "node_modules", ...tool.pkg.split("/"));
const manifestPath = path.join(pkgDir, "package.json");

// NOT INSTALLED is the expected state on a fresh clone, because these are deliberately kept out of the
// root package.json. Say what to run; do not hand the reader a module-resolution stack trace.
if (!fs.existsSync(manifestPath)) {
  fail(
    `\n  ${tool.pkg} is not installed.\n\n` +
      `  These tools are kept out of the root package.json on purpose, so CI does not install them.\n` +
      `  Install them once per clone:\n\n` +
      `      npm run tools:install\n`,
  );
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (err) {
  fail(`tools/agent-tooling/cli.cjs: could not read ${manifestPath}: ${err.message}`);
}

// Take the bin path from the manifest rather than trusting the constant above, so a version bump that
// moves the entry point fails loudly here instead of executing a path that no longer exists.
const declared = typeof manifest.bin === "string" ? manifest.bin : manifest.bin && manifest.bin[name];
const entry = path.join(pkgDir, declared || tool.bin);

if (!fs.existsSync(entry)) {
  fail(
    `tools/agent-tooling/cli.cjs: ${tool.pkg} declares no runnable entry for "${name}".\n` +
      `  Looked for: ${entry}\n` +
      `  Manifest bin: ${JSON.stringify(manifest.bin)}\n` +
      `  Re-run \`npm run tools:install\`, and update TOOLS in this file if the package moved its CLI.`,
  );
}

if (tool.mode === "in-process") {
  if (tool.patch) PATCHES[tool.patch]();

  // The tool reads its own argv from index 2, and it expects to be argv[1]. Rewrite so it sees the
  // arguments the caller typed, not the wrapper's tool selector.
  process.argv = [process.argv[0], entry, ...args];

  // `import()` rather than `require()`: ESM entry points cannot be required, and graft's CLI is loaded
  // for its side effects. Stdio is already this process's, so nothing is lost by not spawning.
  import(pathToFileURL(entry).href).catch((err) => {
    fail(`tools/agent-tooling/cli.cjs: ${name} failed to load: ${err instanceof Error ? err.message : err}`);
  });
} else {
  // stdio: inherit keeps this wrapper invisible in the middle of a pipeline; the child's exit code is
  // the wrapper's, so `npm run search` reports what `zg` reported.
  const child = spawn(process.execPath, [entry, ...args], { stdio: "inherit" });
  child.on("error", (err) => {
    fail(`tools/agent-tooling/cli.cjs: could not run ${name}: ${err.message}`);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The runtime protein language models were retired on 2026-11-18 (doc/PROTEIN_LANGUAGE_MODELS_DECISION.md).
 * A fresh analysis must make no call to their routes. This scans the code that runs, so a route string
 * reintroduced anywhere (a client call, a server fetch, a sidecar router) fails here.
 */
const RETIRED_ROUTES = /\/predict\/(?:vesm|esm2|esm3|saprot|esmc)\b|\/esm3-structure-eval\b|\/analyze-variant\/esm/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sourceFiles(full);
    const isSource = /\.(ts|tsx|py)$/.test(entry.name);
    const isTest = /\.test\.(ts|tsx)$/.test(entry.name) || entry.name.startsWith("test_") || full.includes(`${path.sep}__tests__${path.sep}`);
    return isSource && !isTest ? [full] : [];
  });
}

describe("retired protein language models", () => {
  it("are not called by any client, server or sidecar code", () => {
    const roots = ["src", "server", path.join("tools", "model_server_app"), path.join("tools", "model_server.py")];
    const offenders = roots
      .map(root => path.join(process.cwd(), root))
      .flatMap(root => (fs.statSync(root).isDirectory() ? sourceFiles(root) : [root]))
      .filter(file => RETIRED_ROUTES.test(fs.readFileSync(file, "utf-8")))
      .map(file => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});

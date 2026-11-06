import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * doc/STATE_MACHINES.md names the files and functions behind each state machine. When code is renamed
 * or removed and the document is not updated, the document starts sending readers (people and agents)
 * to things that do not exist. This test fails then, and says which names to fix.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const DOC = fs.readFileSync(path.join(ROOT, "doc", "STATE_MACHINES.md"), "utf8");
const SOURCE_DIRS = ["server", "src", "deploy"];
const PATH_BASES = ["", "server", "src", "server/services", "server/services/infra"];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sourceFiles(full);
    return /\.(ts|tsx|py)$/.test(entry.name) ? [full] : [];
  });
}

const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));
const fileNames = new Set(files.map((f) => path.basename(f)));
const allSource = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const quoted = [...DOC.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/\(\)$/, ""));

const isPath = (token: string) => /\.(ts|tsx|py|md)$/.test(token) && !token.includes("*");
const isCodeName = (token: string) =>
  /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*$/.test(token) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(token);

function pathExists(token: string): boolean {
  if (!token.includes("/")) return fileNames.has(token) || fs.existsSync(path.join(ROOT, "doc", token));
  return PATH_BASES.some((base) => fs.existsSync(path.join(ROOT, base, token)));
}

describe("doc/STATE_MACHINES.md", () => {
  it("names only files that exist", () => {
    expect([...new Set(quoted.filter(isPath))].filter((p) => !pathExists(p))).toEqual([]);
  });

  it("names only functions, classes and constants that exist in the code", () => {
    expect([...new Set(quoted.filter(isCodeName))].filter((name) => !allSource.includes(name))).toEqual([]);
  });
});

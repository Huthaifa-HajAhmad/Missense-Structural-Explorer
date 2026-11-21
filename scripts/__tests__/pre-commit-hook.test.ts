import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { installPreCommitHook } from "../install-hooks.mjs";

const tempDirs: string[] = [];

// The hook only runs `npm run map:check` when node_modules/tsx exists, so the temp
// repo gets an empty tsx folder and a map:check script that passes or fails on demand.
function makeRepo(mapCheckExitCode: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-precommit-"));
  tempDirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  fs.mkdirSync(path.join(dir, "node_modules", "tsx"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "git-hooks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  fs.mkdirSync(path.join(dir, "doc", "code-map"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "temp",
      scripts: { "map:check": `node -e "process.exit(${mapCheckExitCode})"` },
    })
  );
  fs.writeFileSync(path.join(dir, "doc", "code-map", "map.csv"), "a\n");
  git("add", "package.json", "doc/code-map/map.csv");
  git("commit", "-m", "base", "--no-verify");
  fs.copyFileSync(
    path.resolve(process.cwd(), "scripts", "git-hooks", "pre-commit"),
    path.join(dir, "scripts", "git-hooks", "pre-commit")
  );
  expect(installPreCommitHook(dir).status).toBe("installed");
  return dir;
}

function commitFrom(repo: string, subdir: string) {
  return spawnSync("git", ["commit", "-m", "change"], {
    cwd: path.join(repo, subdir),
    encoding: "utf-8",
  });
}

function stage(repo: string, file: string, content: string) {
  fs.writeFileSync(path.join(repo, file), content);
  execFileSync("git", ["add", file], { cwd: repo, stdio: "ignore" });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("pre-commit code-map guard", () => {
  it("blocks a commit when map:check fails, also when committing from a subdirectory", () => {
    const repo = makeRepo(1);
    stage(repo, "server/a.ts", "export {};\n");

    const result = commitFrom(repo, "scripts");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("doc/code-map/ is out of date");
  });

  it("blocks a commit when doc/code-map/ has unstaged updates", () => {
    const repo = makeRepo(0);
    stage(repo, "server/a.ts", "export {};\n");
    fs.writeFileSync(path.join(repo, "doc", "code-map", "map.csv"), "a\nb\n");

    const result = commitFrom(repo, "scripts");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unstaged updates");
  });

  it("lets a commit through when map:check passes and nothing is unstaged", () => {
    const repo = makeRepo(0);
    stage(repo, "server/a.ts", "export {};\n");

    expect(commitFrom(repo, "scripts").status).toBe(0);
  });

  it("does not run map:check when no server, src or code-map file is staged", () => {
    const repo = makeRepo(1);
    stage(repo, "notes.txt", "hello\n");

    expect(commitFrom(repo, ".").status).toBe(0);
  });
});

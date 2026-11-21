import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { installPreCommitHook } from "../install-hooks.mjs";

const tempDirs: string[] = [];

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-hooks-test-"));
  tempDirs.push(dir);
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  fs.mkdirSync(path.join(dir, "scripts", "git-hooks"), { recursive: true });
  fs.copyFileSync(
    path.resolve(process.cwd(), "scripts", "git-hooks", "pre-commit"),
    path.join(dir, "scripts", "git-hooks", "pre-commit")
  );
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("installPreCommitHook", () => {
  it("installs the managed pre-commit hook and is idempotent", () => {
    const repo = makeTempRepo();

    const first = installPreCommitHook(repo);
    expect(first.status).toBe("installed");
    expect(fs.existsSync(path.join(repo, ".git", "hooks", "pre-commit"))).toBe(true);

    const second = installPreCommitHook(repo);
    expect(second.status).toBe("unchanged");
  });

  it("preserves an existing unmanaged pre-commit hook", () => {
    const repo = makeTempRepo();
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, "#!/bin/sh\necho custom\n");

    const result = installPreCommitHook(repo);
    expect(result.status).toBe("preserved");
    expect(fs.readFileSync(hookPath, "utf-8")).toBe("#!/bin/sh\necho custom\n");
  });

  it("skips cleanly outside a git repository (such as Docker build stages)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-no-git-"));
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, "scripts", "git-hooks"), { recursive: true });
    fs.copyFileSync(
      path.resolve(process.cwd(), "scripts", "git-hooks", "pre-commit"),
      path.join(dir, "scripts", "git-hooks", "pre-commit")
    );

    const result = installPreCommitHook(dir);
    expect(result).toEqual({ status: "skipped", reason: "not a git repository" });
  });
});

import { execFileSync, execSync } from "child_process";
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

function prepareCommand(): string {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
  return pkg.scripts.prepare;
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

  it.skipIf(process.platform === "win32")("makes an unchanged managed hook executable again", () => {
    const repo = makeTempRepo();
    const hookPath = path.join(repo, ".git", "hooks", "pre-commit");
    installPreCommitHook(repo);
    fs.chmodSync(hookPath, 0o644);

    expect(installPreCommitHook(repo).status).toBe("unchanged");
    expect(fs.statSync(hookPath).mode & 0o111).not.toBe(0);
  });

  it("installs the hook when the package.json prepare script runs", () => {
    const repo = makeTempRepo();
    fs.copyFileSync(
      path.resolve(process.cwd(), "scripts", "install-hooks.mjs"),
      path.join(repo, "scripts", "install-hooks.mjs")
    );

    execSync(prepareCommand(), { cwd: repo, stdio: "ignore" });

    expect(fs.existsSync(path.join(repo, ".git", "hooks", "pre-commit"))).toBe(true);
  });

  it("lets the prepare script exit cleanly when the installer file is absent", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mse-no-installer-"));
    tempDirs.push(dir);

    expect(() => execSync(prepareCommand(), { cwd: dir, stdio: "ignore" })).not.toThrow();
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

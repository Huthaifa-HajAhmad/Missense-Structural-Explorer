import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const MANAGED_MARKER = "# managed-by: scripts/install-hooks.mjs";

export function installPreCommitHook(repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const sourceHook = path.join(repoRoot, "scripts", "git-hooks", "pre-commit");
  if (!fs.existsSync(sourceHook)) {
    return { status: "skipped", reason: "hook template missing" };
  }

  let commonDirRaw;
  try {
    commonDirRaw = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { status: "skipped", reason: "not a git repository" };
  }

  if (!commonDirRaw) {
    return { status: "skipped", reason: "git common dir not found" };
  }

  const commonDir = path.isAbsolute(commonDirRaw) ? commonDirRaw : path.resolve(repoRoot, commonDirRaw);
  const hooksDir = path.join(commonDir, "hooks");
  const targetHook = path.join(hooksDir, "pre-commit");
  const desired = fs.readFileSync(sourceHook, "utf-8").replace(/\r\n/g, "\n");

  if (fs.existsSync(targetHook)) {
    const existing = fs.readFileSync(targetHook, "utf-8");
    if (!existing.includes(MANAGED_MARKER)) {
      return { status: "preserved", path: targetHook };
    }
    if (existing.replace(/\r\n/g, "\n") === desired) {
      makeExecutable(targetHook);
      return { status: "unchanged", path: targetHook };
    }
  }

  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(targetHook, desired, { mode: 0o755 });
  makeExecutable(targetHook);
  return { status: "installed", path: targetHook };
}

// Git skips a hook that is not executable, so repair the mode on every run.
function makeExecutable(hookPath) {
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // Windows filesystems ignore POSIX mode bits.
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  const result = installPreCommitHook();
  if (result.status === "installed") {
    console.log(`Installed pre-commit code-map guard at ${result.path}`);
  } else if (result.status === "preserved") {
    console.warn(
      `Skipped installing pre-commit hook: existing unmanaged hook at ${result.path}. ` +
        "The code-map guard is NOT active; run `npm run map:check` before committing."
    );
  }
}

import path from "path";
import fs from "fs";

export function getFoldxExecutionTarget(foldxBin: string, args: string[]): { file: string; args: string[] } {
  const isLinux = process.platform === "linux";
  const isArm = process.arch === "arm64" || process.arch === "arm";
  const box64Candidate = process.env.BOX64_PATH || "/usr/local/bin/box64";

  if (isLinux && (isArm || process.env.USE_BOX64 === "true") && fs.existsSync(box64Candidate)) {
    return {
      file: box64Candidate,
      args: [foldxBin, ...args]
    };
  }
  return {
    file: foldxBin,
    args
  };
}

export function detectFoldxBinaryAndDir(): { foldxBin: string; foldxDir: string } {
  let foldxBin = process.env.FOLDX_BINARY || "foldx";
  let foldxDir = "";

  if (foldxBin === "foldx") {
    const candidateDirs = [
      process.env.FOLDX_DIR,
      path.join(process.cwd(), "tools", process.platform === "win32" ? "foldx" : "foldx_linux"),
      path.join(process.cwd(), "tools", "foldx_linux"),
      path.join(process.cwd(), "tools", "foldx"),
      "/app/tools/foldx_linux",
      "/app/tools/foldx"
    ].filter(Boolean) as string[];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        const exeFile = files.find(f => {
          const fullPath = path.join(dir, f);
          try {
            if (!fs.statSync(fullPath).isFile()) return false;
          } catch (_) {
            return false;
          }
          const lower = f.toLowerCase();
          if (process.platform === "win32") {
            return lower.startsWith("foldx") && lower.endsWith(".exe");
          } else {
            return (
              lower.startsWith("foldx") &&
              !lower.endsWith(".exe") &&
              !lower.endsWith(".txt") &&
              !lower.endsWith(".cmd") &&
              !lower.endsWith(".bat") &&
              !lower.endsWith(".ps1") &&
              !lower.endsWith(".sh") &&
              !lower.endsWith(".zip")
            );
          }
        });
        if (exeFile) {
          foldxBin = path.join(dir, exeFile);
          foldxDir = dir;
          break;
        }
      } catch (_) {}
    }
  } else {
    foldxDir = path.dirname(foldxBin);
  }

  return { foldxBin, foldxDir };
}

import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let cachedJavaHome: string | null = null;
let cachedJavaVersion: string | null = null;
let cachedJavaHomeChecked = false;

export async function checkJavaVersion(javaExePath: string): Promise<boolean> {
  try {
    const { stderr, stdout } = await execFileAsync(javaExePath, ["-version"], { timeout: 3000 });
    const versionStr = (stderr || stdout || "").toString();
    // Match version patterns: e.g. "17.0.x", "21.0.x", or legacy "1.8.0"
    const match = versionStr.match(/version\s+"(\d+)(?:\.(\d+))?/i);
    if (!match) return false;
    let major = parseInt(match[1], 10);
    if (major === 1 && match[2]) {
      major = parseInt(match[2], 10);
    }
    cachedJavaVersion = match[1] + (match[2] ? `.${match[2]}` : "");
    // P2Rank 2.6-alpha bytecode (class format 61.0) requires Java 17 or higher
    return major >= 17;
  } catch {
    return false;
  }
}

export async function discoverJavaHome(): Promise<string | null> {
  if (cachedJavaHomeChecked) {
    return cachedJavaHome;
  }

  // 1. Explicit override via P2RANK_JAVA_HOME
  if (process.env.P2RANK_JAVA_HOME) {
    const candidatePath = path.join(process.env.P2RANK_JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(candidatePath) && await checkJavaVersion(candidatePath)) {
      cachedJavaHome = process.env.P2RANK_JAVA_HOME;
      cachedJavaHomeChecked = true;
      console.log(`[Pocket Finder ML] Using explicit P2RANK_JAVA_HOME: ${cachedJavaHome}`);
      return cachedJavaHome;
    }
  }

  // 2. Check existing env JAVA_HOME
  if (process.env.JAVA_HOME) {
    const candidatePath = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(candidatePath) && await checkJavaVersion(candidatePath)) {
      cachedJavaHome = process.env.JAVA_HOME;
      cachedJavaHomeChecked = true;
      return cachedJavaHome;
    }
  }

  // 3. Check system default 'java'
  const defaultJavaExe = process.platform === "win32" ? "java.exe" : "java";
  if (await checkJavaVersion(defaultJavaExe)) {
    cachedJavaHome = "";
    cachedJavaHomeChecked = true;
    return cachedJavaHome;
  }

  // 4. Scan user directories and standard JDK/JRE locations
  const candidates: string[] = [];
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";

  if (userProfile) {
    const gradleJdksDir = path.join(userProfile, ".gradle", "jdks");
    if (fs.existsSync(gradleJdksDir)) {
      try {
        const folders = fs.readdirSync(gradleJdksDir);
        for (const folder of folders) {
          candidates.push(path.join(gradleJdksDir, folder));
        }
      } catch (_) {}
    }

    const jdksDir = path.join(userProfile, ".jdks");
    if (fs.existsSync(jdksDir)) {
      try {
        const folders = fs.readdirSync(jdksDir);
        for (const folder of folders) {
          candidates.push(path.join(jdksDir, folder));
        }
      } catch (_) {}
    }
  }

  const standardDirs = [
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Microsoft",
    "C:\\Program Files\\Semeru",
    "C:\\Program Files\\BellSoft",
    "C:\\Program Files\\Amazon Corretto",
    "C:\\Program Files\\Android\\Android Studio\\jbr",
    path.join(process.cwd(), "tools", "jre17"),
    path.join(process.cwd(), "tools", "jdk17"),
    path.join(process.cwd(), "tools", "p2rank", "jre")
  ];
  for (const sDir of standardDirs) {
    if (fs.existsSync(sDir)) {
      candidates.push(sDir);
      try {
        const folders = fs.readdirSync(sDir);
        for (const folder of folders) {
          candidates.push(path.join(sDir, folder));
        }
      } catch (_) {}
    }
  }

  // Probe candidates sequentially
  for (const candidate of candidates) {
    const javaExe = path.join(candidate, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(javaExe)) {
      if (await checkJavaVersion(javaExe)) {
        cachedJavaHome = candidate;
        cachedJavaHomeChecked = true;
        console.log(`[Pocket Finder ML] Auto-discovered compatible Java 17+ home: ${candidate}`);
        return cachedJavaHome;
      }
    }
  }

  cachedJavaHome = null;
  cachedJavaHomeChecked = true;
  return null;
}

export function _resetJavaHomeCache(): void {
  cachedJavaHome = null;
  cachedJavaVersion = null;
  cachedJavaHomeChecked = false;
}

export async function checkP2RankCapability(): Promise<{
  installed: boolean;
  path: string | null;
  javaHome: string | null;
  javaVersionCompatible: boolean;
  javaVersion?: string | null;
  ready: boolean;
  status: "ready" | "standby" | "unavailable";
}> {
  let p2rankCmd: string | null = null;
  const localP2rankDir = path.join(process.cwd(), "tools", "p2rank");
  if (fs.existsSync(localP2rankDir)) {
    try {
      const files = fs.readdirSync(localP2rankDir);
      for (const f of files) {
        const subPath = path.join(localP2rankDir, f);
        if (fs.statSync(subPath).isDirectory()) {
          const batFile = path.join(subPath, "prank.bat");
          const shFile = path.join(subPath, "prank");
          if (process.platform === "win32" && fs.existsSync(batFile)) {
            p2rankCmd = batFile;
            break;
          } else if (fs.existsSync(shFile)) {
            p2rankCmd = shFile;
            break;
          }
        }
      }
    } catch (_) {}
  }

  const javaHome = await discoverJavaHome();
  const javaCompatible = javaHome !== null;
  const ready = Boolean(p2rankCmd && javaCompatible);
  const status = ready ? "ready" : (p2rankCmd && !javaCompatible ? "unavailable" : "standby");

  return {
    installed: Boolean(p2rankCmd),
    path: p2rankCmd,
    javaHome,
    javaVersionCompatible: javaCompatible,
    javaVersion: cachedJavaVersion,
    ready,
    status
  };
}

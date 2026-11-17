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

function javaExeIn(homeDir: string): string {
  return path.join(homeDir, "bin", process.platform === "win32" ? "java.exe" : "java");
}

async function isCompatibleJavaHome(homeDir: string): Promise<boolean> {
  const candidatePath = javaExeIn(homeDir);
  return fs.existsSync(candidatePath) && await checkJavaVersion(candidatePath);
}

function readSubdirectories(parentDir: string): string[] {
  if (!fs.existsSync(parentDir)) return [];
  try {
    return fs.readdirSync(parentDir).map(folder => path.join(parentDir, folder));
  } catch (_) {
    return [];
  }
}

function collectJavaCandidates(): string[] {
  const candidates: string[] = [];
  const userProfile = process.env.USERPROFILE || process.env.HOME || "";

  if (userProfile) {
    candidates.push(...readSubdirectories(path.join(userProfile, ".gradle", "jdks")));
    candidates.push(...readSubdirectories(path.join(userProfile, ".jdks")));
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
      candidates.push(sDir, ...readSubdirectories(sDir));
    }
  }
  return candidates;
}

async function findEnvJavaHome(): Promise<string | null> {
  // 1. Explicit override via P2RANK_JAVA_HOME
  const override = process.env.P2RANK_JAVA_HOME;
  if (override && await isCompatibleJavaHome(override)) {
    console.log(`[Pocket Finder ML] Using explicit P2RANK_JAVA_HOME: ${override}`);
    return override;
  }

  // 2. Check existing env JAVA_HOME
  const envHome = process.env.JAVA_HOME;
  if (envHome && await isCompatibleJavaHome(envHome)) {
    return envHome;
  }

  return null;
}

async function findPathJavaHome(): Promise<string | null> {
  // 3. Check system default 'java'
  const defaultJavaExe = process.platform === "win32" ? "java.exe" : "java";
  return await checkJavaVersion(defaultJavaExe) ? "" : null;
}

async function findInstalledJavaHome(): Promise<string | null> {
  // 4. Scan user directories and standard JDK/JRE locations sequentially
  for (const candidate of collectJavaCandidates()) {
    if (await isCompatibleJavaHome(candidate)) {
      console.log(`[Pocket Finder ML] Auto-discovered compatible Java 17+ home: ${candidate}`);
      return candidate;
    }
  }
  return null;
}

export async function discoverJavaHome(): Promise<string | null> {
  if (cachedJavaHomeChecked) {
    return cachedJavaHome;
  }

  const discovered =
    (await findEnvJavaHome()) ??
    (await findPathJavaHome()) ??
    (await findInstalledJavaHome());

  cachedJavaHome = discovered;
  cachedJavaHomeChecked = true;
  return cachedJavaHome;
}

export function _resetJavaHomeCache(): void {
  cachedJavaHome = null;
  cachedJavaVersion = null;
  cachedJavaHomeChecked = false;
}

function findLocalP2RankCommand(): string | null {
  const localP2rankDir = path.join(process.cwd(), "tools", "p2rank");
  if (!fs.existsSync(localP2rankDir)) return null;
  try {
    for (const f of fs.readdirSync(localP2rankDir)) {
      const subPath = path.join(localP2rankDir, f);
      if (!fs.statSync(subPath).isDirectory()) continue;
      const batFile = path.join(subPath, "prank.bat");
      const shFile = path.join(subPath, "prank");
      if (process.platform === "win32" && fs.existsSync(batFile)) return batFile;
      if (fs.existsSync(shFile)) return shFile;
    }
  } catch (_) {}
  return null;
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
  const p2rankCmd = findLocalP2RankCommand();
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

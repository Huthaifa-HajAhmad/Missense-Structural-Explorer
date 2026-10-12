/**
 * tools.ts — the agent sets up its own tools, so a person never downloads, unpacks or points at anything
 * (plan decision 7, WP-F2).
 *
 *   Java + P2Rank  open source: downloaded on first start from PINNED releases, each checked against a
 *                  pinned SHA-256 before it is unpacked. A mismatch is discarded, never installed.
 *   FoldX          licensed: from the workspace's team bundle (the admin uploaded it; checked against the
 *                  server's SHA-256), or from the zip the person drops on the setup page ("guided"). A
 *                  revoked team bundle is erased at the next contact.
 *
 * After any change the SAME self-tests the server runs on itself (`probeToolsNow`, host-probe.ts) decide
 * what the computer offers. A tool that is missing or fails is simply not offered: FoldX jobs then run on
 * the server and P2Rank still runs here. A half-set-up computer degrades, it does not break.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import JSZip from "jszip";
import type { AgentToolReport, FoldxSource } from "../../src/shared/agentProtocol.ts";
import { probeToolsNow, type ToolCheck } from "../services/infra/host-probe.ts";
import { _resetJavaHomeCache } from "../services/structure/pocket/java-detector.ts";
import { checkFoldxArchive, installFoldxArchive, isFoldxPlatform, PLATFORM_LABEL } from "../services/infra/foldx-archive.ts";
import { javaHomeIn, paths, type AgentState } from "./state.ts";
import type { ServerClient } from "./client.ts";

interface Pinned {
  url: string;
  sha256: string;
  kind: "zip" | "tar.gz";
}

/**
 * Eclipse Temurin JRE 21.0.12.1+1 (P2Rank needs Java 17 or newer), from the Adoptium API's published checksums.
 * Bump all five together, with the hashes the Adoptium API publishes (api.adoptium.net, /v3/assets/latest/21/hotspot).
 */
export const PINNED_JRE: Record<string, Pinned> = {
  "win32-x64": {
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip",
    sha256: "d35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636",
    kind: "zip",
  },
  "linux-x64": {
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz",
    sha256: "2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500",
    kind: "tar.gz",
  },
  "linux-arm64": {
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
    sha256: "14be1f35ebdbd1f6e8d57eb911a3ffb74d6d9aa255abc5daf2b1302002cf2cf2",
    kind: "tar.gz",
  },
  "darwin-x64": {
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_mac_hotspot_21.0.12.1_1.tar.gz",
    sha256: "6717ec641fd9ce0bb209ca083ee23b42202ac68cb6fcc5753496e0e4a0f41989",
    kind: "tar.gz",
  },
  "darwin-arm64": {
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_aarch64_mac_hotspot_21.0.12.1_1.tar.gz",
    sha256: "dec50fc6f9fcd4fe3ae8cabf5a5fa68f6afc48841f7698e468e9aa5d54beed84",
    kind: "tar.gz",
  },
};

/**
 * P2Rank 2.6-alpha: the version the server runs, so a computer's pocket result shares the server's cache
 * key (agent-jobs.ts `keyVersion`). SHA-256 from the GitHub release's published digest.
 */
export const PINNED_P2RANK: Pinned & { version: string; folder: string } = {
  url: "https://github.com/rdk/p2rank/releases/download/2.6-alpha/p2rank_2.6-alpha.tar.gz",
  sha256: "d0284cf47e2605c21c6285b30076f33cb7e509359fb9ed4b1808c3274f6f2592",
  kind: "tar.gz",
  version: "2.6-alpha",
  folder: "p2rank_2.6-alpha",
};

export function platformKey(): string {
  return `${process.platform}-${process.arch}`;
}

/** Stream `url` to `dest`, verifying SHA-256 as it arrives. A mismatch deletes the file and throws. */
export async function downloadVerified(
  url: string,
  dest: string,
  sha256: string,
  init: RequestInit = {},
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  // A complete, verified file from an earlier attempt (one whose unpacking failed) is not fetched again.
  if (fs.existsSync(dest)) {
    const have = crypto.createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
    if (have === sha256.toLowerCase()) return;
    fs.rmSync(dest, { force: true });
  }
  const res = await fetch(url, { redirect: "follow", ...init });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const hash = crypto.createHash("sha256");
  let received = 0;
  // `pipeline` turns a write error (a full disk) into a rejection here, instead of an unhandled 'error'
  // event that would end the agent.
  async function* measured(source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      hash.update(chunk);
      received += chunk.length;
      onProgress?.(received, total);
      yield chunk;
    }
  }
  try {
    await pipeline(Readable.fromWeb(res.body as any), measured, fs.createWriteStream(tmp));
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  const got = hash.digest("hex");
  if (got !== sha256.toLowerCase()) {
    fs.rmSync(tmp, { force: true });
    throw new Error("the download did not match its expected checksum and was discarded");
  }
  fs.renameSync(tmp, dest);
}

/** A zip entry's path inside `destDir`, or null when it would land outside it (`../`, absolute, drive). */
export function safeJoin(destDir: string, entry: string): string | null {
  const clean = entry.replace(/\\/g, "/");
  if (clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split("/").includes("..")) return null;
  const full = path.resolve(destDir, clean);
  const root = path.resolve(destDir) + path.sep;
  return full.startsWith(root) ? full : null;
}

export async function unpack(archive: string, destDir: string, kind: Pinned["kind"]): Promise<void> {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  if (kind === "zip") {
    const zip = await JSZip.loadAsync(fs.readFileSync(archive));
    for (const f of Object.values(zip.files)) {
      const target = safeJoin(destDir, f.name);
      if (!target) throw new Error("the archive contains an unsafe path");
      if (f.dir) {
        fs.mkdirSync(target, { recursive: true });
        continue;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await f.async("nodebuffer"));
      const mode = (f as unknown as { unixPermissions?: number }).unixPermissions;
      if (process.platform !== "win32" && mode && mode & 0o111) fs.chmodSync(target, 0o755);
    }
    return;
  }
  // tar is part of Windows 10+ (bsdtar), macOS and Linux. GNU and BSD tar both refuse `..` members by default.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tarCommand(), ["-xzf", archive, "-C", destDir], { windowsHide: true, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
  });
}

/**
 * Windows' own tar (System32, bsdtar), by full path: a GNU tar earlier on PATH (Git for Windows ships one)
 * reads "C:\…" as a remote host name and fails.
 */
function tarCommand(): string {
  if (process.platform !== "win32") return "tar";
  const system = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  return fs.existsSync(system) ? system : "tar";
}

/** Snapshot of where each tool is, for the report and the setup page. */
export interface ToolsStatus {
  foldx: AgentToolReport;
  p2rank: AgentToolReport;
}

export class ToolsManager {
  status: ToolsStatus = {
    foldx: { state: "missing", version: null, detail: null },
    p2rank: { state: "missing", version: null, detail: null },
  };
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly state: () => AgentState, private readonly save: (patch: Partial<AgentState>) => void) {}

  /** One change at a time: two installs must not unpack into the same folder at once. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => {});
    return run;
  }

  /** Re-run the self-tests and publish what they found. */
  async refresh(): Promise<void> {
    _resetJavaHomeCache();
    const javaHome = javaHomeIn(paths.jre());
    if (javaHome) process.env.P2RANK_JAVA_HOME = javaHome;
    const { foldx, p2rank } = await probeToolsNow();
    if (this.status.foldx.state !== "installing") this.status.foldx = toReport(foldx, "FoldX", this.state().foldxSource);
    if (this.status.p2rank.state !== "installing") this.status.p2rank = toReport(p2rank, "P2Rank", "team");
  }

  /** Java and P2Rank, downloaded once. Safe to call at every start. */
  ensureP2Rank(log: (line: string) => void): Promise<void> {
    return this.serial(async () => {
      const jre = PINNED_JRE[platformKey()];
      const haveJava = Boolean(javaHomeIn(paths.jre()));
      const haveP2Rank = fs.existsSync(path.join(paths.p2rank(), PINNED_P2RANK.folder, process.platform === "win32" ? "prank.bat" : "prank"));
      if (haveJava && haveP2Rank) return;
      if (!jre) {
        this.status.p2rank = { state: "failed", version: null, detail: `Pocket detection is not available for ${process.platform} on ${process.arch}.` };
        return;
      }
      try {
        if (!haveJava) {
          this.status.p2rank = { state: "installing", version: null, detail: "Downloading Java for pocket detection…" };
          const file = path.join(paths.downloads(), path.basename(new URL(jre.url).pathname));
          await downloadVerified(jre.url, file, jre.sha256, {}, progress(this.status.p2rank, "Downloading Java"));
          await unpack(file, paths.jre(), jre.kind);
          fs.rmSync(file, { force: true });
          log("Java installed.");
        }
        if (!haveP2Rank) {
          this.status.p2rank = { state: "installing", version: null, detail: "Downloading P2Rank (about 300 MB, once)…" };
          const file = path.join(paths.downloads(), "p2rank.tar.gz");
          await downloadVerified(PINNED_P2RANK.url, file, PINNED_P2RANK.sha256, {}, progress(this.status.p2rank, "Downloading P2Rank"));
          await unpack(file, paths.p2rank(), PINNED_P2RANK.kind);
          fs.rmSync(file, { force: true });
          if (process.platform !== "win32") fs.chmodSync(path.join(paths.p2rank(), PINNED_P2RANK.folder, "prank"), 0o755);
          log("P2Rank installed.");
        }
        this.status.p2rank = { state: "missing", version: null, detail: null };
      } catch (err: any) {
        this.status.p2rank = { state: "failed", version: null, detail: `Pocket detection could not be set up (${err?.message ?? err}). It will try again at the next start.` };
        log(`P2Rank setup failed: ${err?.message ?? err}`);
        return;
      }
      await this.refresh().catch((err) => log(`Tool check failed: ${err?.message ?? err}`));
    });
  }

  /**
   * Follow the workspace's team bundle. `version` is what the server says this platform should have
   * (null = none). A person's own (guided) copy is left alone; `AGENT_FOLDX_SOURCE=guided` opts out entirely.
   */
  syncTeamFoldx(version: string | null, client: ServerClient, log: (line: string) => void): Promise<void> {
    return this.serial(async () => {
      const s = this.state();
      if ((process.env.AGENT_FOLDX_SOURCE || "team").toLowerCase() === "guided") return;
      if (s.foldxSource === "guided") return;
      if (version === s.foldxBundleVersion && (version === null || fs.existsSync(paths.foldx()))) return;

      if (version === null) {
        // Revoked (or never uploaded): erase the team copy and stop offering FoldX.
        fs.rmSync(paths.foldx(), { recursive: true, force: true });
        this.save({ foldxSource: "none", foldxBundleVersion: null });
        log("The workspace removed its FoldX; the copy on this computer was erased.");
        await this.refresh();
        return;
      }
      if (!isFoldxPlatform(process.platform)) return;
      this.status.foldx = { state: "installing", version: null, detail: "Setting up FoldX from your workspace…" };
      try {
        const bytes = await client.downloadFoldxBundle(process.platform);
        const check = await checkFoldxArchive(bytes, process.platform);
        if (!check.ok) throw new Error(check.problem);
        await installFoldxArchive(check, paths.foldx());
        this.save({ foldxSource: "team", foldxBundleVersion: version });
        log(`FoldX from the workspace (bundle ${version}) installed.`);
      } catch (err: any) {
        this.status.foldx = { state: "failed", version: null, detail: `FoldX from your workspace could not be set up: ${err?.message ?? err}` };
        log(`FoldX team bundle failed: ${err?.message ?? err}`);
        return;
      }
      this.status.foldx = { state: "missing", version: null, detail: null };
      await this.refresh();
    });
  }

  /** The person dropped a FoldX zip on the setup page. Returns a reader-facing problem, or null on success. */
  installGuidedFoldx(bytes: Uint8Array, log: (line: string) => void): Promise<string | null> {
    let problem: string | null = null;
    return this.serial(async () => {
      if (!isFoldxPlatform(process.platform)) {
        problem = "FoldX is not available for this kind of computer.";
        return;
      }
      const check = await checkFoldxArchive(bytes, process.platform);
      if (!check.ok) {
        problem = check.problem; // the agent is left exactly as it was
        return;
      }
      this.status.foldx = { state: "installing", version: null, detail: "Testing FoldX…" };
      try {
        await installFoldxArchive(check, paths.foldx());
        this.save({ foldxSource: "guided", foldxBundleVersion: null });
      } catch (err: any) {
        // Never left at "installing": every later refresh would skip FoldX until a restart.
        problem = `FoldX could not be copied into the agent's folder (${err?.code === "ENOSPC" ? "the disk is full" : err?.message ?? err}).`;
        this.status.foldx = { state: "failed", version: null, detail: problem };
        log(`Guided FoldX install failed: ${err?.message ?? err}`);
        return;
      }
      log(`FoldX for ${PLATFORM_LABEL[process.platform]} installed from your own zip.`);
      this.status.foldx = { state: "missing", version: null, detail: null };
      await this.refresh();
      if (this.status.foldx.state !== "ready") problem = this.status.foldx.detail ?? "FoldX was installed but did not pass its self-test.";
    }).then(() => problem);
  }
}

function progress(target: AgentToolReport, label: string) {
  let last = -1;
  return (received: number, total: number | null) => {
    const pct = total ? Math.floor((received / total) * 100) : null;
    if (pct === last) return;
    last = pct ?? -1;
    target.detail = pct == null ? `${label}… ${Math.round(received / 1048576)} MB` : `${label}… ${pct}%`;
  };
}

/** A self-test result as the protocol reports it: plain words, no paths. */
export function toReport(check: ToolCheck, label: string, source: FoldxSource): AgentToolReport {
  if (check.tool?.verified && check.tool.selfTest !== "failed" && check.tool.version && check.tool.version !== "unknown") {
    return { state: "ready", version: check.tool.version, detail: null };
  }
  if (!check.tool) {
    if (label === "FoldX") {
      return {
        state: "missing",
        version: null,
        detail:
          source === "none"
            ? "FoldX is not set up yet. Your workspace has not shared it; drop the FoldX zip you downloaded onto the agent page."
            : "FoldX is missing on this computer. Drop the FoldX zip onto the agent page.",
      };
    }
    return { state: "missing", version: null, detail: "Pocket detection is not set up yet." };
  }
  const expired = /stopped working/.test(check.detail);
  return {
    state: "failed",
    version: check.tool.version === "unknown" ? null : check.tool.version,
    detail: expired
      ? `This ${label} build has expired. ${label === "FoldX" ? "Ask your workspace admin for the current build, or drop the new zip onto the agent page." : ""}`.trim()
      : `${label} is installed but did not pass its self-test.`,
  };
}

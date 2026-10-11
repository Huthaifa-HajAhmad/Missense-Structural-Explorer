/**
 * state.ts — where the agent keeps its things, and what it remembers between runs.
 *
 * Everything lives in ONE folder the agent manages, so a person never moves or finds a file (decision 7):
 *   Windows  %LOCALAPPDATA%\MissenseAgent
 *   elsewhere ~/.missense-agent
 *   (`AGENT_HOME` overrides, for tests and unattended hosts)
 *
 *   agent.json      server address, this computer's token, its id and name, paused, FoldX source
 *   tools/foldx     FoldX (team bundle or the person's own zip), flat: program, rotabase.txt, molecules/
 *   tools/p2rank    P2Rank, unpacked from its pinned release
 *   tools/jre       a portable Java runtime for P2Rank, from its pinned release
 *   scratch/<job>   one folder per running job, removed when the job ends
 *   cache/          FoldX's repaired-structure cache (speeds up several variants of one structure)
 *
 * The token is a credential: the file is written with owner-only permissions (0600) where the OS
 * supports them, and it is never logged.
 */
import fs from "fs";
import os from "os";
import path from "path";
import type { FoldxSource } from "../../src/shared/agentProtocol.ts";

export interface AgentState {
  serverUrl: string | null;
  token: string | null;
  agentId: string | null;
  name: string;
  paused: boolean;
  /** `team` follows the workspace's bundle; `guided` is a zip this person dropped in themselves. */
  foldxSource: FoldxSource;
  /** The team bundle version installed (team source only). */
  foldxBundleVersion: string | null;
}

export function agentHome(): string {
  if (process.env.AGENT_HOME) return path.resolve(process.env.AGENT_HOME);
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "MissenseAgent");
  return path.join(os.homedir(), ".missense-agent");
}

export const paths = {
  state: () => path.join(agentHome(), "agent.json"),
  tools: () => path.join(agentHome(), "tools"),
  foldx: () => path.join(agentHome(), "tools", "foldx"),
  p2rank: () => path.join(agentHome(), "tools", "p2rank"),
  jre: () => path.join(agentHome(), "tools", "jre"),
  downloads: () => path.join(agentHome(), "downloads"),
  scratch: () => path.join(agentHome(), "scratch"),
  cache: () => path.join(agentHome(), "cache"),
  log: () => path.join(agentHome(), "agent.log"),
};

export function defaultState(): AgentState {
  return {
    serverUrl: null,
    token: null,
    agentId: null,
    name: os.hostname().slice(0, 60) || "My computer",
    paused: false,
    foldxSource: "none",
    foldxBundleVersion: null,
  };
}

export function loadState(): AgentState {
  try {
    const raw = JSON.parse(fs.readFileSync(paths.state(), "utf8"));
    return { ...defaultState(), ...raw };
  } catch {
    return defaultState();
  }
}

/** Atomic, owner-only write. */
export function saveState(state: AgentState): void {
  fs.mkdirSync(agentHome(), { recursive: true });
  const tmp = `${paths.state()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.state());
  try {
    fs.chmodSync(paths.state(), 0o600);
  } catch {
    /* Windows: the folder is under the person's own profile */
  }
}

/**
 * Point the server code the agent reuses at the agent's own folders. The FoldX and P2Rank runners look
 * for their tools under `<cwd>/tools/...` and honour `FOLDX_DIR` / `P2RANK_JAVA_HOME`; the FoldX caches
 * honour `FOLDX_CACHE_DIR`. Called once at start, before any of that code runs.
 */
export function enterAgentHome(): void {
  for (const dir of [agentHome(), paths.tools(), paths.scratch(), paths.cache(), paths.downloads()]) fs.mkdirSync(dir, { recursive: true });
  process.chdir(agentHome());
  process.env.FOLDX_DIR = paths.foldx();
  process.env.FOLDX_CACHE_DIR = paths.cache();
  delete process.env.FOLDX_BINARY;
  const javaHome = javaHomeIn(paths.jre());
  if (javaHome) process.env.P2RANK_JAVA_HOME = javaHome;
}

/** The Java home inside an unpacked Temurin archive (`jdk-21…-jre/` or, on macOS, `…/Contents/Home`). */
export function javaHomeIn(jreDir: string): string | null {
  if (!fs.existsSync(jreDir)) return null;
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const candidates = [jreDir, ...fs.readdirSync(jreDir).map((d) => path.join(jreDir, d))];
  for (const c of candidates) {
    for (const home of [c, path.join(c, "Contents", "Home")]) {
      if (fs.existsSync(path.join(home, "bin", exe))) return home;
    }
  }
  return null;
}

/**
 * agentProtocol.ts — what a paired computer ("agent", plan WP-F) reports, and the words the interface
 * uses for it.
 *
 * Three programs read these shapes: the agent that SENDS a report, the server that stores it and decides
 * which jobs the computer may take, and the browser that tells its owner, in plain language, what the
 * computer is doing ("Your computer is connected", "FoldX is not set up on your computer: open the agent
 * page to finish", "Paused"). One module, so the three cannot drift apart. Pure (no imports), like
 * `jobsCopy.ts`; enforced by `scripts/check-boundaries.ts`.
 *
 * The audience is not technical (decision 7). Every sentence says what is true and, when something is
 * not working, the one thing the person can do about it. Never a stack trace, never a path.
 */

/** Bumped when the request/response shapes change incompatibly. */
export const AGENT_PROTOCOL_VERSION = 1;

/** The heavy job kinds an agent can run. Nothing else is ever executed (plan F2). */
export const AGENT_JOB_TYPES = ["foldx", "p2rank"] as const;
export type AgentJobType = (typeof AGENT_JOB_TYPES)[number];

/** How far one tool is on this computer. */
export type AgentToolState =
  /** Installed and passed its self-test: the computer offers jobs of this kind. */
  | "ready"
  /** Being downloaded, unpacked or tested. */
  | "installing"
  /** Not installed (for FoldX: no team bundle and none dropped in yet). */
  | "missing"
  /** Installed but its self-test failed, or the download could not be verified. */
  | "failed";

export interface AgentToolReport {
  state: AgentToolState;
  version: string | null;
  /** Reader-facing, one sentence, when it is not ready. No paths. */
  detail: string | null;
}

/** Where this computer's FoldX came from. */
export type FoldxSource = "team" | "guided" | "none";

/** What the agent sends on register and with every claim (only the parts that change on claim). */
export interface AgentHostReport {
  agentVersion: string;
  protocol: number;
  os: "win32" | "linux" | "darwin";
  arch: "x64" | "arm64";
  cores: number;
  totalRamBytes: number;
  /** Free memory now, already limited by the person's own cap (`AGENT_MAX_RAM_GB`). */
  freeRamBytes: number;
  paused: boolean;
  tools: { foldx: AgentToolReport; p2rank: AgentToolReport };
  foldxSource: FoldxSource;
  /** The team bundle version installed, or null (guided copy, or none). */
  foldxBundleVersion: string | null;
}

/** One paired computer as its owner's browser sees it (`GET /me/agents`). */
export interface AgentView {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
  paused: boolean;
  /** Jobs it is running now (0 or 1). */
  runningJobs: number;
  os: AgentHostReport["os"] | null;
  totalRamBytes: number | null;
  tools: AgentHostReport["tools"] | null;
  foldxSource: FoldxSource | null;
}

export type AgentTone = "ready" | "attention" | "paused" | "offline";

export interface AgentStatusCopy {
  /** Short state, e.g. "Connected". */
  label: string;
  tone: AgentTone;
  /** One or two sentences: what the computer does now, and what to do if something is missing. */
  detail: string;
}

/** A computer is shown as online if it has called in within this long (a claim long-polls 25 s). */
export const AGENT_ONLINE_WINDOW_MS = 90_000;

function gb(bytes: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${Math.round(bytes / 1024 ** 3)} GB`;
}

/** The plain-language status of one computer for its owner. */
export function describeAgent(view: AgentView): AgentStatusCopy {
  if (!view.online) {
    return {
      label: "Not connected",
      tone: "offline",
      detail: "This computer has not checked in recently. Start the agent on it to lend it to your jobs again. Your jobs run on the shared server meanwhile.",
    };
  }
  if (view.paused) {
    return {
      label: "Paused",
      tone: "paused",
      detail: "Paused on the computer itself. Your jobs run on the shared server until you press Resume on the agent page.",
    };
  }
  const foldx = view.tools?.foldx;
  const p2rank = view.tools?.p2rank;
  const ram = gb(view.totalRamBytes);
  const runs: string[] = [];
  if (foldx?.state === "ready") runs.push("FoldX");
  if (p2rank?.state === "ready") runs.push("pocket detection");
  const busy = view.runningJobs > 0 ? " It is working on one of your jobs now." : "";

  if (runs.length === 0) {
    const installing = foldx?.state === "installing" || p2rank?.state === "installing";
    return {
      label: installing ? "Setting up" : "Needs setup",
      tone: "attention",
      detail: installing
        ? "Connected, and still setting up its tools. This usually takes a few minutes the first time."
        : "Connected, but none of its tools work yet. Open the agent page on that computer to finish setting it up.",
    };
  }
  const lend = `Connected${ram ? ` (${ram})` : ""}: runs your ${runs.join(" and ")} jobs.${busy}`;
  if (foldx && foldx.state !== "ready") {
    const why =
      foldx.state === "installing"
        ? "FoldX is being set up on it."
        : "FoldX is not set up on it yet: open the agent page on that computer to finish. FoldX jobs run on the shared server meanwhile.";
    return { label: "Connected", tone: foldx.state === "installing" ? "ready" : "attention", detail: `${lend} ${why}` };
  }
  return { label: "Connected", tone: "ready", detail: lend };
}

// ── Pairing codes ─────────────────────────────────────────────────────────────────────────────────

/** No 0/O, 1/I/L: the code is read off one screen and typed into another. */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
/** A code is good for this long, once. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** What a person typed, reduced to the code: case, spaces and dashes do not matter. */
export function normalisePairingCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== PAIRING_CODE_LENGTH) return null;
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return null;
  return code;
}

/** "ABC-DEF": easier to read aloud and to compare. */
export function formatPairingCode(code: string): string {
  return code.length === PAIRING_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

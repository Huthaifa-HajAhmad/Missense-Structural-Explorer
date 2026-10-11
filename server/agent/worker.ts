/**
 * worker.ts — the agent's loop: register → (sync tools) → claim → run → heartbeat → result / give back.
 *
 * One heavy job at a time (plan F2). While a job runs, a heartbeat every `heartbeatSec` renews its lease
 * and carries the FoldX phase, so the browser's progress stepper reads the same as for a server run. A 410
 * means the job is no longer this computer's (cancelled, handed back): the tool is killed at once and
 * nothing is reported. Pausing or disconnecting also kills the running tool; the job then goes back to
 * the server.
 *
 * Network trouble is normal for a laptop: every failure backs off (up to a minute) and tries again. Only a
 * revoked token (401) stops the loop, and the setup page then says so in plain words.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { AGENT_PROTOCOL_VERSION, type AgentHostReport } from "../../src/shared/agentProtocol.ts";
import { AgentHttpError, apiBase, ServerClient, type ClaimedJob } from "./client.ts";
import { runJob } from "./runner.ts";
import { agentHome, loadState, saveState, type AgentState } from "./state.ts";
import { ToolsManager } from "./tools.ts";

export const AGENT_VERSION = "1.0.0";

export type Connection = "unpaired" | "connecting" | "connected" | "offline" | "revoked" | "outdated";

export interface WorkerView {
  connection: Connection;
  serverUrl: string | null;
  name: string;
  paused: boolean;
  ownerName: string | null;
  lastError: string | null;
  job: { id: string; type: string; phase: string | null; startedAt: number } | null;
  tools: ToolsManager["status"];
  foldxSource: AgentState["foldxSource"];
  log: string[];
}

/** A secret never reaches a log line: tokens and long base64-ish runs are masked. */
export function redact(line: string): string {
  return line.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AgentWorker {
  state: AgentState = loadState();
  connection: Connection = this.state.token ? "connecting" : "unpaired";
  ownerName: string | null = null;
  lastError: string | null = null;
  job: WorkerView["job"] = null;
  readonly tools: ToolsManager;
  private readonly lines: string[] = [];
  private client: ServerClient | null = null;
  private stopped = false;
  private jobAbort: AbortController | null = null;
  private wake: (() => void) | null = null;

  constructor() {
    this.tools = new ToolsManager(() => this.state, (patch) => this.update(patch));
    if (process.env.AGENT_SERVER_URL) this.state.serverUrl = process.env.AGENT_SERVER_URL;
    if (process.env.AGENT_TOKEN) this.state.token = process.env.AGENT_TOKEN;
    if (this.state.token) this.connection = "connecting";
  }

  log(line: string): void {
    const stamped = `${new Date().toISOString().slice(0, 19).replace("T", " ")}  ${redact(line)}`;
    this.lines.push(stamped);
    if (this.lines.length > 200) this.lines.shift();
    if (process.env.NODE_ENV !== "test") console.log(stamped);
    try {
      fs.appendFileSync(path.join(agentHome(), "agent.log"), `${stamped}\n`);
    } catch { /* logging must never stop the agent */ }
  }

  update(patch: Partial<AgentState>): void {
    this.state = { ...this.state, ...patch };
    saveState(this.state);
  }

  view(): WorkerView {
    return {
      connection: this.connection,
      serverUrl: this.state.serverUrl,
      name: this.state.name,
      paused: this.isPaused(),
      ownerName: this.ownerName,
      lastError: this.lastError,
      job: this.job,
      tools: this.tools.status,
      foldxSource: this.state.foldxSource,
      log: this.lines.slice(-40),
    };
  }

  /** Paused from the page, by `AGENT_PAUSE=1`, or by a file named PAUSE in the agent's folder. */
  isPaused(): boolean {
    return this.state.paused || /^(1|true|yes)$/i.test(process.env.AGENT_PAUSE ?? "") || fs.existsSync(path.join(agentHome(), "PAUSE"));
  }

  report(): AgentHostReport {
    const capGb = Number(process.env.AGENT_MAX_RAM_GB);
    const cap = Number.isFinite(capGb) && capGb > 0 ? capGb * 1024 ** 3 : Infinity;
    return {
      agentVersion: AGENT_VERSION,
      protocol: AGENT_PROTOCOL_VERSION,
      os: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux",
      arch: process.arch === "arm64" ? "arm64" : "x64",
      cores: os.cpus().length,
      totalRamBytes: Math.min(os.totalmem(), cap),
      freeRamBytes: Math.min(os.freemem(), cap),
      paused: this.isPaused(),
      tools: { foldx: this.tools.status.foldx, p2rank: this.tools.status.p2rank },
      foldxSource: this.state.foldxSource,
      foldxBundleVersion: this.state.foldxBundleVersion,
    };
  }

  /** Pair with a code from the main app. Returns a reader-facing problem, or null on success. */
  async pair(serverUrl: string, code: string, name: string): Promise<string | null> {
    let base: string;
    try {
      base = apiBase(serverUrl);
    } catch (err: any) {
      return err?.message ?? "That is not a web address.";
    }
    try {
      const out = await new ServerClient(base, null).redeem(code, name.trim() || this.state.name);
      this.update({ serverUrl, token: out.token, agentId: out.agentId, name: name.trim() || this.state.name });
      this.client = null; // the next loop builds one for this address and token
      this.ownerName = out.ownerName;
      this.connection = "connecting";
      this.lastError = null;
      this.log(`Connected to ${new URL(base).host} as ${this.state.name}.`);
      this.wake?.();
      return null;
    } catch (err: any) {
      if (err instanceof AgentHttpError) return err.message;
      return `Could not reach ${serverUrl}. Check the address and your internet connection.`;
    }
  }

  setPaused(paused: boolean): void {
    this.update({ paused });
    this.log(paused ? "Paused: this computer takes no new jobs." : "Resumed.");
    if (paused) this.jobAbort?.abort();
    this.wake?.();
  }

  /** Disconnect: tell the server (best effort), forget the token, erase the team FoldX copy. */
  async disconnect(): Promise<void> {
    this.jobAbort?.abort();
    try {
      await this.client?.disconnect();
    } catch { /* already revoked, or offline: forgetting the token is what matters */ }
    if (this.state.foldxSource === "team") fs.rmSync(path.join(agentHome(), "tools", "foldx"), { recursive: true, force: true });
    this.update({ token: null, agentId: null, foldxSource: this.state.foldxSource === "team" ? "none" : this.state.foldxSource, foldxBundleVersion: null });
    this.connection = "unpaired";
    this.client = null;
    this.log("Disconnected from the workspace.");
    void this.tools.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.jobAbort?.abort();
    this.wake?.();
  }

  private async nap(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    this.wake = null;
  }

  async run(): Promise<void> {
    let backoff = 2000;
    while (!this.stopped) {
      if (!this.state.token || !this.state.serverUrl) {
        // A revoked computer keeps saying so (the page explains it) until it is paired again.
        if (this.connection !== "revoked") this.connection = "unpaired";
        await this.nap(30_000);
        continue;
      }
      try {
        this.client ??= new ServerClient(apiBase(this.state.serverUrl), this.state.token);
      } catch (err: any) {
        // A saved address the agent cannot use (hand-edited, or a stale AGENT_SERVER_URL): ask to pair again.
        this.lastError = `The saved workspace address cannot be used (${err?.message ?? err}). Connect again with a new code.`;
        this.log(this.lastError);
        this.update({ token: null, serverUrl: null });
        this.connection = "revoked";
        continue;
      }
      this.client.setToken(this.state.token);
      try {
        const reg = await this.client.register(this.report());
        this.connection = "connected";
        this.lastError = null;
        backoff = 2000;
        // Act on the bundle version BEFORE claiming: a revoked FoldX is erased before any FoldX job is taken.
        await this.tools.syncTeamFoldx(reg.foldxBundleVersion, this.client, (l) => this.log(l));
        while (!this.stopped && this.state.token) {
          const answer = await this.client.claim(this.report(), reg.claimWaitMaxSec);
          await this.tools.syncTeamFoldx(answer.foldxBundleVersion, this.client, (l) => this.log(l));
          if (answer.job) await this.execute(answer.job, reg.heartbeatSec);
        }
      } catch (err: any) {
        if (this.stopped) return;
        if (err instanceof AgentHttpError && err.status === 401) {
          this.connection = "revoked";
          this.lastError = "This computer was disconnected from the workspace. Connect it again with a new code.";
          this.log("The workspace no longer accepts this computer's token.");
          this.update({ token: null });
          continue;
        }
        if (err instanceof AgentHttpError && err.status === 426) {
          this.connection = "outdated";
          this.lastError = err.message;
          await this.nap(10 * 60_000);
          continue;
        }
        this.connection = "offline";
        this.lastError = err instanceof AgentHttpError && err.status === 503 ? "The workspace is busy updating; trying again shortly." : "Cannot reach the workspace; trying again.";
        this.log(`${this.lastError} (${err?.message ?? err})`);
        await this.nap(backoff);
        backoff = Math.min(60_000, backoff * 2);
      }
    }
  }

  private async execute(job: ClaimedJob, heartbeatSec: number): Promise<void> {
    const client = this.client!;
    const abort = new AbortController();
    this.jobAbort = abort;
    let leaseLost = false;
    this.job = { id: job.id, type: job.type, phase: null, startedAt: Date.now() };
    this.log(`Started a ${job.type === "foldx" ? "FoldX" : "pocket"} job.`);

    const beat = async () => {
      try {
        await client.heartbeat(job.id, { phase: this.job?.phase ?? undefined });
      } catch (err: any) {
        if (err instanceof AgentHttpError && (err.status === 410 || err.status === 401)) {
          leaseLost = true;
          abort.abort();
        }
        // Anything else (network): keep running; the lease outlasts two missed heartbeats.
      }
    };
    const timer = setInterval(() => void beat(), heartbeatSec * 1000);
    try {
      const outcome = await runJob(job, {
        signal: abort.signal,
        onPhase: (phase) => {
          if (this.job) this.job.phase = phase;
          void beat();
        },
      });
      clearInterval(timer);
      if (leaseLost) {
        this.log("The job was cancelled or handed back; stopped it.");
        return;
      }
      const toolVersion = (job.type === "foldx" ? this.tools.status.foldx.version : this.tools.status.p2rank.version) ?? "unknown";
      if (outcome.kind === "result") {
        const answer = await client.result(job.id, { result: outcome.result, wallMs: outcome.wallMs, peakRssBytes: outcome.peakRssBytes, toolVersion });
        this.log(answer.accepted ? `Finished the job in ${Math.round(outcome.wallMs / 1000)} s.` : `The workspace did not accept the result (${(answer.reasons ?? []).join("; ")}); the server will run it.`);
      } else {
        await client.fail(job.id, { errorClass: outcome.errorClass, message: outcome.message, wallMs: outcome.wallMs, peakRssBytes: outcome.peakRssBytes, toolVersion });
        this.log(outcome.errorClass === "aborted" ? "Stopped the job; the server will run it." : `The job could not run here (${outcome.errorClass}); the server will run it.`);
        if (outcome.errorClass === "tool_missing" || outcome.errorClass === "tool_failed") void this.tools.refresh();
      }
    } catch (err: any) {
      // The result could not be delivered: the lease runs out and the server takes the job. Nothing lost.
      this.log(`Could not deliver the job's outcome (${err?.message ?? err}); the server will run it.`);
    } finally {
      clearInterval(timer);
      this.job = null;
      this.jobAbort = null;
    }
  }
}

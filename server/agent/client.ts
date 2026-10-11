/**
 * client.ts — the agent's side of the protocol (`server/routes/agent.ts`). Outbound HTTPS only, so a
 * computer behind a home or lab NAT works with no port opened. The token goes in the Authorization
 * header and nowhere else (never a URL, never a log line).
 */
import crypto from "crypto";
import type { AgentHostReport } from "../../src/shared/agentProtocol.ts";

export class AgentHttpError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
    this.name = "AgentHttpError";
  }
}

export interface ClaimedJob {
  id: string;
  type: "foldx" | "p2rank";
  payload: Record<string, any>;
  leaseExpiresAt: number;
  deadlineMs: number;
}

export interface RegisterAnswer {
  agentId: string;
  name: string;
  leaseSec: number;
  heartbeatSec: number;
  claimWaitMaxSec: number;
  foldxBundleVersion: string | null;
}

/** The server address as given ("missense-resolve.duckdns.org", "https://…/", "…/api/v1") → API base. */
export function apiBase(serverUrl: string): string {
  let u = serverUrl.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const url = new URL(u);
  // Plain HTTP only to this machine itself (development); a token must never cross the network unencrypted.
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("The workspace address must start with https://");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "")}/api/v1`;
}

export class ServerClient {
  constructor(private readonly base: string, private token: string | null) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) throw new AgentHttpError(res.status, json?.error?.code ?? null, json?.error?.message ?? `The server answered ${res.status}.`);
    return json as T;
  }

  redeem(code: string, name: string): Promise<{ agentId: string; token: string; ownerName: string }> {
    return this.request("POST", "/agent/pair/redeem", { code, name });
  }

  register(report: AgentHostReport): Promise<RegisterAnswer> {
    return this.request("POST", "/agent/register", { report });
  }

  /** Long poll: resolves after at most `waitSec` (plus network). */
  claim(report: AgentHostReport, waitSec: number): Promise<{ job: ClaimedJob | null; foldxBundleVersion: string | null }> {
    return this.request("POST", "/agent/claim", { report, waitSec }, (waitSec + 30) * 1000);
  }

  heartbeat(jobId: string, body: { phase?: string; rssBytes?: number | null }): Promise<{ leaseExpiresAt: number; foldxBundleVersion: string | null }> {
    return this.request("POST", `/agent/jobs/${encodeURIComponent(jobId)}/heartbeat`, body, 30_000);
  }

  /** The server finishes a FoldX result (other engines, caching) before it answers: allow minutes. */
  result(jobId: string, body: { result: unknown; wallMs: number; peakRssBytes: number | null; toolVersion: string }): Promise<{ accepted: boolean; reasons?: string[] }> {
    return this.request("POST", `/agent/jobs/${encodeURIComponent(jobId)}/result`, body, 10 * 60_000);
  }

  fail(jobId: string, body: { errorClass: string; message?: string; wallMs?: number; peakRssBytes?: number | null; toolVersion?: string | null }): Promise<unknown> {
    return this.request("POST", `/agent/jobs/${encodeURIComponent(jobId)}/fail`, body, 30_000);
  }

  disconnect(): Promise<unknown> {
    return this.request("DELETE", "/agent/self", undefined, 30_000);
  }

  /** The team FoldX zip, verified against the server's SHA-256 before it is returned. */
  async downloadFoldxBundle(platform: string): Promise<Uint8Array> {
    const res = await fetch(`${this.base}/agent/tools/foldx?platform=${encodeURIComponent(platform)}`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!res.ok) throw new AgentHttpError(res.status, null, res.status === 404 ? "your workspace has no FoldX for this kind of computer" : `the download failed (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const expected = res.headers.get("x-bundle-sha256");
    const got = crypto.createHash("sha256").update(bytes).digest("hex");
    if (!expected || expected !== got) throw new Error("the download was damaged (checksum mismatch) and was discarded; it will be tried again");
    return bytes;
  }
}

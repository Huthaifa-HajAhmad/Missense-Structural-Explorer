/**
 * accountApi.ts — the browser side of the account routes (`server/routes/auth.ts`, `admin.ts`).
 *
 * Plain same-origin `fetch`, not `fetchWithAuth`: these calls carry the `mse_session` cookie (sent
 * automatically on same-origin requests) and need none of the Gemini-session machinery. Every failure
 * becomes an {@link AccountError} whose `message` is the server's own sentence, written for the
 * reader, so screens show it as is.
 */

import type { AgentView } from "../shared/agentProtocol";

export type AuthMode = "legacy" | "hybrid" | "accounts";
export type Role = "admin" | "member";
export type PlacementPref = "auto" | "my_machine" | "server_only";

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: "active" | "disabled";
  shareResults: boolean;
  placementPref: PlacementPref;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface SessionInfo {
  mode: AuthMode;
  provider: "password" | "cloudflare-access";
  user: AccountUser | null;
  setupAvailable: boolean;
  accountsExist: boolean;
}

/** `GET /auth/me`: the limits that apply to this person and the server time they used (WP-B). */
export interface MeInfo {
  user: AccountUser;
  mode: AuthMode;
  quota: { queuedPerUser: number; serverSecondsPerDay: number | null; queuedPerUserExplicit: boolean };
  /** null when the server's queue is not running in this process. */
  usage: { todaySeconds: number; weekSeconds: number } | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: number;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    /** Seconds until a locked sign-in may be tried again (429 only). */
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

const BASE = "/api/v1";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AccountError("Could not reach the server. Check your connection and try again.", 0, "NETWORK");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error;
    const retry = Number(res.headers.get("Retry-After"));
    throw new AccountError(
      typeof error?.message === "string" ? error.message : `The server answered ${res.status}.`,
      res.status,
      typeof error?.code === "string" ? error.code : "HTTP_ERROR",
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  return data as T;
}

export const accountApi = {
  session: () => request<SessionInfo>("GET", "/auth/session"),
  signIn: (email: string, password: string) => request<{ user: AccountUser }>("POST", "/auth/login", { email, password }),
  signOut: () => request<void>("POST", "/auth/logout", {}),
  inviteInfo: (token: string) => request<{ email: string; role: Role }>("POST", "/auth/invite-info", { token }),
  acceptInvite: (token: string, displayName: string, password: string) =>
    request<{ user: AccountUser }>("POST", "/auth/accept-invite", { token, displayName, password }),
  resetPassword: (token: string, password: string) => request<{ user: AccountUser }>("POST", "/auth/reset", { token, password }),
  setup: (input: { secret: string; email: string; displayName: string; password: string }) =>
    request<{ user: AccountUser }>("POST", "/setup", input),
  me: () => request<MeInfo>("GET", "/auth/me"),
  changePassword: (current: string, next: string) => request<void>("POST", "/auth/change-password", { current, next }),
  updatePreferences: (patch: Partial<Pick<AccountUser, "shareResults" | "placementPref">>) =>
    request<Pick<AccountUser, "shareResults" | "placementPref">>("PUT", "/me/preferences", patch),

  // Admin
  listUsers: () => request<{ users: AccountUser[] }>("GET", "/admin/users"),
  updateUser: (id: string, patch: { role?: Role; status?: "active" | "disabled" }) =>
    request<{ user: AccountUser }>("PATCH", `/admin/users/${encodeURIComponent(id)}`, patch),
  createInvite: (email: string, role: Role) => request<{ inviteUrl: string; expiresAt: number }>("POST", "/admin/invites", { email, role }),
  listInvites: () => request<{ invites: PendingInvite[] }>("GET", "/admin/invites"),
  withdrawInvite: (id: string) => request<void>("DELETE", `/admin/invites/${encodeURIComponent(id)}`),
  createResetLink: (id: string) => request<{ resetUrl: string; expiresAt: number }>("POST", `/admin/users/${encodeURIComponent(id)}/reset-link`, {}),
  signOutEverywhere: (id: string) => request<void>("POST", `/admin/users/${encodeURIComponent(id)}/sign-out`, {}),

  // Paired computers (WP-F)
  createPairingCode: () => request<{ code: string; expiresAt: number }>("POST", "/agent/pair", {}),
  listMyAgents: () => request<{ agents: AgentView[] }>("GET", "/me/agents"),
  disconnectAgent: (id: string) => request<void>("DELETE", `/me/agents/${encodeURIComponent(id)}`),
  agentDownloads: () => request<{ platforms: AgentDownload[] }>("GET", "/me/agent-downloads"),
  listFoldxBundles: () => request<{ platforms: FoldxBundleInfo[] }>("GET", "/admin/tools/foldx"),
  revokeFoldxBundles: () => request<void>("DELETE", "/admin/tools/foldx"),
  /** Raw zip upload; the licence confirmation travels as a header the server requires. */
  uploadFoldxBundle: async (platform: FoldxPlatform, file: Blob): Promise<{ bundle: FoldxBundleInfo }> => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/admin/tools/foldx/${platform}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/zip", Accept: "application/json", "X-Foldx-Licence-Confirmed": "yes" },
        body: file,
      });
    } catch {
      throw new AccountError("Could not reach the server. Check your connection and try again.", 0, "NETWORK");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new AccountError(data?.error?.message ?? `The server answered ${res.status}.`, res.status, data?.error?.code ?? "HTTP_ERROR");
    return data;
  },
};

export type FoldxPlatform = "win32" | "linux" | "darwin";

export interface FoldxBundleInfo {
  platform: FoldxPlatform;
  version: string;
  sha256: string;
  sizeBytes: number;
  binaryName: string;
  expiry: string | null;
  uploadedBy: string;
  uploadedByName: string | null;
  uploadedAt: number;
  licenceConfirmedAt: number;
}

export interface AgentDownload {
  platform: string;
  label: string;
  sizeBytes: number;
  url: string;
}

export { PASSWORD_MIN_LENGTH, passwordProblem } from "../shared/accountPolicy";

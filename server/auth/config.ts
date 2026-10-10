/**
 * auth/config.ts — the account settings, read from the environment on every call.
 *
 * Read per call (not frozen into CONFIG at import) so tests and the admin script can switch modes
 * without re-importing the server. See `doc/COMPUTE_ROUTING_PLAN.md`, sections 4 and 8.
 *
 * AUTH_MODE is the cut-over dial:
 *   legacy   — today's behaviour. Accounts exist and can sign in, but nothing requires them.
 *   hybrid   — heavy compute needs a signed-in user OR the legacy shared token.
 *   accounts — heavy compute needs a signed-in user; the legacy token is read-only.
 */
import path from "path";

export type AuthMode = "legacy" | "hybrid" | "accounts";
export type AuthProvider = "password" | "cloudflare-access";

const MODES: readonly AuthMode[] = ["legacy", "hybrid", "accounts"];
const PROVIDERS: readonly AuthProvider[] = ["password", "cloudflare-access"];

export const DEFAULT_PUBLIC_BASE_URL = "https://missense-resolve.duckdns.org";

export interface AuthSettings {
  mode: AuthMode;
  provider: AuthProvider;
  sessionTtlMs: number;
  sessionIdleMs: number;
  publicBaseUrl: string;
  /** Enables `/setup` only while no user exists. Never logged. */
  adminSetupSecret: string | null;
  queuedPerUser: number;
  /** null = no daily cap (the default, decision 8). */
  serverSecondsPerDay: number | null;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function authSettings(): AuthSettings {
  const mode = (process.env.AUTH_MODE || "legacy").trim().toLowerCase() as AuthMode;
  const provider = (process.env.AUTH_PROVIDER || "password").trim().toLowerCase() as AuthProvider;
  const cap = process.env.QUOTA_SERVER_SECONDS_PER_DAY;
  return {
    mode,
    provider,
    sessionTtlMs: positiveNumber(process.env.SESSION_TTL_DAYS, 14) * 24 * 60 * 60 * 1000,
    sessionIdleMs: positiveNumber(process.env.SESSION_IDLE_HOURS, 24) * 60 * 60 * 1000,
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, ""),
    adminSetupSecret: process.env.ADMIN_SETUP_SECRET?.trim() || null,
    queuedPerUser: positiveNumber(process.env.QUOTA_QUEUED_PER_USER, 25),
    serverSecondsPerDay: cap && Number(cap) > 0 ? Number(cap) : null,
  };
}

/** Where the account database lives. In-memory under test unless a test redirects it. */
export function accountsDbPath(): string {
  if (process.env.ACCOUNTS_DB_PATH) return process.env.ACCOUNTS_DB_PATH;
  if (process.env.NODE_ENV === "test") return ":memory:";
  return path.join(process.cwd(), "data", "accounts.sqlite");
}

/**
 * Startup check, called from `validateStartupEnvironment`. Returns the problems instead of exiting
 * so it can be tested; the caller decides to refuse to start.
 */
export function authEnvironmentProblems(): string[] {
  const s = authSettings();
  const problems: string[] = [];
  if (!MODES.includes(s.mode)) problems.push(`AUTH_MODE must be one of ${MODES.join(", ")} (got "${process.env.AUTH_MODE}").`);
  if (!PROVIDERS.includes(s.provider)) problems.push(`AUTH_PROVIDER must be one of ${PROVIDERS.join(", ")} (got "${process.env.AUTH_PROVIDER}").`);
  // The optional Cloudflare Access provider (WP-A2) is not built. Selecting it must fail closed,
  // never silently fall back to no login.
  if (s.provider === "cloudflare-access") problems.push("AUTH_PROVIDER=cloudflare-access is not implemented yet (WP-A2). Use AUTH_PROVIDER=password.");
  if (s.adminSetupSecret && s.adminSetupSecret.length < 16) problems.push("ADMIN_SETUP_SECRET must be at least 16 characters.");
  try {
    new URL(s.publicBaseUrl);
  } catch {
    problems.push(`PUBLIC_BASE_URL is not a valid URL (got "${process.env.PUBLIC_BASE_URL}").`);
  }
  return problems;
}

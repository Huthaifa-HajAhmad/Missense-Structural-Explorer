/**
 * auth/store.ts — the account database (`data/accounts.sqlite`) and its plain data access.
 *
 * No policy lives here: who may do what is decided in the routes and `principal.ts`. Every token
 * (session, invite, reset, agent) is stored as a SHA-256 hash, never as the value a person holds.
 *
 * Schema: `doc/COMPUTE_ROUTING_PLAN.md` section 4.1, plus `password_resets` (the admin-issued
 * one-time reset links, which the plan describes but did not give a table). Migrations are additive
 * only (`CREATE TABLE IF NOT EXISTS`), as in `analysis-db-core.ts`.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { DatabaseSync } from "node:sqlite";
import { accountsDbPath } from "./config.ts";

export type Role = "admin" | "member";
export type UserStatus = "active" | "disabled";
export type PlacementPref = "auto" | "my_machine" | "server_only";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  shareResults: boolean;
  placementPref: PlacementPref;
  quota: Record<string, number> | null;
  createdAt: number;
  lastLoginAt: number | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  role: Role;
  status: UserStatus;
  share_results: number;
  placement_pref: PlacementPref;
  quota_json: string | null;
  created_at: number;
  last_login_at: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT,
  role          TEXT NOT NULL CHECK (role IN ('admin','member')),
  status        TEXT NOT NULL CHECK (status IN ('active','disabled')) DEFAULT 'active',
  share_results INTEGER NOT NULL DEFAULT 1,
  placement_pref TEXT NOT NULL DEFAULT 'auto' CHECK (placement_pref IN ('auto','my_machine','server_only')),
  quota_json    TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL COLLATE NOCASE,
  role       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at   INTEGER
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  locked_until INTEGER
);
`;

let db: DatabaseSync | null = null;

export function accountsDb(): DatabaseSync {
  if (db) return db;
  const target = accountsDbPath();
  if (target !== ":memory:") fs.mkdirSync(path.dirname(target), { recursive: true });
  const opened = new DatabaseSync(target);
  try {
    opened.exec("PRAGMA journal_mode = WAL;");
    opened.exec("PRAGMA busy_timeout = 5000;");
  } catch (_) {}
  opened.exec("PRAGMA foreign_keys = ON;");
  opened.exec(SCHEMA);
  db = opened;
  return db;
}

/** Close the database. Under test the next call opens a fresh, empty in-memory one. */
export function closeAccountsDb(): void {
  try {
    db?.close();
  } catch (_) {}
  db = null;
}

/** Run `fn` in one write transaction (BEGIN IMMEDIATE, so a concurrent writer waits rather than races). */
export function inTransaction<T>(fn: () => T): T {
  const d = accountsDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** A new random token for a person to hold: 32 bytes, URL-safe. Only its hash is stored. */
export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function toUser(row: UserRow): User {
  let quota: Record<string, number> | null = null;
  if (row.quota_json) {
    try {
      quota = JSON.parse(row.quota_json);
    } catch (_) {}
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    shareResults: row.share_results === 1,
    placementPref: row.placement_pref,
    quota,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

// ── Users ──────────────────────────────────────────────────────────────────────────────────────────

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function countUsers(): number {
  return (accountsDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function countActiveAdmins(): number {
  return (accountsDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number }).n;
}

export function createUser(input: { email: string; displayName: string; passwordHash: string | null; role: Role; now: number }): User {
  const id = crypto.randomUUID();
  accountsDb()
    .prepare("INSERT INTO users (id, email, display_name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, normaliseEmail(input.email), input.displayName.trim(), input.passwordHash, input.role, input.now);
  return getUserById(id) as User;
}

export function getUserById(id: string): User | null {
  const row = accountsDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/** The user and their password hash, for sign-in only. */
export function getUserCredentials(email: string): { user: User; passwordHash: string | null } | null {
  const row = accountsDb().prepare("SELECT * FROM users WHERE email = ?").get(normaliseEmail(email)) as UserRow | undefined;
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
}

export function getPasswordHash(userId: string): string | null {
  const row = accountsDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string | null } | undefined;
  return row?.password_hash ?? null;
}

export function listUsers(): User[] {
  return (accountsDb().prepare("SELECT * FROM users ORDER BY created_at ASC").all() as unknown as UserRow[]).map(toUser);
}

export function emailExists(email: string): boolean {
  return Boolean(accountsDb().prepare("SELECT 1 FROM users WHERE email = ?").get(normaliseEmail(email)));
}

export function updateUser(
  id: string,
  patch: Partial<{ role: Role; status: UserStatus; shareResults: boolean; placementPref: PlacementPref; quota: Record<string, number> | null; displayName: string }>,
): User | null {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.role !== undefined) { sets.push("role = ?"); values.push(patch.role); }
  if (patch.status !== undefined) { sets.push("status = ?"); values.push(patch.status); }
  if (patch.shareResults !== undefined) { sets.push("share_results = ?"); values.push(patch.shareResults ? 1 : 0); }
  if (patch.placementPref !== undefined) { sets.push("placement_pref = ?"); values.push(patch.placementPref); }
  if (patch.quota !== undefined) { sets.push("quota_json = ?"); values.push(patch.quota ? JSON.stringify(patch.quota) : null); }
  if (patch.displayName !== undefined) { sets.push("display_name = ?"); values.push(patch.displayName.trim()); }
  if (sets.length > 0) accountsDb().prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  return getUserById(id);
}

export function setPasswordHash(userId: string, passwordHash: string): void {
  accountsDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function touchLastLogin(userId: string, now: number): void {
  accountsDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, userId);
}

// ── Sessions ───────────────────────────────────────────────────────────────────────────────────────

export interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen: number;
}

export function insertSession(row: SessionRow & { user_agent: string | null; ip: string | null }): void {
  accountsDb()
    .prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.id_hash, row.user_id, row.created_at, row.expires_at, row.last_seen, row.user_agent, row.ip);
}

export function getSession(idHash: string): SessionRow | null {
  return (accountsDb().prepare("SELECT id_hash, user_id, created_at, expires_at, last_seen FROM sessions WHERE id_hash = ?").get(idHash) as SessionRow | undefined) ?? null;
}

export function touchSession(idHash: string, now: number): void {
  accountsDb().prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(now, idHash);
}

export function deleteSession(idHash: string): void {
  accountsDb().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
}

/** Revoke every session of a user, optionally keeping one (the caller's own, on a password change). */
export function deleteUserSessions(userId: string, exceptIdHash?: string): void {
  if (exceptIdHash) accountsDb().prepare("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?").run(userId, exceptIdHash);
  else accountsDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteExpiredSessions(now: number, idleMs: number): void {
  accountsDb().prepare("DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?").run(now, now - idleMs);
}

// ── Invites and reset links ────────────────────────────────────────────────────────────────────────

export function insertInvite(input: { tokenHash: string; email: string; role: Role; expiresAt: number; createdBy: string }): void {
  accountsDb()
    .prepare("INSERT INTO invites (token_hash, email, role, expires_at, created_by) VALUES (?, ?, ?, ?, ?)")
    .run(input.tokenHash, normaliseEmail(input.email), input.role, input.expiresAt, input.createdBy);
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: number;
}

/** Unused, unexpired invites. `id` is the token's hash: it identifies the invite, and cannot accept it. */
export function listPendingInvites(now: number): PendingInvite[] {
  return (accountsDb()
    .prepare("SELECT token_hash, email, role, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY expires_at DESC")
    .all(now) as { token_hash: string; email: string; role: Role; expires_at: number }[]).map((r) => ({
    id: r.token_hash,
    email: r.email,
    role: r.role,
    expiresAt: r.expires_at,
  }));
}

/** Withdraw one unused invite. True when one was withdrawn. */
export function deleteInvite(tokenHash: string): boolean {
  return Number(accountsDb().prepare("DELETE FROM invites WHERE token_hash = ? AND used_at IS NULL").run(tokenHash).changes) === 1;
}

/** A fresh invite replaces any older unused one for the same address, so only the newest link works. */
export function deletePendingInvitesFor(email: string): void {
  accountsDb().prepare("DELETE FROM invites WHERE email = ? AND used_at IS NULL").run(normaliseEmail(email));
}

export function getInvite(tokenHash: string): { email: string; role: Role; expires_at: number; used_at: number | null } | null {
  return (accountsDb().prepare("SELECT email, role, expires_at, used_at FROM invites WHERE token_hash = ?").get(tokenHash) as
    | { email: string; role: Role; expires_at: number; used_at: number | null }
    | undefined) ?? null;
}

/** Marks the invite used; true only for the one caller that won (single use under concurrency). */
export function consumeInvite(tokenHash: string, now: number): boolean {
  const r = accountsDb().prepare("UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").run(now, tokenHash, now);
  return Number(r.changes) === 1;
}

export function insertPasswordReset(input: { tokenHash: string; userId: string; expiresAt: number; createdBy: string }): void {
  // A new link replaces any older unused one for the same person — atomically, so two processes
  // sharing the file (blue/green) can never leave two live links.
  inTransaction(() => {
    accountsDb().prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").run(input.userId);
    accountsDb()
      .prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, created_by) VALUES (?, ?, ?, ?)")
      .run(input.tokenHash, input.userId, input.expiresAt, input.createdBy);
  });
}

/** Replace any unused invite for this address with a new one, atomically (only the newest link works). */
export function replaceInvite(input: { tokenHash: string; email: string; role: Role; expiresAt: number; createdBy: string }): void {
  inTransaction(() => {
    deletePendingInvitesFor(input.email);
    insertInvite(input);
  });
}

/** Single-use: returns the user id only for the caller that consumed a live link. */
export function consumePasswordReset(tokenHash: string, now: number): string | null {
  const row = accountsDb().prepare("SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?").get(tokenHash, now) as
    | { user_id: string }
    | undefined;
  if (!row) return null;
  const r = accountsDb().prepare("UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(now, tokenHash);
  return Number(r.changes) === 1 ? row.user_id : null;
}

// ── Agent tokens (paired machines, used from WP-F) ─────────────────────────────────────────────────

export function revokeUserAgentTokens(userId: string, now: number): void {
  accountsDb().prepare("UPDATE agent_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now, userId);
}

export function getAgentByTokenHash(tokenHash: string): { id: string; user_id: string; revoked_at: number | null } | null {
  return (accountsDb().prepare("SELECT id, user_id, revoked_at FROM agent_tokens WHERE token_hash = ?").get(tokenHash) as
    | { id: string; user_id: string; revoked_at: number | null }
    | undefined) ?? null;
}

// ── Login throttling ───────────────────────────────────────────────────────────────────────────────

export function getAttempt(key: string): { count: number; first_at: number; locked_until: number | null } | null {
  return (accountsDb().prepare("SELECT count, first_at, locked_until FROM login_attempts WHERE key = ?").get(key) as
    | { count: number; first_at: number; locked_until: number | null }
    | undefined) ?? null;
}

export function putAttempt(key: string, count: number, firstAt: number, lockedUntil: number | null): void {
  accountsDb()
    .prepare("INSERT INTO login_attempts (key, count, first_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, first_at = excluded.first_at, locked_until = excluded.locked_until")
    .run(key, count, firstAt, lockedUntil);
}

export function clearAttempt(key: string): void {
  accountsDb().prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}

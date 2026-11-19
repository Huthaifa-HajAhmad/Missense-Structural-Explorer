#!/usr/bin/env node
/**
 * Creates test accounts on a FRESH test server: the first admin through /setup, then invited members.
 * Writes users.json ([{email, password}], admin first). Never point this at production.
 *
 *   ADMIN_SETUP_SECRET=... node setup-users.mjs --base http://127.0.0.1:3100 --count 5 --out users.json
 */
import crypto from "node:crypto";
import fs from "node:fs";

const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
const BASE = arg("base");
const COUNT = Number(arg("count") || 5);
const OUT = arg("out") || "users.json";
const SECRET = process.env.ADMIN_SETUP_SECRET;
if (!BASE || !SECRET) throw new Error("Need --base and ADMIN_SETUP_SECRET in the environment.");

const password = () => crypto.randomBytes(18).toString("base64url");
async function post(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${json?.error?.code ?? ""}`);
  const cookie2 = (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).find(c => c.startsWith("mse_session="));
  return { json, cookie: cookie2 };
}

const users = [{ email: "tester1@example.test", password: password() }];
const admin = await post("/api/v1/setup", { secret: SECRET, email: users[0].email, displayName: "Tester 1", password: users[0].password });
for (let i = 2; i <= COUNT; i++) {
  const user = { email: `tester${i}@example.test`, password: password() };
  const invite = await post("/api/v1/admin/invites", { email: user.email, role: "member" }, admin.cookie);
  const token = new URL(invite.json.inviteUrl).hash.replace("#invite=", "");
  await post("/api/v1/auth/accept-invite", { token, password: user.password, displayName: `Tester ${i}` });
  users.push(user);
}
fs.writeFileSync(OUT, JSON.stringify(users), { mode: 0o600 });
console.log(`Created ${users.length} test users in ${OUT}`);

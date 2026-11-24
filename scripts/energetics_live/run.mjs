#!/usr/bin/env node
/**
 * Runs Energetics cases against a live server the way the browser does, and writes one JSON line per
 * case: a timeline (submitted, started, FoldX finished, job finished, each remote engine's answer) and
 * every engine's final status, value and reason.
 *
 *   node run.mjs --base http://host --cases cases.json --users users.json [--parallel] [--out out.jsonl]
 *
 * Each case runs as the signed-in user at index `user` in users.json ([{email, password}], written by
 * setup-users.mjs). A case may name a `pdbFile` to send as the structure. Passwords are never printed
 * and structure text is left out of the output.
 *
 * Companion engines run synchronously inside the FoldX worker or alongside a cached response:
 * there are no remote BioSig or Tamarind polling jobs. When a cached FoldX answer triggers a
 * background ThermoMPNN refresh, the server returns `remoteSubmissionToken` for one long-poll
 * GET /api/v1/remote-submissions/:token.
 */
import fs from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return acc;
}, []));
const BASE = args.base;
// Queue limit (30 min) + FoldX run limit (1,000 s) + 5 minutes for the companion engines.
const FOLDX_LIMIT_MS = 30 * 60_000 + 1_000_000 + 5 * 60_000;
const FOLDX_POLL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 30_000; // the browser's per-request ceiling (CLIENT_FOLDX_POLL_REQUEST_MS)
if (!BASE || !args.cases || !args.users) {
  console.error("Need --base, --cases and --users.");
  process.exit(2);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, cookie) {
  const started = Date.now();
  const headers = { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
  try {
    const res = await fetch(`${BASE}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep the text */ }
    return { status: res.status, ms: Date.now() - started, json, text: json ? undefined : text.slice(0, 300) };
  } catch (err) {
    return { status: 0, ms: Date.now() - started, error: String(err?.message ?? err) };
  }
}

async function signIn(user) {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).find(c => c.startsWith("mse_session="));
  if (!res.ok || !cookie) throw new Error(`Sign-in failed for ${user.email}: HTTP ${res.status}`);
  return cookie;
}

/** Drops structure text and other bulky fields so a result line stays readable. */
function slim(value) {
  return JSON.parse(JSON.stringify(value ?? null, (k, v) =>
    /pdb|Pdb|rawDdGs|pocketResidues|sasPoints|surfaceAtoms/.test(k) && typeof v !== "number" ? undefined : v));
}

/** First value found under `key` anywhere in a response. */
function findKey(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (key in obj && obj[key] !== null && obj[key] !== undefined) return obj[key];
  for (const v of Object.values(obj)) {
    const found = findKey(v, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Polls the FoldX job until it ends. */
async function followJob(jobId, cookie, t0, timeline) {
  let last = null;
  let lastState = "";
  const deadline = Date.now() + FOLDX_LIMIT_MS;
  while (Date.now() < deadline) {
    last = await call("GET", `/api/v1/foldx-job/${jobId}`, undefined, cookie);
    const j = last.json ?? {};
    const state = `${j.status}/${j.phase ?? ""}`;
    if (state !== lastState) { timeline.push({ ms: Date.now() - t0, event: state, queuedAhead: j.queuedAhead ?? null }); lastState = state; }
    if (!timeline.some(e => e.event === "foldx core finished") && findKey(j, "foldxStatus") !== undefined) {
      timeline.push({ ms: Date.now() - t0, event: "foldx core finished", foldxStatus: findKey(j, "foldxStatus") });
    }
    if (["completed", "failed", "cancelled"].includes(String(j.status).toLowerCase())) {
      timeline.push({ ms: Date.now() - t0, event: "job final", status: j.status });
      return last;
    }
    if (last.status !== 200) timeline.push({ ms: Date.now() - t0, event: `poll answered HTTP ${last.status}`, error: last.error ?? null });
    await sleep(FOLDX_POLL_MS);
  }
  timeline.push({ ms: Date.now() - t0, event: "harness gave up (no final state)", httpStatus: last?.status });
  return last;
}

async function runCase(c, cookie) {
  const t0 = Date.now();
  const wtPdb = c.pdbFile ? fs.readFileSync(c.pdbFile, "utf8") : undefined;
  const submit = await call("POST", "/api/v1/generate-mutant", { uniprotId: c.uniprotId, mutation: c.mutation, wtPdb }, cookie);
  const timeline = [{ ms: submit.ms, event: `submitted HTTP ${submit.status}` }];
  const out = { case: c.name, user: c.user ?? 0, uniprotId: c.uniprotId, mutation: c.mutation, startedAt: new Date(t0).toISOString(),
    submit: { status: submit.status, ms: submit.ms, error: submit.error ?? submit.json?.error ?? submit.text } };
  const jobId = submit.json?.foldxJobId ?? submit.json?.jobId;
  const final = jobId ? await followJob(jobId, cookie, t0, timeline) : submit;
  const token = submit.json?.remoteSubmissionToken;
  if (!jobId && token) {
    const sub = await call("GET", `/api/v1/remote-submissions/${encodeURIComponent(token)}`, undefined, cookie);
    timeline.push({ ms: Date.now() - t0, event: `remote submissions answered HTTP ${sub.status}`, settled: sub.json?.settled ?? null });
    out.remoteSubmission = sub.json ?? null;
  }
  out.foldxJobId = jobId ?? null;
  out.result = slim(final.json?.result ?? final.json);
  out.timeline = timeline;
  out.settledMs = timeline.at(-1).ms;
  return out;
}

const cases = JSON.parse(fs.readFileSync(args.cases, "utf8"));
const users = JSON.parse(fs.readFileSync(args.users, "utf8"));
const cookies = await Promise.all(users.map(signIn));
const write = line => {
  const text = JSON.stringify(line);
  console.log(text);
  if (args.out) fs.appendFileSync(args.out, text + "\n");
};
if (args.parallel) {
  await Promise.all(cases.map(c => runCase(c, cookies[c.user ?? 0]).then(write)));
} else {
  for (const c of cases) write(await runCase(c, cookies[c.user ?? 0]));
}

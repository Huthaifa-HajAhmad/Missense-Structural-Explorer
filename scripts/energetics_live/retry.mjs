#!/usr/bin/env node
/**
 * Retries one engine the way the panel's retry control does (src/components/energetics/RetryDynamut2.tsx,
 * RetryThermompnn.tsx): POST the template and the mutation to /<tool>-submit, then poll a returned job id.
 *
 *   node retry.mjs --base http://host --users users.json --user 0 --tool dynamut2|thermompnn \
 *     --pdbFile /pdb/1FIT.pdb --mutation FA47A
 */
import fs from "node:fs";

const arg = name => process.argv[process.argv.indexOf(`--${name}`) + 1];
const BASE = arg("base");
const tool = arg("tool");
const user = JSON.parse(fs.readFileSync(arg("users"), "utf8"))[Number(arg("user") ?? 0)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user),
});
const cookie = login.headers.getSetCookie().map(c => c.split(";")[0]).find(c => c.startsWith("mse_session="));
const headers = { "Content-Type": "application/json", Cookie: cookie };
const t0 = Date.now();
const submit = await fetch(`${BASE}/api/v1/${tool}-submit`, {
  method: "POST", headers,
  body: JSON.stringify({ wtPdb: fs.readFileSync(arg("pdbFile"), "utf8"), mutation: arg("mutation") }),
});
const body = await submit.json().catch(() => ({}));
const out = { tool, submitStatus: submit.status, submit: body };
const jobId = body.jobId ?? body.dynamut2JobId ?? body.thermompnnJobId;
if (jobId && !String(jobId).startsWith("local") && body.prediction == null) {
  for (let i = 0; i < 120; i++) {
    const r = await fetch(`${BASE}/api/v1/${tool}-job/${jobId}`, { headers });
    const d = await r.json().catch(() => ({}));
    out.poll = { httpStatus: r.status, status: d.status, prediction: d.prediction ?? null, error: d.error ?? null, reason: d.reason ?? null };
    if (!/RUNNING|PENDING|QUEUED/i.test(String(d.status ?? ""))) break;
    await sleep(5_000);
  }
}
out.ms = Date.now() - t0;
console.log(JSON.stringify(out));

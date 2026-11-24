#!/usr/bin/env node
/**
 * Retries local ThermoMPNN the way the panel's retry control does (src/components/energetics/
 * RetryThermompnn.tsx): POST the template and the mutation to /thermompnn-submit.
 *
 *   node retry.mjs --base http://host --users users.json --user 0 --tool thermompnn \
 *     --pdbFile /pdb/1FIT.pdb --mutation FA47A
 */
import fs from "node:fs";

const arg = name => process.argv.indexOf(`--${name}`) >= 0 ? process.argv[process.argv.indexOf(`--${name}`) + 1] : undefined;
const BASE = arg("base");
const tool = arg("tool") ?? "thermompnn";
const user = JSON.parse(fs.readFileSync(arg("users"), "utf8"))[Number(arg("user") ?? 0)];

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
const out = { tool, submitStatus: submit.status, submit: body, ms: Date.now() - t0 };
console.log(JSON.stringify(out));

#!/usr/bin/env node
/**
 * Samples GET /api/v1/health while a load test runs and reports how fast it answered (criterion B4:
 * 95% of answers within 1 s, no timeouts). Stops after --seconds, or earlier when --until-file exists.
 *
 *   node health.mjs --base http://host --seconds 3600 [--interval 2] [--until-file done.flag] [--out health.json]
 */
import fs from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const BASE = arg("base");
const SECONDS = Number(arg("seconds", 3600));
const INTERVAL_MS = Number(arg("interval", 2)) * 1000;
const UNTIL = arg("until-file");
const TIMEOUT_MS = 5_000;
if (!BASE) throw new Error("Need --base.");

const samples = [];
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end && !(UNTIL && fs.existsSync(UNTIL))) {
  const t = Date.now();
  let status = 0;
  try {
    const res = await fetch(`${BASE}/api/v1/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    status = res.status;
    await res.arrayBuffer();
  } catch { /* status 0 marks a timeout or a refused connection */ }
  samples.push({ at: t, ms: Date.now() - t, status });
  await new Promise(r => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t))));
}

const ok = samples.filter(s => s.status === 200).map(s => s.ms).sort((a, b) => a - b);
const pct = p => (ok.length ? ok[Math.min(ok.length - 1, Math.floor(p * ok.length))] : null);
const summary = {
  samples: samples.length, ok: ok.length, failed: samples.length - ok.length,
  p50Ms: pct(0.5), p95Ms: pct(0.95), maxMs: ok.at(-1) ?? null,
  over1s: ok.filter(ms => ms > 1000).length,
};
console.log(JSON.stringify(summary));
if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify({ summary, samples }));

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * WP-I1 ratchet: every remote call in `server/services` and `server/routes` goes through the egress
 * governor (`fetchWithRetry`, `withHostLock` or `governedFetch` in `http-client.ts`).
 *
 * A raw `fetch(` skips the fair share AND the team-wide 429 pause, so one new call site can get the
 * whole team rate limited again. The files below are the only places a raw `fetch(` is allowed, each
 * with its reason and its exact count. The list may only SHRINK: a new raw call fails this test, and
 * so does removing one without lowering its count here (so the list never overstates what is left).
 *
 * Scope is `server/services` and `server/routes`, where every provider call lives. Outside it,
 * `server/agent` runs on a person's own computer (its downloads are not the team's egress), and
 * `deployment-control.ts` and `sidecar-supervisor.ts` only call the loopback sidecar.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "server/services/infra/http-client.ts": { count: 3, why: "the governed implementations themselves" },
  "server/services/external-api/adapters/service-adapters.ts": { count: 1, why: "sidecar /health (loopback)" },
  "server/services/external-api/esm2.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/external-api/esm3_forge.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/external-api/esmc.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/external-api/saprot.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/stability/stabilityoracle.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/structure/folding-engines.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/services/structure/structural-diff/evaluator.ts": { count: 1, why: "model sidecar (loopback)" },
  "server/routes/capabilities.ts": { count: 3, why: "sidecar /health, and the JapanFold reachability probe (a monitor)" },
  "server/routes/health.ts": { count: 1, why: "sidecar /health (loopback)" },
  "server/routes/structure.ts": { count: 2, why: "sidecar /health (loopback)" },
  "server/routes/variant/alphagenome.ts": { count: 1, why: "the user's own AlphaGenome connection test, to their URL" },
};

/** A bare `fetch(`, `fetch (`, or the global reached explicitly (`globalThis.fetch(`); not `obj.fetch(`. */
const RAW_FETCH = /(?:(?<![\w.$])|(?<=\b(?:globalThis|global|window)\.))fetch\s*\(/g;
/** A method or interface member NAMED fetch (`async fetch(input: T)`, `fetch(input: T): Promise<…>`). */
const FETCH_DECLARATION = /^(?:async\s+)?fetch\s*\(\s*\w+\??\s*:/;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
}

function rawFetchCounts(): Record<string, number> {
  const root = process.cwd();
  const files: string[] = [];
  for (const dir of ["server/services", "server/routes"]) walk(path.join(root, dir), files);
  const counts: Record<string, number> = {};
  for (const file of files) {
    let n = 0;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const t = line.trim();
      // Comments, and adapter methods that happen to be NAMED fetch.
      if (t.startsWith("//") || t.startsWith("/*") || /^\*(\s|\/|$)/.test(t) || FETCH_DECLARATION.test(t)) continue;
      n += (line.match(RAW_FETCH) ?? []).length;
    }
    if (n) counts[path.relative(root, file).split(path.sep).join("/")] = n;
  }
  return counts;
}

describe("egress ratchet (WP-I1)", () => {
  it("allows a raw fetch( only where the list says, and the list matches the code exactly", () => {
    const counts = rawFetchCounts();
    const problems: string[] = [];
    for (const [file, n] of Object.entries(counts)) {
      const allowed = ALLOWED[file];
      if (!allowed) problems.push(`${file}: ${n} raw fetch( call(s); use governedFetch or fetchWithRetry (http-client.ts)`);
      else if (n > allowed.count) problems.push(`${file}: ${n} raw fetch( calls, ${allowed.count} allowed`);
      else if (n < allowed.count) problems.push(`${file}: now ${n}; lower its count in ALLOWED to ${n}`);
    }
    for (const file of Object.keys(ALLOWED)) {
      if (!counts[file]) problems.push(`${file}: no raw fetch( left; remove it from ALLOWED`);
    }
    expect(problems).toEqual([]);
  });
});

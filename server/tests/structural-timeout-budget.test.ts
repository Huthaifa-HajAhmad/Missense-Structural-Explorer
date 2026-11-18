import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CLIENT_STREAM_IDLE_BUDGET_MS,
  CLIENT_STRUCTURAL_REQUEST_BUDGET_MS,
  STREAM_HEARTBEAT_MS
} from "../../src/shared/timeouts.ts";
import { stripCommentsForScan } from "../../src/shared/engineStatus.ts";
import { CONFIG } from "../config.ts";

const read = (...parts: string[]) => stripCommentsForScan(fs.readFileSync(path.join(process.cwd(), ...parts), "utf-8"));

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRUCTURAL STAGE'S CLOCKS — what must stay true so a slow stage cannot cost the reader its answer
 * ─────────────────────────────────────────────────────────────────────────────
 * The route answered once, as one JSON body, under a fixed client limit that could undercut the server's
 * own, so a run that used its whole allowance lost its answer. These tests pin the properties of the fix
 * (a streamed answer with heartbeats and per-chunk bounds), not only its numbers.
 */
describe("structural stage budgets", () => {
  it("has no fixed total client limit that can undercut the server's", () => {
    const client = read("src", "api", "biophysicsApi.ts");
    expect(client, "the client must not carry its own copy of a structural time limit").not.toContain("125000");
    expect(client).toContain("CLIENT_STRUCTURAL_REQUEST_BUDGET_MS");
  });

  it("keeps the per-chunk stall bound no tighter than the stream's own silence bound", () => {
    // `fetchWithAuth` re-arms its timeout on every chunk; if it were shorter than the reader's idle
    // bound it would be the one to hang up on a healthy slow run.
    expect(CLIENT_STRUCTURAL_REQUEST_BUDGET_MS).toBeGreaterThanOrEqual(CLIENT_STREAM_IDLE_BUDGET_MS);
    expect(CLIENT_STREAM_IDLE_BUDGET_MS / STREAM_HEARTBEAT_MS).toBeGreaterThanOrEqual(3);
  });

  it("bounds the burial refresh with its own deadline", () => {
    expect(CONFIG.timeouts.structuralTailMs).toBeGreaterThan(0);
    // The refresh is a best-effort extra: it must finish inside the client's own per-chunk bound.
    expect(CONFIG.timeouts.structuralTailMs).toBeLessThan(CLIENT_STRUCTURAL_REQUEST_BUDGET_MS);
    expect(read("server", "services", "orchestration", "analysis-orchestrator.ts")).toContain("CONFIG.timeouts.structuralTailMs");
  });

  it("streams from the route only when asked, and heartbeats while it waits", () => {
    const route = read("server", "routes", "variant", "analysis.ts");
    expect(route).toContain("application/x-ndjson");
    expect(route).toContain("streamStructuralAnalysis");
    const orchestrator = read("server", "services", "orchestration", "analysis-orchestrator.ts");
    expect(orchestrator).toMatch(/streamStructuralAnalysis[\s\S]*withHeartbeat/);
  });
});

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
 * THE STRUCTURAL STAGE'S CLOCKS — what must stay true so one slow model cannot cost the reader a fast one
 * ─────────────────────────────────────────────────────────────────────────────
 * The route answered once, as one JSON body, under a fixed 125 s client limit. The server's own limit for
 * the four deep models is 120 s, and the client's clock started a few seconds before the server's, so a
 * run that used its whole allowance lost every model — including ESM-2, which finished 0.4 s inside the
 * limit on the production VM. These tests pin the properties of the fix, not only its numbers.
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

  it("takes the inner model-call limits from the one structural setting", () => {
    // ESM-2 and SaProt each had their own `120000`, equal to the route's race, so the two could be edited
    // apart without any test noticing. They now read the same value the route races against.
    for (const file of ["esm2.ts", "saprot.ts"]) {
      const source = read("server", "services", "external-api", file);
      expect(source, `${file} must not hard-code a structural time limit`).not.toMatch(/AbortSignal\.timeout\(\s*\d/);
      expect(source).toContain("CONFIG.timeouts.structuralModelsMs");
    }
    expect(read("server", "services", "orchestration", "analysis-orchestrator.ts")).toContain("CONFIG.timeouts.structuralModelsMs");
  });

  it("bounds the work after the models with its own deadline", () => {
    expect(CONFIG.timeouts.structuralTailMs).toBeGreaterThan(0);
    // The tail is a best-effort extra: it must be shorter than the models' own stage.
    expect(CONFIG.timeouts.structuralTailMs).toBeLessThan(CONFIG.timeouts.structuralModelsMs);
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

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CLIENT_STREAM_IDLE_BUDGET_MS,
  STREAM_HEARTBEAT_MS,
} from "../../src/shared/timeouts.ts";
import { stripCommentsForScan } from "../../src/shared/engineStatus.ts";
import { CONFIG } from "../config.ts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A HEALTHY SLOW STREAM MUST NOT LOOK DEAD
 * ─────────────────────────────────────────────────────────────────────────────
 * The client's silence bound (30 s) was SHORTER than the server's own budget for one stage
 * (`coreAnalysisMs`, 45 s), so the client hung up inside the server's allowance and the reader was
 * shown "Streaming connection stalled" for a run that was still working. Verified against the real
 * client function: one chunk, then 31 s of silence, and the whole biophysical leg rejected.
 *
 * The fix is the heartbeat, and what has to stay true for it to work is a RATIO, not a value:
 * several heartbeats must fit inside the bound, or one dropped frame kills a live stream. This test
 * is the thing that fails if either number is edited in isolation.
 */
describe("progressive stream liveness budgets", () => {
  it("fits several heartbeats inside the client's silence bound", () => {
    const heartbeatsPerBound = CLIENT_STREAM_IDLE_BUDGET_MS / STREAM_HEARTBEAT_MS;
    expect(
      heartbeatsPerBound,
      `only ${heartbeatsPerBound} heartbeat(s) fit inside ${CLIENT_STREAM_IDLE_BUDGET_MS}ms — one ` +
        `dropped frame would abort a live stream`
    ).toBeGreaterThanOrEqual(3);
  });

  it("beats the server's own worst-case gap between data chunks", () => {
    // The server may legitimately spend `coreAnalysisMs` settling the slowest source before the
    // final frame; the heartbeat is what covers that window.
    expect(STREAM_HEARTBEAT_MS).toBeLessThan(CONFIG.timeouts.coreAnalysisMs);
    expect(CLIENT_STREAM_IDLE_BUDGET_MS).toBeGreaterThan(0);
  });

  it("actually emits the heartbeat and clears it", () => {
    /**
     * Guards the behaviour, not only the constants: an interval that is never written to the stream,
     * or never cleared, is either inert (the defect returns) or a leak per request.
     *
     * The source is scanned with comments REMOVED. A raw `toContain` is satisfied by this module's own
     * documentation of the string it is looking for — a guard that a future comment can pass is not a
     * guard. (`stripCommentsForScan` is the project's shared, string-aware stripper; the alternative,
     * a second regex-based one, is the blindness that made the legacy-label scanner useless.)
     */
    const source = stripCommentsForScan(
      fs.readFileSync(
        path.join(process.cwd(), "server", "services", "orchestration", "analysis-orchestrator.ts"),
        "utf-8"
      )
    );
    expect(source).toContain("STREAM_HEARTBEAT_MS");
    expect(source).toContain("setInterval");
    expect(source).toContain("clearInterval(heartbeats)");
    expect(source).toContain('type: "heartbeat"');
  });

  it("keeps the client's bound out of the stream's data path", () => {
    // The client must IGNORE a heartbeat rather than merge it into the analysis result; a
    // `{type:"heartbeat"}` spread into the payload is a silent shape change of the result object.
    const client = fs.readFileSync(
      path.join(process.cwd(), "src", "api", "biophysicsApi.ts"),
      "utf-8"
    );
    expect(client).toContain("CLIENT_STREAM_IDLE_BUDGET_MS");
    expect(client).toMatch(/parsed\.type === "heartbeat"/);
  });
});

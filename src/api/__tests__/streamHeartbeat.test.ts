import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBiophysicsApi } from "../biophysicsApi";
import { CLIENT_STREAM_IDLE_BUDGET_MS, STREAM_HEARTBEAT_MS } from "../../shared/timeouts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HEARTBEATS ARE LIVENESS, NOT PAYLOAD
 * ─────────────────────────────────────────────────────────────────────────────
 * The client used to treat every silent stretch as death: a run that produced no DATA for 30 s was
 * reported as "Streaming connection stalled" even though the server's own per-stage budget allowed
 * 45 s. Measured by feeding the real function one chunk and then 31 s of silence.
 *
 * With the server heartbeating, two properties have to hold: a heartbeat must reset the silence
 * bound (otherwise the fix is inert), and it must never reach the chunk handler or the final
 * payload (otherwise the analysis result gains a `type: "heartbeat"` key).
 */

function makeStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const fetchWithAuth = vi.fn(async () => new Response(body, { status: 200 }));
  return {
    fetchWithAuth,
    pushLine: (line: string) => controller.enqueue(new TextEncoder().encode(line + "\n")),
    close: () => controller.close()
  };
}

const finalPayload = {
  analysis: "complete",
  status: "success",
  metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" }
};

describe("streamBiophysicalAnalysis liveness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("survives a silence longer than the old fixed bound, as long as heartbeats keep arriving", async () => {
    const { fetchWithAuth, pushLine, close } = makeStream();
    const api = createBiophysicsApi(fetchWithAuth as any);
    const chunks: any[] = [];

    const run = api.streamBiophysicalAnalysis(
      { gene: "PAH", uniprotId: "P00439", variant: "p.Arg408Trp" },
      chunk => chunks.push(chunk)
    );

    pushLine(JSON.stringify({ chunkIndex: 1, isFinal: false, data: { clinvar: { classification: "Pathogenic" } } }));
    await vi.advanceTimersByTimeAsync(0);

    /**
     * Two heartbeat intervals beyond the bound: without a heartbeat the run would already have been
     * declared stalled, which is precisely the defect (the bound is shorter than the server's own
     * allowance for one stage).
     */
    const silenceMs = CLIENT_STREAM_IDLE_BUDGET_MS + STREAM_HEARTBEAT_MS * 2;
    for (let elapsed = 0; elapsed < silenceMs; elapsed += STREAM_HEARTBEAT_MS) {
      pushLine(JSON.stringify({ type: "heartbeat" }));
      await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_MS);
    }

    pushLine(JSON.stringify({ chunkIndex: 9, isFinal: true, data: finalPayload }));
    close();

    const result = await run;
    expect(result.metadata.gene).toBe("PAH");
    // The heartbeat never became a chunk...
    expect(chunks.every(c => c.type !== "heartbeat")).toBe(true);
    expect(chunks.some(c => c.clinvar?.classification === "Pathogenic")).toBe(true);
    // ...and certainly never a field of the result.
    expect((result as any).type).toBeUndefined();
  });

  it("still rejects a stream that goes silent without heartbeats", async () => {
    const { fetchWithAuth, pushLine } = makeStream();
    const api = createBiophysicsApi(fetchWithAuth as any);

    const run = api.streamBiophysicalAnalysis(
      { gene: "PAH", uniprotId: "P00439", variant: "p.Arg408Trp" },
      () => {}
    );
    pushLine(JSON.stringify({ chunkIndex: 1, isFinal: false, data: { clinvar: {} } }));
    await vi.advanceTimersByTimeAsync(0);

    const settled = run.then(() => "resolved").catch((e: Error) => `rejected: ${e.message}`);
    await vi.advanceTimersByTimeAsync(CLIENT_STREAM_IDLE_BUDGET_MS + 1_000);

    // Silence must still mean something, or a dead transport hangs a spinner forever.
    await expect(settled).resolves.toMatch(/rejected: Streaming connection stalled/);
  });
});

describe("streamBiophysicalAnalysis truncated final frame", () => {
  it("says so in the Console when the last frame is cut off, and still returns the payload it did receive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ chunkIndex: 1, isFinal: true, data: finalPayload }) + String.fromCharCode(10)));
        // A frame severed mid-write: no trailing newline, not valid JSON.
        controller.enqueue(encoder.encode('{"chunkIndex":2,"isFin'));
        controller.close();
      }
    });
    const api = createBiophysicsApi((async () => new Response(body, { status: 200 })) as any);

    const result = await api.streamBiophysicalAnalysis(
      { gene: "PAH", uniprotId: "P00439", variant: "p.Arg408Trp" },
      () => {}
    );

    expect(result.metadata.gene).toBe("PAH");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[Stream Parse Warning] The final stream frame"),
      expect.anything()
    );
    warn.mockRestore();
  });
});

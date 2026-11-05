import { describe, it, expect, vi } from "vitest";
import { createBiophysicsApi } from "../biophysicsApi";
import { CLIENT_STRUCTURAL_REQUEST_BUDGET_MS } from "../../shared/timeouts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRUCTURAL CALL STREAMS, SO A SLOW MODEL CANNOT COST THE READER A FAST ONE
 * ─────────────────────────────────────────────────────────────────────────────
 * The call used to wait for one JSON body under a fixed 125 s limit. The server's own limit for the four
 * models is 120 s and the client's clock started a few seconds earlier, so a run that used its whole
 * allowance lost every model — including one that had finished 0.4 s before the server's limit.
 */

const params = { gene: "GATA4", uniprotId: "P43694", variant: "p.Ser159Cys" };

function ndjson(lines: unknown[], headers: Record<string, string> = { "content-type": "application/x-ndjson; charset=utf-8" }) {
  const body = lines.map(line => JSON.stringify(line)).join("\n") + "\n";
  return new Response(body, { status: 200, headers });
}

describe("getStructuralAssessments streaming", () => {
  it("asks for NDJSON, hands each model to the listener in order, and resolves with the final frame", async () => {
    const fetchWithAuth = vi.fn(async () => ndjson([
      { type: "heartbeat" },
      { type: "model", key: "esm3", evaluation: { score: -4.5 }, status: "ok", durationMs: 40 },
      { type: "heartbeat" },
      { type: "model", key: "esmc", evaluation: { error: "slow", status: "timeout" }, status: "timeout", durationMs: 60 },
      { type: "final", data: { esm3Eval: { score: -4.5 }, esmcEval: { error: "slow", status: "timeout" }, esm2Eval: null, saprotEval: null, ruleBasedInsights: {} } }
    ]));
    const api = createBiophysicsApi(fetchWithAuth as any);
    const heard: any[] = [];

    const result = await api.getStructuralAssessments(params, undefined, frame => heard.push(frame));

    const [, init] = (fetchWithAuth.mock.calls as any)[0] as [string, RequestInit & { timeout?: number }];
    expect((init.headers as Record<string, string>).Accept).toBe("application/x-ndjson");
    expect(init.timeout, "a bounded silence, not a total cap").toBe(CLIENT_STRUCTURAL_REQUEST_BUDGET_MS);
    expect(heard.map(frame => frame.key), "heartbeats are liveness, not models").toEqual(["esm3", "esmc"]);
    expect(heard[1]).toMatchObject({ status: "timeout", durationMs: 60 });
    expect(result.esm3Eval).toEqual({ score: -4.5 });
  });

  it("still returns the complete result when nobody listens for individual models", async () => {
    const api = createBiophysicsApi((async () => ndjson([
      { type: "model", key: "esm3", evaluation: { score: 1 }, status: "ok", durationMs: 1 },
      { type: "final", data: { esm3Eval: { score: 1 } } }
    ])) as any);
    expect((await api.getStructuralAssessments(params)).esm3Eval).toEqual({ score: 1 });
  });

  it("understands a server that still answers with one JSON body", async () => {
    const api = createBiophysicsApi((async () =>
      new Response(JSON.stringify({ esm3Eval: { score: 2 } }), { status: 200, headers: { "content-type": "application/json" } })
    ) as any);
    const heard: any[] = [];
    expect((await api.getStructuralAssessments(params, undefined, frame => heard.push(frame))).esm3Eval).toEqual({ score: 2 });
    expect(heard).toEqual([]);
  });

  it("fails with the server's message when the run itself fails, keeping models already heard", async () => {
    const api = createBiophysicsApi((async () => ndjson([
      { type: "model", key: "esm3", evaluation: { score: 3 }, status: "ok", durationMs: 1 },
      { type: "error", error: "database unavailable" }
    ])) as any);
    const heard: any[] = [];
    await expect(api.getStructuralAssessments(params, undefined, frame => heard.push(frame))).rejects.toThrow("database unavailable");
    expect(heard.map(frame => frame.key)).toEqual(["esm3"]);
  });

  it("reports a stream that ended without its final result, rather than resolving with nothing", async () => {
    const api = createBiophysicsApi((async () => ndjson([
      { type: "model", key: "esm3", evaluation: { score: 3 }, status: "ok", durationMs: 1 }
    ])) as any);
    await expect(api.getStructuralAssessments(params)).rejects.toThrow(/before its final result/);
  });

  it("turns an HTTP error into the server's message", async () => {
    const api = createBiophysicsApi((async () =>
      new Response(JSON.stringify({ error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } })
    ) as any);
    await expect(api.getStructuralAssessments(params)).rejects.toThrow(/boom/);
  });
});

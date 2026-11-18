import { describe, it, expect, vi } from "vitest";
import { createBiophysicsApi } from "../biophysicsApi";
import { CLIENT_STRUCTURAL_REQUEST_BUDGET_MS } from "../../shared/timeouts";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STRUCTURAL CALL STREAMS, SO A SLOW STAGE CANNOT COST THE READER ITS ANSWER
 * ─────────────────────────────────────────────────────────────────────────────
 * The call used to wait for one JSON body under a fixed limit that could undercut the server's own, so a
 * run that used its whole allowance lost its answer. It now reads heartbeats and resolves with the final
 * frame. Servers before 2026-11-18 also sent one `model` frame per protein language model; those models
 * were retired, and such frames are ignored.
 */

const params = { gene: "GATA4", uniprotId: "P43694", variant: "p.Ser159Cys" };

function ndjson(lines: unknown[], headers: Record<string, string> = { "content-type": "application/x-ndjson; charset=utf-8" }) {
  const body = lines.map(line => JSON.stringify(line)).join("\n") + "\n";
  return new Response(body, { status: 200, headers });
}

describe("getStructuralAssessments streaming", () => {
  it("asks for NDJSON with a bounded silence and resolves with the final frame", async () => {
    const fetchWithAuth = vi.fn(async () => ndjson([
      { type: "heartbeat" },
      { type: "model", key: "esm3", evaluation: { score: -4.5 }, status: "ok", durationMs: 40 },
      { type: "heartbeat" },
      { type: "final", data: { disruptionPredictor: { rsa: 0.4 }, ruleBasedInsights: {} } }
    ]));
    const api = createBiophysicsApi(fetchWithAuth as any);

    const result = await api.getStructuralAssessments(params);

    const [, init] = (fetchWithAuth.mock.calls as any)[0] as [string, RequestInit & { timeout?: number }];
    expect((init.headers as Record<string, string>).Accept).toBe("application/x-ndjson");
    expect((init.headers as Record<string, string>)["X-SaProt-Engine"], "no retired model setting is sent").toBeUndefined();
    expect(init.timeout, "a bounded silence, not a total cap").toBe(CLIENT_STRUCTURAL_REQUEST_BUDGET_MS);
    expect(result.disruptionPredictor).toEqual({ rsa: 0.4 });
  });

  it("understands a server that still answers with one JSON body", async () => {
    const api = createBiophysicsApi((async () =>
      new Response(JSON.stringify({ ruleBasedInsights: { acmgVerdict: "VUS" } }), { status: 200, headers: { "content-type": "application/json" } })
    ) as any);
    expect((await api.getStructuralAssessments(params)).ruleBasedInsights).toEqual({ acmgVerdict: "VUS" });
  });

  it("fails with the server's message when the run itself fails", async () => {
    const api = createBiophysicsApi((async () => ndjson([
      { type: "heartbeat" },
      { type: "error", error: "database unavailable" }
    ])) as any);
    await expect(api.getStructuralAssessments(params)).rejects.toThrow("database unavailable");
  });

  it("reports a stream that ended without its final result, rather than resolving with nothing", async () => {
    const api = createBiophysicsApi((async () => ndjson([{ type: "heartbeat" }])) as any);
    await expect(api.getStructuralAssessments(params)).rejects.toThrow(/before its final result/);
  });

  it("turns an HTTP error into the server's message", async () => {
    const api = createBiophysicsApi((async () =>
      new Response(JSON.stringify({ error: { code: "INTERNAL_SERVER_ERROR", message: "boom" } }), { status: 500, headers: { "content-type": "application/json" } })
    ) as any);
    await expect(api.getStructuralAssessments(params)).rejects.toThrow(/boom/);
  });
});

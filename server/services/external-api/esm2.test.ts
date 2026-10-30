import { describe, it, expect, vi, afterEach } from "vitest";
import { runEsm2Analysis } from "./esm2.ts";
import { parseShiftWindow } from "./lmShiftWindow.ts";
import { parseRemoteFailure } from "./remoteFailure.ts";

const sidecarAnswers = (body: unknown) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));

describe("ESM-2 Service Integration Tests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preserves an absent embedding window instead of reporting a measured zero", async () => {
    sidecarAnswers({ status: "success", llr: -2 });
    const result = await runEsm2Analysis("GATA4", "p.Ser159Cys", "P43694", "MSLS", null);
    expect(result).toMatchObject({ llr: -2 });
    expect(result!.localEmbeddingShift).toBeUndefined();
    expect(result!.embeddingShift).toBeUndefined();
  });

  it("should return structured error object if sidecar is unreachable/fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network connection failed")));

    const result = await runEsm2Analysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);
    expect(result).toBeDefined();
    expect(result?.error).toMatch(/standby|offline|failed/i);
    expect(result?.status).toBe("offline");
  });

  it("should successfully parse sidecar response and map all metrics including klDivergence", async () => {
    sidecarAnswers({
      status: "success",
      llr: -3.5,
      wtProbability: 0.12,
      mutProbability: 0.005,
      mutRank: 18,
      positionalEntropy: 1.85,
      embeddingShift: 0.45,
      klDivergence: 0.85,
      localShiftMap: [
        { position: 488, residue: "S", shift: 0.2 },
        { position: 489, residue: "S", shift: 0.6 },
        { position: 490, residue: "L", shift: 0.4 }
      ]
    });

    const result = await runEsm2Analysis("CNNM2", "p.Ser489Cys", "Q9H8Y5", "MSLS...", null);

    expect(result).toBeDefined();
    expect(result!.llr).toBe(-3.5);
    expect(result!.wtProbability).toBe(0.12);
    expect(result!.mutProbability).toBe(0.005);
    expect(result!.mutRank).toBe(18);
    expect(result!.positionalEntropy).toBe(1.85);
    expect(result!.embeddingShift).toBe(0.45);
    expect(result!.klDivergence).toBe(0.85);
    expect(result!.localEmbeddingShift).toBeCloseTo(0.4);
  });

  it("carries the checkpoint, scoring method, coded refusal and skipped-trace note through", async () => {
    sidecarAnswers({
      status: "success",
      llr: 1.2,
      provenance: "ESM-2 (esm2_t33_650M_UR50D - Local CPU)",
      checkpoint: "facebook/esm2_t33_650M_UR50D",
      scoringMethod: "masked-marginal",
      embeddingNote: "The embedding shift was not computed.",
      remoteEngineNote: "HTTP 402 - inference credits exhausted",
      remoteFailure: { provider: "huggingface", code: "billing" }
    });
    const result = await runEsm2Analysis("GATA4", "p.Ser159Cys", "P43694", "MSLS", "hf_token");
    expect(result).toMatchObject({
      checkpoint: "facebook/esm2_t33_650M_UR50D",
      scoringMethod: "masked-marginal",
      embeddingNote: "The embedding shift was not computed.",
      remoteFailure: { provider: "huggingface", code: "billing" }
    });
  });
});

describe("parseShiftWindow", () => {
  it("drops entries without a finite position or shift instead of counting them as 0", () => {
    const { localShiftMap, localEmbeddingShift } = parseShiftWindow([
      { position: 1, residue: "A", shift: 0.3 },
      { position: 2, residue: "B", shift: null },
      { position: Number.NaN, residue: "C", shift: 0.9 },
      { position: 4, residue: "D", shift: 0.1 }
    ]);
    expect(localShiftMap.map(d => d.position)).toEqual([1, 4]);
    expect(localEmbeddingShift).toBeCloseTo(0.2);
  });

  it("leaves the mean absent when nothing was measured", () => {
    expect(parseShiftWindow(undefined)).toEqual({ localShiftMap: [], localEmbeddingShift: undefined });
    expect(parseShiftWindow([{ position: 1, residue: "A" }]).localEmbeddingShift).toBeUndefined();
  });
});

describe("parseRemoteFailure", () => {
  it("accepts only the sidecar's codes", () => {
    expect(parseRemoteFailure({ provider: "biohub", code: "region" })).toEqual({ provider: "biohub", code: "region" });
    expect(parseRemoteFailure({ provider: "biohub", code: "solar-flare" })).toBeNull();
    expect(parseRemoteFailure({ code: "billing" })).toBeNull();
    expect(parseRemoteFailure(null)).toBeNull();
  });
});

describe("ESM-2 adapter failure codes and provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([401, 403])("tags HTTP %i from the model server as unauthorized", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    const result = await runEsm2Analysis("GATA4", "p.Ser159Cys", "P43694", "MSLS", null);
    expect(result?.status).toBe("unauthorized");
  });

  it("says a timeout was a timeout, not that the server is warming up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    const result = await runEsm2Analysis("GATA4", "p.Ser159Cys", "P43694", "MSLS", null);
    expect(result?.status).toBe("timeout");
    expect(result?.error).toBe("ESM-2 timed out waiting for the model server");
  });

  it("leaves provenance unnamed when the payload names no model, instead of crediting ESM-2", async () => {
    sidecarAnswers({ status: "success", llr: -1 });
    const result = await runEsm2Analysis("GATA4", "p.Ser159Cys", "P43694", "MSLS", null);
    expect(result?.provenance).toBeUndefined();
  });
});

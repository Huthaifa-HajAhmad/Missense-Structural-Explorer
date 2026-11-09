// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstDiagnosticsReading, subscribeDiagnostics } from "../diagnosticsStore";

const answer = (body: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body })) as any;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waiting for the first health reading", () => {
  it("resolves with what the server reported", async () => {
    vi.stubGlobal("fetch", answer({ geminiReady: true }));
    const reading = await firstDiagnosticsReading();
    expect(reading.diagnostics?.geminiReady).toBe(true);
  });

  it("resolves when the check fails, so a caller is never left waiting", async () => {
    vi.stubGlobal("fetch", answer(null, false));
    const reading = await firstDiagnosticsReading();
    expect(reading.diagnostics).toBeNull();
    expect(reading.lastCheckFailed).toBe(true);
  });

  it("answers at once when a reading already exists", async () => {
    const fetchMock = answer({ geminiReady: true });
    vi.stubGlobal("fetch", fetchMock);
    const release = subscribeDiagnostics(() => {});
    await firstDiagnosticsReading();
    const callsAfterFirstReading = fetchMock.mock.calls.length;
    const reading = await firstDiagnosticsReading();
    expect(reading.diagnostics?.geminiReady).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstReading);
    release();
  });

  it("stops waiting when the request is accepted but never answers, so a run can finish without it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})) as any);
    const pending = firstDiagnosticsReading(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ diagnostics: null, lastCheckFailed: false });
  });
});

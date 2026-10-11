// @vitest-environment jsdom
/**
 * SpliceWindowControl.test.tsx — the inline SpliceAI window: what it sends, what it saves, what it
 * refuses to do (replace a score with a failure).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSetting = vi.fn();
const fetchWithAuth = vi.fn();
const setAnalysisState = vi.fn();
vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => ({ settings: { alphagenomeApiKey: "", spliceaiWindow: 500 }, updateSetting, openSettingsTab: vi.fn() }),
}));
vi.mock("../../apiClient", () => ({ useApiClient: () => ({ fetchWithAuth }) }));
vi.mock("../../stores/useVariantAnalysisStore", () => ({
  useVariantAnalysisStore: Object.assign((sel: any) => sel({ analysisState: { isLoading: false } }), {
    getState: () => ({ setAnalysisState }),
  }),
}));

import { SpliceWindowControl, mergeSpliceAiRescore } from "../evidence/splicing/SpliceWindowControl";
import { buildSplicingEvidence } from "../../shared/splicingEvidence";
import { spliceAiScoreRequestSchema } from "../../shared/contracts";
import { nae1Reference } from "../../shared/__tests__/fixtures/splicingReference";

const scored = (distanceBp: number) =>
  nae1Reference({
    conservationData: {
      spliceai: { ds_ag: 0, ds_al: 0.3, ds_dg: 0, ds_dl: 0, max_ds: 0.3, dp: { ds_al: -12 }, provenance: { source: "broad-lookup", distanceBp, masked: 1, computedLive: true } },
    },
  });
const renderControl = (result: any) =>
  render(<SpliceWindowControl result={result} ev={buildSplicingEvidence({ result })} />);
const reply = (body: any) => ({ ok: true, json: async () => body }) as unknown as Response;
const liveScore = (distanceBp: number) => ({
  ds_ag: 0, ds_al: 0.5, ds_dg: 0, ds_dl: 0, max_ds: 0.5, dp: { ds_ag: 0, ds_al: -12, ds_dg: 0, ds_dl: 0 },
  provenance: { source: "broad-lookup", distanceBp, masked: 1, computedLive: true, annotationSet: "MANE Select" },
});

beforeEach(() => {
  updateSetting.mockReset();
  fetchWithAuth.mockReset();
  setAnalysisState.mockReset();
});

describe("SpliceWindowControl", () => {
  it("selects the window the score was actually computed under, not just the saved default", () => {
    renderControl(scored(200));
    expect(screen.getByRole("radio", { name: "±200" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "±500" }).getAttribute("aria-checked")).toBe("false");
  });

  it("re-scores just this variant, saves the window as the default, and folds the score in", async () => {
    const result = scored(500);
    fetchWithAuth.mockResolvedValue(reply({ distance: 1000, spliceai: liveScore(1000), spliceaiFailure: null, attempted: true }));
    renderControl(result);
    fireEvent.click(screen.getByRole("radio", { name: "±1000" }));
    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith("spliceaiWindow", 1000));
    const [url, init] = fetchWithAuth.mock.calls[0];
    expect(url).toBe("/api/v1/spliceai/score");
    expect(JSON.parse(init.body)).toEqual({ coordinates: "16-66823281-A-G", assembly: "GRCh38", distance: 1000 });
    // What was sent is exactly what the route will accept: one schema, shared.
    expect(spliceAiScoreRequestSchema.safeParse(JSON.parse(init.body)).success).toBe(true);
    // The store update is a function of the previous state: apply it to see what lands.
    const next = setAnalysisState.mock.calls[0][0]({ result });
    expect(next.result.conservationData.spliceai.provenance.distanceBp).toBe(1000);
    // And the tab reads the merged payload as a ±1000 score: the control now selects ±1000 from it.
    const merged = { ...result, conservationData: next.result.conservationData };
    expect(buildSplicingEvidence({ result: merged }).spliceai.provenance?.distanceBp).toBe(1000);
  });

  it("keeps the score on screen, and says why, when the re-score fails", async () => {
    fetchWithAuth.mockResolvedValue(reply({ distance: 2000, spliceai: null, spliceaiFailure: { kind: "rate-limited", httpStatus: 429, detail: null }, attempted: true }));
    renderControl(scored(500));
    fireEvent.click(screen.getByRole("radio", { name: "±2000" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Kept ±500 bp.*limits interactive use/));
    expect(updateSetting).not.toHaveBeenCalled();
    expect(setAnalysisState).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "±500" }).getAttribute("aria-checked")).toBe("true");
  });

  it("is one tab stop, and arrows move focus without choosing (choosing is a request)", () => {
    renderControl(scored(500));
    const radios = screen.getAllByRole("radio") as HTMLButtonElement[];
    expect(radios.filter(r => r.tabIndex === 0).map(r => r.textContent)).toEqual(["±500"]);
    radios[2].focus();
    fireEvent.keyDown(radios[2], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[3]);
    fireEvent.keyDown(radios[3], { key: "End" });
    expect(document.activeElement).toBe(radios[4]);
    fireEvent.keyDown(radios[4], { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[0]); // wraps
    fireEvent.keyDown(radios[0], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(radios[4]);
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
  });

  it("does nothing without a genomic coordinate to re-score", () => {
    renderControl(nae1Reference({ metadata: { genomicCoordinates: null } }));
    expect((screen.getByRole("radio", { name: "±1000" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/No genomic coordinate/);
  });
});

describe("mergeSpliceAiRescore", () => {
  const old: any = { spliceai: { max_ds: 0.3 }, spliceaiFailure: null };
  it("replaces the score and clears a failure", () => {
    const next = mergeSpliceAiRescore({ ...old, spliceaiFailure: { kind: "timeout", httpStatus: null, detail: null } }, { distance: 50, spliceai: { max_ds: 0.9 } as any, spliceaiFailure: null, attempted: true });
    expect((next.spliceai as any).max_ds).toBe(0.9);
    expect(next.spliceaiFailure).toBeNull();
  });
  it("keeps the old score and records the reason when there is no new one", () => {
    const next = mergeSpliceAiRescore(old, { distance: 50, spliceai: null, spliceaiFailure: { kind: "timeout", httpStatus: null, detail: null }, attempted: true });
    expect((next.spliceai as any).max_ds).toBe(0.3);
    expect(next.spliceaiFailure?.kind).toBe("timeout");
  });
});

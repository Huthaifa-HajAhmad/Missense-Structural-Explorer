// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchProgressiveStructuralAssessments } from "../biophysicalService";
import { fetchBindingPocket } from "../structureService";
import { generateClinicalNarrative } from "../narrativeService";
import { resetNarrativeActivity, resetNarrativeFlights } from "../../../shared/narrativeResynthesis";

/** A run that has been replaced must not touch activity state; the run that replaced it owns that now. */
const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const params = { gene: "G", variant: "p.Ala1Val", uniprotId: "U" };

describe("a replaced run", () => {
  beforeEach(() => {
    resetNarrativeActivity();
    resetNarrativeFlights();
  });

  it("does not lower the structural flag the new run raised", async () => {
    let flag = false;
    const setFlag = (value: boolean) => { flag = value; };
    let active = 1;
    let failOld!: (e: unknown) => void;
    const oldApi = { getStructuralAssessments: () => new Promise((_ok, fail) => { failOld = fail; }) };
    const newApi = { getStructuralAssessments: () => new Promise(() => {}) };
    const oldController = new AbortController();
    const inert = () => {};
    const oldRun = fetchProgressiveStructuralAssessments(params, oldApi, oldController.signal, inert, 1, () => active, undefined, setFlag);
    oldController.abort();
    active = 2;
    void fetchProgressiveStructuralAssessments(params, newApi, new AbortController().signal, inert, 2, () => active, undefined, setFlag);
    failOld(abortError());
    await oldRun;
    expect(flag).toBe(true);
  });

  it("does not lower the pocket flag the new run raised", async () => {
    let flag = false;
    const controller = new AbortController();
    let failOld!: (e: unknown) => void;
    const sink = { setIsPocketLoading: (value: boolean) => { flag = value; }, setPocketError() {}, setComputedPocket() {} };
    const oldRun = fetchBindingPocket("U", 5, "ATOM", { detectPocket: () => new Promise((_ok, fail) => { failOld = fail; }) }, sink, controller.signal);
    controller.abort();
    flag = true;
    failOld(abortError());
    await oldRun;
    expect(flag).toBe(true);
  });

  it("does not clear the loading step of the run that replaced it", async () => {
    let active = 1;
    const setLoadingStep = vi.fn();
    let answer!: (value: unknown) => void;
    const apiClient = { getNarrative: () => new Promise(resolve => { answer = resolve; }) };
    const pending = generateClinicalNarrative(
      { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", settings: { acmgWeighting: {} }, bpResult: {} } as any,
      apiClient,
      { addToHistory: vi.fn(), setSelectedResidueIndex: vi.fn() },
      { setAnalysisState: vi.fn(), setLoadingStep, setIsBiophysicalLoading: vi.fn(), setIsStructuralLoading: vi.fn(), setIsClinicalLoading: vi.fn(), setIsNarrativeLoading: vi.fn() } as any,
      new AbortController().signal,
      1,
      () => active
    );
    await vi.waitFor(() => expect(answer).toBeDefined());
    active = 2;
    setLoadingStep.mockClear();
    answer({ analysis: "text", insights: {} });
    await pending;
    expect(setLoadingStep).not.toHaveBeenCalledWith("");
  });
});

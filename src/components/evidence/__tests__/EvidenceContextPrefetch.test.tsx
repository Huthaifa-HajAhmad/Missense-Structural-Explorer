// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EvidenceContextPrefetch } from "../EvidenceContextPrefetch";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
const { fetchWithAuth } = vi.hoisted(() => ({ fetchWithAuth: vi.fn(() => new Promise(() => {})) }));
vi.mock("../../../apiClient", () => ({ useApiClient: () => ({ fetchWithAuth }) }));
vi.mock("../../../stores/useVariantAnalysisStore", async () => {
  const { create } = await import("zustand");
  const { createEvidenceContextSlice } = await import("../../../stores/slices/evidenceContextSlice");
  return { useVariantAnalysisStore: create((set: any, get: any, api: any) => ({ ...createEvidenceContextSlice(set, get, api), gene: "", variant: "" })) };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("warms human and model context without opening a tab and deduplicates remounts", () => {
  vi.useFakeTimers();
  useVariantAnalysisStore.setState({ diseaseContexts: {}, dosageContexts: {}, expressionContexts: {}, developmentalContexts: {}, modelContexts: {}, extraContexts: {}, phenotypeSelections: {} });
  const result = { metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" } } as any;
  const first = render(<EvidenceContextPrefetch result={result} />);
  expect(fetchWithAuth).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1200));
  const urls = fetchWithAuth.mock.calls.map((call: any) => call[0]);
  expect(urls).toEqual(expect.arrayContaining([
    "/api/v1/evidence-context/PAH", "/api/v1/evidence-context/PAH/expression",
    "/api/v1/evidence-context/PAH/models", "/api/v1/evidence-context/PAH/dosage"
  ]));
  const count = urls.length;
  first.unmount();
  render(<EvidenceContextPrefetch result={result} />);
  act(() => vi.advanceTimersByTime(1200));
  expect(fetchWithAuth).toHaveBeenCalledTimes(count);
});

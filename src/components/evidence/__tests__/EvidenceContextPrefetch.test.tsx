// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
beforeEach(() => {
  fetchWithAuth.mockClear();
  useVariantAnalysisStore.setState({ diseaseContexts: {}, dosageContexts: {}, expressionContexts: {}, developmentalContexts: {}, modelContexts: {}, extraContexts: {}, phenotypeSelections: {} });
});
it("starts gene evidence before core results and reuses those requests when the first chunk arrives", () => {
  const view = render(<EvidenceContextPrefetch result={null} />);
  expect(fetchWithAuth).not.toHaveBeenCalled();
  view.rerender(<EvidenceContextPrefetch result={null} pendingGene="UROD" pendingVariant="p.Gly318Arg" />);
  const urls = fetchWithAuth.mock.calls.map((call: any) => call[0]);
  expect(urls).toEqual(expect.arrayContaining([
    "/api/v1/evidence-context/UROD", "/api/v1/evidence-context/UROD/dosage",
    "/api/v1/evidence-context/UROD/models", "/api/v1/evidence-context/UROD/alignment",
    "/api/v1/evidence-context/UROD/phenotypes"
  ]));
  view.rerender(<EvidenceContextPrefetch result={{ metadata: { gene: "UROD", variant: "p.Gly318Arg", uniprotId: "P06132" } } as any} />);
  expect(fetchWithAuth).toHaveBeenCalledTimes(urls.length);
});

it("warms human and model context without opening a tab and deduplicates remounts", () => {
  useVariantAnalysisStore.setState({ diseaseContexts: {}, dosageContexts: {}, expressionContexts: {}, developmentalContexts: {}, modelContexts: {}, extraContexts: {}, phenotypeSelections: {} });
  const result = { metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439" } } as any;
  const first = render(<EvidenceContextPrefetch result={result} />);
  const urls = fetchWithAuth.mock.calls.map((call: any) => call[0]);
  expect(urls).toEqual(expect.arrayContaining([
    "/api/v1/evidence-context/PAH", "/api/v1/evidence-context/PAH/expression",
    "/api/v1/evidence-context/PAH/models", "/api/v1/evidence-context/PAH/dosage",
    "/api/v1/evidence-context/PAH/alignment"
  ]));
  const count = urls.length;
  first.unmount();
  render(<EvidenceContextPrefetch result={result} />);
  expect(fetchWithAuth).toHaveBeenCalledTimes(count);
});

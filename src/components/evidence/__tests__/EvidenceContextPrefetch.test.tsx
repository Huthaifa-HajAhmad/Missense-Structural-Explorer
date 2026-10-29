// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvidenceContextPrefetch } from "../EvidenceContextPrefetch";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../../shared/evidenceKeys";
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
  // Gene reads are reused; the one new read is hot spots, which needs the protein the result names.
  expect(fetchWithAuth.mock.calls.slice(urls.length).map((call: any) => call[0])).toEqual(["/api/v1/evidence-context/UROD/hotspots?uniprot=P06132"]);
});

it("keys the hot-spot read by transcript, so the writer and every reader share one slot", () => {
  const result = { metadata: { gene: "SOD1", variant: "p.Ala5Val", uniprotId: "P00441" }, transcriptId: "ENST00000270142" } as any;
  render(<EvidenceContextPrefetch result={result} />);
  const url = fetchWithAuth.mock.calls.map((call: any) => call[0]).find((u: string) => u.includes("/hotspots"));
  expect(url).toBe("/api/v1/evidence-context/SOD1/hotspots?uniprot=P00441&transcript=ENST00000270142");
  expect(hotspotsSlot("SOD1", "P00441", "ENST00000270142")).toBe("hotspots:SOD1?uniprot=P00441&transcript=ENST00000270142");
});

it("warms the hot-spot read for a result with no UniProt accession too (the server answers its model-free rungs)", () => {
  render(<EvidenceContextPrefetch result={{ metadata: { gene: "ORPHAN", variant: "p.Ala1Val" } } as any} />);
  expect(fetchWithAuth.mock.calls.map((call: any) => call[0])).toContain("/api/v1/evidence-context/ORPHAN/hotspots");
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

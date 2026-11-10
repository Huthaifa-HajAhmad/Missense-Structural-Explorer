// @vitest-environment jsdom
/**
 * FunctionRail — the inspector's Hot-spot definitions trace.
 *
 * It renders the same six definitions as the view, from the same store slot, and it must report a
 * loading or failed read rather than showing nothing beside the view's own state card.
 */
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FunctionRail } from "../FunctionRail";
import { FunctionTab } from "../../evidence/FunctionInteractionsTabs";
import { EvidenceWorkspaceProvider } from "../../evidence/EvidenceWorkspace";
import type { TabComponentProps } from "../../evidence/types";
import type { AnalysisResult } from "../../../types";
import { SOD1_UNIPROT } from "../../../shared/__tests__/fixtures/sod1FunctionalDomains";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../../shared/evidenceKeys";
import { buildHotspotEvidence, hotspotContextSchema } from "../../../shared/hotspotEvidence";
import { hotspotReadings } from "../../../shared/molecularWorkspace";
import sod1Hotspots from "../../../shared/__tests__/fixtures/hotspotsSod1.json";

const slot = hotspotsSlot("SOD1", "P00441", null);
const sod1 = () => ({
  metadata: { gene: "SOD1", variant: "p.Ala5Val", residueIndex: 5, wildType: "A", mutant: "V", uniprotId: "P00441" },
  uniprotFeatures: SOD1_UNIPROT,
  serviceStatus: { uniprotFeatures: "ok" },
  ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }] },
}) as unknown as AnalysisResult;

beforeEach(() => useVariantAnalysisStore.setState({ extraContexts: { [slot]: { status: "ready", data: hotspotContextSchema.parse(sod1Hotspots) } } }));
afterEach(() => {
  cleanup();
  useVariantAnalysisStore.setState({ extraContexts: {} });
  window.history.replaceState(null, "", "/");
});

it("traces the six definitions with their grades, from the same slot the view reads", () => {
  render(<FunctionRail analysisResult={sod1()} />);
  const rail = screen.getByTestId("function-rail-hotspots");
  expect(rail.textContent).toMatch(/Hot-spot definitions/);
  expect(rail.textContent).toMatch(/Expert specification/);
  expect(rail.textContent).toMatch(/Calibrated \(preprint\)/);
  expect(rail.textContent).toMatch(/Published method, not validated here/);
  expect(rail.textContent).toMatch(/Published method, benchmarked here/);
});

it("reports a failed read instead of rendering an empty section", () => {
  useVariantAnalysisStore.setState({ extraContexts: { [slot]: { status: "error", data: null, error: "The sources timed out." } } });
  render(<FunctionRail analysisResult={sod1()} />);
  expect(screen.getByTestId("function-rail-hotspots").textContent).toMatch(/did not answer: The sources timed out\./);
});

it("opens Hotspots from the disease-variant caveat, pins into the inspector, and never leaks hotspot pins into the Protein map annotation bar or ?fsel=", () => {
  const result = sod1();
  const props = {
    analysisState: { isLoading: false, error: null, result },
    energyUnit: "kcal/mol",
    formatDdGValue: () => "",
    setSelectedMetric: () => {},
    isDark: false,
  } as unknown as TabComponentProps;
  render(
    <EvidenceWorkspaceProvider result={result}>
      <FunctionTab {...props} />
      <FunctionRail analysisResult={result} />
    </EvidenceWorkspaceProvider>
  );
  // Click "Open Hotspots" directly from the disease-variant caveat on the Protein map view.
  fireEvent.click(within(screen.getByTestId("function-caveats")).getByRole("button", { name: "Open Hotspots" }));
  expect(screen.getByTestId("hotspots-view")).toBeTruthy();

  // Pin a ClinVar P/LP residue from the Hotspots table and verify it populates EvidenceReadingInspector.
  const ala5Row = screen.getAllByTestId("hotspot-row").find((r) => r.getAttribute("data-row-key") === "hs:5")!;
  fireEvent.click(within(ala5Row).getByRole("button", { name: "Ala5" }));
  const inspector = screen.getByLabelText("Selected evidence reading");
  expect(inspector.textContent).toMatch(/Ala5 · ClinVar P\/LP/);
  expect(inspector.textContent).toMatch(/p\.Ala5Val/);
  expect(inspector.textContent).toMatch(/ClinVar germline classifications via the gnomAD browser API/);
  expect(window.location.search).not.toContain("fsel=hs");

  // Switch back to Protein map while hs:5 is pinned: the annotation bar must NOT claim a dangling annotation pin.
  fireEvent.click(screen.getByRole("tab", { name: /Protein map/i }));
  expect(screen.queryByText(/The pinned annotation is no longer available/)).toBeNull();
  expect(screen.queryByRole("button", { name: /View selected record/i })).toBeNull();
  expect(window.location.search).not.toContain("fsel=hs");

  // Switch back to Hotspots and pin a definition rung.
  fireEvent.click(screen.getByRole("tab", { name: /Hotspots/i }));
  fireEvent.click(screen.getByRole("button", { name: "Regional missense O/E" }));
  expect(inspector.textContent).toMatch(/Regional missense O\/E/);
  expect(inspector.textContent).toMatch(/Calibrated \(preprint\)/);
  expect(window.location.search).not.toContain("fsel=rung");
});

it("splits Method vs Data on app-computed rungs and reports Source, Model, scale glosses, and Not on the model on ClinVar P/LP rows", () => {
  const ctx = hotspotContextSchema.parse(sod1Hotspots);
  // Add a residue beyond the trace so distanceA is null while the model is present.
  const trace = ctx.spatial.trace!;
  const idx154 = trace.residues.indexOf(154);
  const withUnmodeled = {
    ...ctx,
    distribution: {
      ...ctx.distribution,
      plp: [...ctx.distribution.plp.filter((p) => p.pos !== 154), { pos: 154, n: 1, maxStars: 2, changes: ["p.Gln154Arg"] }],
    },
    spatial: {
      ...ctx.spatial,
      trace: {
        residues: trace.residues.filter((_, i) => i !== idx154),
        coords: trace.coords.filter((_, i) => Math.floor(i / 3) !== idx154),
        plddt: trace.plddt.filter((_, i) => i !== idx154),
      },
    },
  };
  const ev = buildHotspotEvidence({ context: withUnmodeled, loadState: "ready", residue: 5, residueLabel: "Ala5" });
  const readings = hotspotReadings(ev);

  const perRerun = readings.find((r) => r.key === "rung:per-rerun")!;
  expect(perRerun.facts).toContainEqual({ label: "Method", value: "Pérez-Palma et al. 2020, Genome Res 30:62" });
  expect(perRerun.facts).toContainEqual({ label: "Data", value: "ClinVar and gnomAD v4 in this entry" });

  const spatial = readings.find((r) => r.key === "rung:spatial")!;
  expect(spatial.facts).toContainEqual({ label: "Method", value: "Sivley et al. 2018, Am J Hum Genet 102:415" });
  expect(spatial.facts).toContainEqual({ label: "Data", value: "ClinVar, gnomAD v4 and AlphaFold DB in this entry" });

  const hs5 = readings.find((r) => r.key === "hs:5")!;
  expect(hs5.facts).toContainEqual({ label: "Source", value: "ClinVar germline classifications via the gnomAD browser API (GRCh38)" });
  expect(hs5.facts.find((f) => f.label === "Model")?.value).toMatch(/^AF-P00441-F1/);
  expect(hs5.facts.find((f) => f.label === "ClinVar P/LP")?.value).toMatch(/of 4 review stars$/);
  expect(hs5.facts.find((f) => f.label === "pLDDT")?.value).toMatch(/\/ 100$/);

  const hs154 = readings.find((r) => r.key === "hs:154")!;
  expect(hs154.facts.find((f) => f.label === "3D Cα–Cα distance")?.value).toBe("Not on the model");
});

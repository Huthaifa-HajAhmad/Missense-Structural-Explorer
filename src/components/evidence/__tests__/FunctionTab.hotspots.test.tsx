// @vitest-environment jsdom
/**
 * FunctionTab — the Hotspots view is wired to the prefetched slot and to the viewer.
 *
 * The view itself is covered by HotspotsView.test.tsx with a hand-built model; this file proves the two
 * things that test cannot: that the tab reads the same store slot the loader writes, and that "Show all
 * in 3D" hands the whole P/LP set (not only the queried residue) to the canvas.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FunctionTab } from "../FunctionInteractionsTabs";
import type { TabComponentProps } from "../types";
import type { AnalysisResult } from "../../../types";
import { SOD1_UNIPROT } from "../../../shared/__tests__/fixtures/sod1FunctionalDomains";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../../shared/evidenceKeys";
import { hotspotContextSchema } from "../../../shared/hotspotEvidence";
import sod1Hotspots from "../../../shared/__tests__/fixtures/hotspotsSod1.json";

const sod1 = () => ({
  metadata: { gene: "SOD1", variant: "p.Ala5Val", residueIndex: 5, wildType: "A", mutant: "V", uniprotId: "P00441" },
  uniprotFeatures: SOD1_UNIPROT,
  serviceStatus: { uniprotFeatures: "ok" },
  ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }] },
}) as unknown as AnalysisResult;

const props = (result: AnalysisResult) => ({
  analysisState: { isLoading: false, error: null, result },
  energyUnit: "kcal/mol", formatDdGValue: () => "", setSelectedMetric: () => {},
  isDark: false, classCard: "", classCardHeader: "", classCardTitle: "", classBorderSec: "",
  classTextBody: "", classTextMute: "", foldingDdG: null, foldingStatus: null,
}) as unknown as TabComponentProps;

beforeEach(() => {
  useVariantAnalysisStore.setState({ extraContexts: { [hotspotsSlot("SOD1", "P00441", null)]: { status: "ready", data: hotspotContextSchema.parse(sod1Hotspots) } } });
});
afterEach(() => {
  useVariantAnalysisStore.setState({ extraContexts: {} });
  window.history.replaceState(null, "", "/");
});

it("renders the view from the slot the loader writes, with all six definitions", () => {
  render(<FunctionTab {...props(sod1())} />);
  expect(screen.getByTestId("hotspots-view")).toBeTruthy();
  for (const key of ["cspec", "regional", "per-published", "per-rerun", "spatial", "distribution"]) {
    expect(screen.getByTestId(`hotspot-rung-${key}`)).toBeTruthy();
  }
});

it("hands the whole P/LP set to the viewer, and the count it reports is the set it draws", () => {
  const onSelectResidue = vi.fn();
  render(<FunctionTab {...props(sod1())} onSelectResidue={onSelectResidue} onNavigateToView={vi.fn()} />);
  fireEvent.click(screen.getByTestId("hotspots-show-all-3d"));
  expect(onSelectResidue).toHaveBeenCalledTimes(1);
  const [index, focus] = onSelectResidue.mock.calls[0];
  expect(index).toBe(5);
  // residueFocus drops the queried residue itself; the label must name what is actually drawn.
  expect(focus.companions.length).toBe(sod1Hotspots.distribution.plp.length - 1);
  expect(focus.label).toContain(`(${focus.companions.length})`);
});

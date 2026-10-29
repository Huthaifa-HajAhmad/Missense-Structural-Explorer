// @vitest-environment jsdom
/**
 * FunctionRail — the inspector's Hot-spot definitions trace.
 *
 * It renders the same six definitions as the view, from the same store slot, and it must report a
 * loading or failed read rather than showing nothing beside the view's own state card.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FunctionRail } from "../FunctionRail";
import type { AnalysisResult } from "../../../types";
import { SOD1_UNIPROT } from "../../../shared/__tests__/fixtures/sod1FunctionalDomains";
import { useVariantAnalysisStore } from "../../../stores/useVariantAnalysisStore";
import { hotspotsSlot } from "../../../shared/evidenceKeys";
import { hotspotContextSchema } from "../../../shared/hotspotEvidence";
import sod1Hotspots from "../../../shared/__tests__/fixtures/hotspotsSod1.json";

const slot = hotspotsSlot("SOD1", "P00441", null);
const sod1 = () => ({
  metadata: { gene: "SOD1", variant: "p.Ala5Val", residueIndex: 5, wildType: "A", mutant: "V", uniprotId: "P00441" },
  uniprotFeatures: SOD1_UNIPROT,
  serviceStatus: { uniprotFeatures: "ok" },
  ruleBasedInsights: { acmgCriteria: [{ code: "PM2" }] },
}) as unknown as AnalysisResult;

beforeEach(() => useVariantAnalysisStore.setState({ extraContexts: { [slot]: { status: "ready", data: hotspotContextSchema.parse(sod1Hotspots) } } }));
afterEach(() => useVariantAnalysisStore.setState({ extraContexts: {} }));

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

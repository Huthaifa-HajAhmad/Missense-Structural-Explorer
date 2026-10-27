// @vitest-environment jsdom
/**
 * EvidenceRailRouting.test.tsx — one registry names every Evidence tab, and one map routes its rail.
 *
 * Before: the tab list lived in five hand-kept copies (titles had drifted: "Predictors" vs
 * "In-silico predictors", "Residue shifts and pockets" vs "& pockets"), and rail routing was split
 * between ViewInspector and EvidenceInspector with an unreachable placeholder fallback.
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../SplicingRail", () => ({ default: () => <div data-testid="rail-splicing" /> }));
vi.mock("../ResidueShiftInspector", () => ({ default: () => <div data-testid="rail-structure" /> }));
vi.mock("../PerturbationRail", () => ({ default: () => <div data-testid="rail-perturbation" /> }));
vi.mock("../PopulationRail", () => ({ PopulationRail: () => <div data-testid="rail-clinical" /> }));

import { EvidenceInspector } from "../EvidenceInspector";
import { EVIDENCE_TABS, findEvidenceTab, isEvidenceTabId } from "../../../shared/evidenceTabs";
import { EVIDENCE_SUB_ITEMS } from "../../MasterSidebar";
import { EVIDENCE_GUIDES, RESEARCH_GUIDES } from "../../../shared/researchGuides";
import { emptyWorkspace } from "../../ui/AnalysisEmptyState";

describe("Evidence tab registry", () => {
  it("is the sidebar's list, in order, with the same labels", () => {
    expect(EVIDENCE_SUB_ITEMS).toEqual(EVIDENCE_TABS.map(({ id, label }) => ({ id, label })));
  });

  it("gives every tab a research guide that exists, a subtitle and a detail view", () => {
    for (const tab of EVIDENCE_TABS) {
      expect(RESEARCH_GUIDES[EVIDENCE_GUIDES[tab.id]], tab.id).toBeDefined();
      expect(tab.subtitle.length).toBeGreaterThan(0);
      expect(tab.detailView.length).toBeGreaterThan(0);
    }
  });

  it("titles the empty workspace with the registry label", () => {
    for (const tab of EVIDENCE_TABS) expect(emptyWorkspace("evidence", tab.id)?.title).toBe(tab.label);
  });

  it("recognises only registered ids", () => {
    expect(isEvidenceTabId("species-models")).toBe(true);
    expect(isEvidenceTabId("thresholds")).toBe(false);
    expect(findEvidenceTab("CLINICAL")?.id).toBe("clinical");
  });
});

describe("EvidenceInspector routes every tab, including the three ViewInspector used to route", () => {
  const result: any = { metadata: { gene: "UROD", variant: "p.Gly318Arg" } };
  it.each([["splicing"], ["structure"], ["perturbation"]])("renders the %s rail", tab => {
    const { getByTestId, container } = render(<EvidenceInspector analysisResult={result} activeEvidenceTab={tab} />);
    expect(getByTestId(`rail-${tab}`)).toBeTruthy();
    expect(container.textContent).not.toMatch(/placeholder/);
  });

  it("falls back to the Population rail for an unknown id, as the tab body does", () => {
    const { getByTestId } = render(<EvidenceInspector analysisResult={result} activeEvidenceTab="no-such-tab" />);
    expect(getByTestId("rail-clinical")).toBeTruthy();
  });
});

// @vitest-environment jsdom
/**
 * Without a chosen disease there is nothing to overlap with, so the "Disease overlap only" switch must not
 * be offered at all. The caption above it already says to choose a disease first.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceWorkspaceProvider } from "../EvidenceWorkspace";
import { SpeciesRecordFilter } from "../species/SpeciesRecordFilter";

function renderFilter(overlapAvailable: boolean) {
  return render(
    <EvidenceWorkspaceProvider result={{ metadata: { gene: "TP53", variant: "p.Arg175His" } } as any}>
      <SpeciesRecordFilter shown={3} total={3} noun="resolved phenotype records" placeholder="Search" overlap={{ available: overlapAvailable }} />
    </EvidenceWorkspaceProvider>,
  );
}

describe("Species record filter — the overlap switch is offered only when it can work", () => {
  it("hides 'Disease overlap only' when no disease terms can be compared", () => {
    renderFilter(false);
    expect(screen.queryByText("Disease overlap only")).toBeNull();
  });

  it("offers 'Disease overlap only' once a disease can be compared", () => {
    renderFilter(true);
    expect(screen.getByLabelText(/Disease overlap only/)).toBeTruthy();
  });
});

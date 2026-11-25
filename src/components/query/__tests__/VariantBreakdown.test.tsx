// @vitest-environment jsdom
import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VariantBreakdown } from "../VariantBreakdown";
import type { AnalysisResult } from "../../../types";

const sparse = {
  metadata: { gene: "PAH", variant: "p.Arg408Trp", uniprotId: "P00439", residueIndex: 408 },
} as unknown as AnalysisResult;

describe("VariantBreakdown, cells a finished run left empty", () => {
  it("states the count once in the header and marks each empty cell with a quiet dash", () => {
    render(<VariantBreakdown typed={{ gene: "PAH", change: "p.Arg408Trp", uniprot: "" }} result={sparse} settled />);
    const breakdown = screen.getByTestId("variant-breakdown");
    const header = within(breakdown).getByRole("banner");
    expect(header).toHaveTextContent("4 not reported");

    const build = within(breakdown).getByText("Build").closest("div")!;
    expect(within(build).getByText("—")).toHaveAttribute("aria-hidden", "true");
    // Screen readers still hear what the dash means.
    expect(within(build).getByText("Not reported")).toHaveClass("sr-only");
  });
});

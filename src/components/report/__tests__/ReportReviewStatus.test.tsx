// @vitest-environment jsdom
/**
 * The review status says whether the Report is ready to hand on. It must not say "Ready to export"
 * while an evidence area is still running or was never assessed.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportReviewStatus } from "../rail/ReportReviewStatus";
import { blankBlock } from "../../../shared/reportModel";

const blocks = [blankBlock("identity"), blankBlock("population")];

describe("ReportReviewStatus", () => {
  it("says ready when the run is complete and nothing needs review", () => {
    render(<ReportReviewStatus blocks={blocks} completeness={{ state: "complete", running: [], gaps: [] }} onJump={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Ready to export. Nothing needs review.");
  });

  it("says ready with gaps, and names the gaps, when the run finished with gaps", () => {
    render(<ReportReviewStatus blocks={blocks} completeness={{ state: "gaps", running: [], gaps: ["Population (not assessed)", "PM2 (withheld)"] }} onJump={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Ready to export — with gaps: Population (not assessed), PM2 (withheld).");
  });

  it("does not say ready while a part of the run is still running", () => {
    render(<ReportReviewStatus blocks={blocks} completeness={{ state: "running", running: ["Stability"], gaps: [] }} onJump={() => {}} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("Still running: Stability");
    expect(text).not.toContain("Ready to export");
  });
});

it("names analysis when no running lane is named", () => {
 render(<ReportReviewStatus blocks={blocks} completeness={{ state: "running", running: [], gaps: [] }} onJump={() => {}} />);
 expect(screen.getByRole("status").textContent).toContain("Still running: analysis in progress");
});

it("keeps named gaps visible even when a section is also flagged for review", () => {
 const flagged = [blankBlock("identity"), { ...blankBlock("population"), review: "summary-outdated" as const }];
 render(<ReportReviewStatus blocks={flagged} completeness={{ state: "gaps", running: [], gaps: ["Population (not assessed)", "PM2 (withheld)"] }} onJump={() => {}} />);
 const text = screen.getByRole("status").textContent ?? "";
 expect(text).toContain("Read this section before you export.");
 expect(text).toContain("Evidence gaps: Population (not assessed), PM2 (withheld).");
});

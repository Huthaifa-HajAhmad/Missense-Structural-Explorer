// @vitest-environment jsdom
/**
 * GuidelinesTab.test.tsx — Threshold Guide tab rendering contract.
 *
 * Pins the UI/UX audit invariants at the DOM level: the verdict roll-up chips,
 * verdict-tinted match badges, calibration micro-tracks, the sticky scroller
 * chrome, and the relocation of the verbose ACMG key out of the main column.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GuidelinesTab } from "../GuidelinesTab";
import type { TabComponentProps } from "../types";

/** The MACO1 p.Glu433Lys payload, matching the values visible in the guide. */
const MACO1_RESULT: any = {
  predictorData: { caddPhred: 32.0, amPathogenicity: 0.933, amClass: "pathogenic" },
  conservationData: {
    revel: 0.527, bayesdel: 0.125, metarnn: 0.836, clinpred: 0.923,
    eigenPhred: 11.7, dann: 0.999, popeve: -4.235, esm1b: -13.54,
    gerp: 6.03, phylop: 9.57
  },
  esmcEval: { llr: -8.43 },
  dynamut2: null, ddmut: null, rasp: null, thermompnn: null,
  misZ: 3.13, loeuf: null
};

const baseProps = {
  isDark: false,
  classCard: "", classCardHeader: "", classCardTitle: "",
  classBorderSec: "", classTextBody: "", classTextMute: "",
  analysisState: { result: MACO1_RESULT, isLoading: false },
  foldingDdG: -0.97,
  foldingStatus: "success" as const,
  energyUnit: "kcal/mol" as const,
  formatDdGValue: (v: number | null) => (v === null ? "N/A" : v.toFixed(2)),
  setSelectedMetric: () => {}
} as unknown as TabComponentProps;

describe("GuidelinesTab", () => {
  it("renders a live verdict roll-up that sums to the full metric count", () => {
    render(<GuidelinesTab {...baseProps} />);
    const strip = screen.getByRole("status", { name: /live threshold match summary/i });
    // 12 pathogenic-supporting, 3 groups of one (FoldX stabilizing, BayesDel
    // VUS, ESMC-6B informational), 5 awaiting data.
    expect(within(strip).getByText("12")).toBeTruthy();
    expect(within(strip).getAllByText("1")).toHaveLength(3);
    expect(within(strip).getByText("5")).toBeTruthy();
    expect(within(strip).getByText(/20 metrics/)).toBeTruthy();
  });

  it("tints the match badge by verdict, not one blue for everything", () => {
    render(<GuidelinesTab {...baseProps} />);
    expect(screen.getByText("Path. Supp.").closest(".gt-badge")?.getAttribute("data-tone")).toBe("path");
    expect(screen.getByText("Stabilizing").closest(".gt-badge")?.getAttribute("data-tone")).toBe("benign");
    expect(screen.getByText("VUS", { selector: ".gt-badge" }).getAttribute("data-tone")).toBe("vus");
    expect(screen.getByText("Informational").closest(".gt-badge")?.getAttribute("data-tone")).toBe("info");
  });

  it("draws a calibration micro-track under scored metrics and none without a scale", () => {
    const { container } = render(<GuidelinesTab {...baseProps} />);
    // 14 rows carry both a score and a band here: ESMC-6B has no calibrated
    // scale, and the unset ΔΔG engines plus LOEUF have no score to place.
    expect(container.querySelectorAll(".gt-marker")).toHaveLength(14);
    expect(container.querySelectorAll(".gt-track")).toHaveLength(14);
  });

  it("keeps the table body in a capped scroller with sticky header and category bands", () => {
    const { container } = render(<GuidelinesTab {...baseProps} />);
    expect(container.querySelector(".gt-scroller")).toBeTruthy();
    expect(container.querySelector("thead th")).toBeTruthy();
    expect(container.querySelectorAll(".gt-cat-cell")).toHaveLength(3);
  });

  it("no longer carries the verbose ACMG key; it links to the inspector instead", () => {
    render(<GuidelinesTab {...baseProps} />);
    // The old verbose legend was a list of definitions in the main column.
    expect(screen.queryByText(/Pathogenic Supporting.*Computational algorithms predict/i)).toBeNull();
    expect(screen.queryByText(/ACMG\/AMP Evidence Codes Key:/i)).toBeNull();
    // The relocation pointer is present and names the inspector.
    expect(screen.getByRole("button", { name: /ACMG\/AMP code key/i })).toBeTruthy();
  });
});

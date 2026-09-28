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
    // Against the ClinGen bands: 7 pathogenic-supporting (AM, CADD, MetaRNN, ClinPred, ESM1b,
    // phyloP, Missense Z), 1 benign/neutral (FoldX), 4 indeterminate (REVEL, BayesDel, popEVE,
    // GERP++), 3 informational (Eigen, DANN, ESMC-6B), 5 awaiting data.
    expect(within(strip).getByText("7")).toBeTruthy();
    expect(within(strip).getByText("1")).toBeTruthy();
    expect(within(strip).getByText("4")).toBeTruthy();
    expect(within(strip).getByText("3")).toBeTruthy();
    expect(within(strip).getByText("5")).toBeTruthy();
    expect(within(strip).getByText(/20 metrics/)).toBeTruthy();
  });

  it("tints the match badge by verdict, not one blue for everything", () => {
    render(<GuidelinesTab {...baseProps} />);
    expect(screen.getAllByText("PP3 Moderate")[0].closest(".gt-badge")?.getAttribute("data-tone")).toBe("path");
    expect(screen.getByText("Stabilizing").closest(".gt-badge")?.getAttribute("data-tone")).toBe("benign");
    expect(screen.getAllByText("Indeterminate", { selector: ".gt-badge" })[0].getAttribute("data-tone")).toBe("vus");
    expect(screen.getAllByText("Informational")[0].closest(".gt-badge")?.getAttribute("data-tone")).toBe("info");
  });

  it("draws a calibration micro-track under scored metrics and none without a scale", () => {
    const { container } = render(<GuidelinesTab {...baseProps} />);
    // 12 rows carry both a score and a band here: ESMC-6B, Eigen and DANN have
    // no published cut-point, and the unset ΔΔG engines plus LOEUF have no score.
    expect(container.querySelectorAll(".gt-marker")).toHaveLength(12);
    expect(container.querySelectorAll(".gt-track")).toHaveLength(12);
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

  it("renders the three-tier hero card with finding prose, verdict chip, and 4-cell fact strip", () => {
    render(<GuidelinesTab {...baseProps} />);
    const finding = screen.getByTestId("threshold-finding");
    expect(finding).toBeTruthy();

    // Verdict chip
    const verdict = screen.getByTestId("guidelines-verdict");
    expect(verdict.textContent).toBe("Pathogenic Concordance");
    expect(verdict.getAttribute("data-tone")).toBe("danger");

    // Headline figure (7–1)
    expect(within(finding).getByText("7–1")).toBeTruthy();

    // Declarative finding prose
    expect(within(finding).getByText(/Pathogenic concordance across computational and biophysical metrics/i)).toBeTruthy();

    // 4-cell fact strip
    const facts = finding.querySelectorAll(".pop-fact");
    expect(facts).toHaveLength(4);
    expect(within(finding).getByText("In-Silico & ML")).toBeTruthy();
    expect(within(finding).getByText("Biophysical ΔΔG")).toBeTruthy();
    expect(within(finding).getByText("Conservation & Z")).toBeTruthy();
    expect(within(finding).getByText("Monitored Total")).toBeTruthy();
  });
});

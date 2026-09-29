// @vitest-environment jsdom
/**
 * GuidelinesTab.test.tsx — the Score thresholds tab on NAE1 p.Asp116Gly.
 *
 * Pins what the screen may claim: the engine's own code in the head bar, one finding line, the
 * strength ladder, the calibrated reference's disagreement, a fact strip that renders as four cells,
 * and a table in which no ΔΔG or constraint row wears an ACMG code the engine did not apply.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("../../../context/SettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../context/SettingsContext")>();
  return { ...actual, useSettings: () => ({ settings: { alphagenomeApiKey: "" }, openSettingsTab: vi.fn() }) };
});

import { render, screen, within } from "@testing-library/react";
import { GuidelinesTab } from "../GuidelinesTab";
import type { TabComponentProps } from "../types";
import { NAE1_RESULT } from "../../../shared/__tests__/fixtures/nae1Thresholds";

const props = (result: any = NAE1_RESULT) =>
  ({
    isDark: false,
    classCard: "", classCardHeader: "", classCardTitle: "",
    classBorderSec: "", classTextBody: "", classTextMute: "",
    analysisState: { result, isLoading: false },
    foldingDdG: 2.62,
    foldingEnergetics: { thermompnn: -0.36 },
    foldingStatus: "success" as const,
    energyUnit: "kcal/mol" as const,
    formatDdGValue: (v: number | null) => (v === null ? "—" : v.toFixed(2)),
    setSelectedMetric: () => {},
    onTabChange: () => {},
  }) as unknown as TabComponentProps;

describe("GuidelinesTab — Score thresholds", () => {
  it("heads the finding with the engine's recorded code and one summary line", () => {
    render(<GuidelinesTab {...props()} />);
    expect(within(screen.getByTestId("threshold-engine")).getByText("PP3")).toBeTruthy();
    expect(screen.getByTestId("threshold-summary").textContent).toContain(
      "The engine applied PP3 at Supporting strength from the in-silico vote, and no other computational criterion.",
    );
    expect(document.body.textContent).not.toMatch(/concordance/i);
  });

  it("draws the strength ladder with each calibrated tool in its band", () => {
    render(<GuidelinesTab {...props()} />);
    expect(screen.getByTestId("ladder-revel").getAttribute("data-at")).toBe("BP4:Supporting");
    expect(screen.getByTestId("ladder-cadd").getAttribute("data-at")).toBe("PP3:Supporting");
    expect(screen.getByTestId("ladder-gerp").getAttribute("data-at")).toBe("none");
    expect(screen.getByTestId("ladder-esm").textContent).toMatch(/No result/);
  });

  it("says where REVEL disagrees with the vote and links to the Predictors tab", () => {
    render(<GuidelinesTab {...props()} />);
    const line = screen.getByTestId("threshold-disagreement");
    expect(line.textContent).toMatch(/REVEL, the calibrated reference, reads BP4/);
    expect(within(line).getByRole("button", { name: /Open in-silico predictors/i })).toBeTruthy();
  });

  it("renders the fact strip as four labelled cells", () => {
    render(<GuidelinesTab {...props()} />);
    const facts = screen.getByTestId("threshold-facts");
    expect(facts.querySelectorAll(".gt-fact").length).toBe(4);
    expect(within(facts).getByText("PP2 not met")).toBeTruthy();
    expect(within(facts).getByText("Not an ACMG input")).toBeTruthy();
  });

  it("gives no ΔΔG or gene-constraint row an ACMG code", () => {
    render(<GuidelinesTab {...props()} />);
    for (const key of ["foldx", "thermompnn", "dynamut2", "ddmut", "rasp", "misZ", "loeuf"]) {
      const row = screen.getByTestId(`threshold-${key}`);
      expect(row.querySelector(".chip-code")).toBeNull();
      expect(row.textContent).not.toMatch(/PM1|BP3|BP1/);
    }
    expect(screen.getByTestId("threshold-foldx").textContent).toMatch(/Destabilising/);
    expect(screen.getByTestId("threshold-foldx").textContent).toMatch(/Local mark/);
  });

  it("keeps the caveats on the tools that use allele frequency", () => {
    render(<GuidelinesTab {...props()} />);
    expect(within(screen.getByTestId("threshold-metarnn")).getByText("Uses gnomAD AF")).toBeTruthy();
    expect(within(screen.getByTestId("threshold-clinpred")).getByText("ClinVar-trained")).toBeTruthy();
  });

  it("shows the vote's code dashed when the payload carries no engine record", () => {
    const { ruleBasedInsights, ...noRecord } = NAE1_RESULT;
    render(<GuidelinesTab {...props(noRecord)} />);
    const chip = within(screen.getByTestId("threshold-finding")).getByTestId("threshold-engine");
    expect(chip.textContent).toBe("PP3");
    expect(chip.getAttribute("data-tone")).toBe("accent");
  });
});

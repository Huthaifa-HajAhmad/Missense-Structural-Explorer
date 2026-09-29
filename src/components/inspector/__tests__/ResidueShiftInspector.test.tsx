// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResidueShiftInspector } from "../ResidueShiftInspector";
import { NAE1_POCKET, NAE1_RESULT } from "../../../shared/__tests__/fixtures/nae1ResidueShifts";

/**
 * The Residue Shifts rail is a trace of how the tab's readings were reached, built from the
 * same model as the tab. These tests pin what it may claim on the reference variant.
 */
describe("ResidueShiftInspector", () => {
  it("waits rather than rendering half a pane when there is no analysis", () => {
    render(<ResidueShiftInspector analysisResult={null} />);
    expect(screen.getByText(/Waiting for the variant analysis/)).toBeInTheDocument();
  });

  it("traces pair, scales, burial, pocket and engine record", () => {
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} computedPocket={NAE1_POCKET} />);
    const trace = screen.getByTestId("residue-trace");
    const steps = within(trace).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps[0]).toHaveTextContent("Asp → Gly at 116");
    expect(steps[0]).toHaveTextContent("Grantham distance 94, moderately conservative");
    expect(steps[1]).toHaveTextContent("Largest shift: net charge");
    // Accessibility never ran, so burial is not a finding, and the stored packing word is named.
    expect(steps[2]).toHaveAttribute("data-state", "warn");
    expect(steps[2]).toHaveTextContent("Not measured");
    expect(steps[2]).toHaveTextContent(/earlier engine estimated from packing/);
    // One distance, to the cavity centre (the tab used to print 22.97 Å to the centroid).
    expect(steps[3]).toHaveTextContent("23.1 Å from the cavity centre: distal");
    expect(steps[3]).toHaveTextContent("alphafold profile");
    expect(steps[4]).toHaveTextContent("No ACMG criterion reads this tab");
  });

  it("lists every cut-point as the app's own and marks this variant's band", () => {
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} computedPocket={NAE1_POCKET} />);
    const cuts = screen.getByTestId("residue-cuts");
    expect(within(cuts).getByText(/None of these is a published classification/)).toBeInTheDocument();
    const active = cuts.querySelectorAll("[data-active]");
    expect([...active].map(el => el.textContent)).toEqual([
      "> 29 largelargest shift",
      "> 12 Å distalthis variant"
    ]);
  });

  it("labels the narrative as model-written and checks it against the scales", () => {
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} />);
    expect(screen.getByTestId("residue-narrative")).toHaveTextContent(/Charge and polarity loss/);
    expect(screen.getByText(/Written by a language model/)).toBeInTheDocument();
    expect(screen.getByText(/no disagreement/)).toBeInTheDocument();
  });

  it("flags an axis the narrative claims moved while the scales hold it flat", () => {
    // Ala → Val carries no charge on either side; a narrative about a charge swap is wrong.
    render(
      <ResidueShiftInspector
        analysisResult={{
          metadata: { gene: "X", variant: "p.Ala10Val", wildType: "Ala", mutant: "Val", residueIndex: 10 },
          insights: { biochemicalShift: "Charge swap: the side chain becomes positively charged." }
        } as any}
      />
    );
    expect(screen.getByText(/describes a change in net charge, but the scales hold that axis flat/)).toBeInTheDocument();
  });

  it("explains why synthesis failed and offers a retry only when it can help", () => {
    const onRetryNarrative = vi.fn();
    const failed = {
      ...NAE1_RESULT,
      insights: { biochemicalShift: "Not synthesized" },
      fallbackReason: "PROVIDER_OVERLOADED",
      providerDetail: "This model is currently experiencing high demand.",
      attemptedModels: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
      fallbackRetryable: true
    };
    const { unmount } = render(<ResidueShiftInspector analysisResult={failed as any} onRetryNarrative={onRetryNarrative} />);
    expect(screen.getByText("AI service busy")).toBeInTheDocument();
    expect(screen.queryByText(/Not synthesized/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Write the narrative again/ }));
    expect(onRetryNarrative).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <ResidueShiftInspector
        analysisResult={{ ...failed, fallbackReason: "API_KEY_INVALID", fallbackRetryable: false } as any}
        onRetryNarrative={onRetryNarrative}
      />
    );
    expect(screen.queryByRole("button", { name: /Write the narrative again/ })).not.toBeInTheDocument();
  });

  it("says the narrative is running while synthesis is in flight", () => {
    render(<ResidueShiftInspector analysisResult={{ ...NAE1_RESULT, insights: { biochemicalShift: "" } }} isNarrativeLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Running");
  });

  it("offers a pocket retry when the scan failed", () => {
    const onRetryPocket = vi.fn();
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} pocketError="Java not found" onRetryPocket={onRetryPocket} />);
    fireEvent.click(screen.getByRole("button", { name: /Retry pocket detection/ }));
    expect(onRetryPocket).toHaveBeenCalledTimes(1);
  });

  it("copies an interpretation in published units", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} computedPocket={NAE1_POCKET} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the interpretation/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("NAE1 p.Asp116Gly");
    expect(copied).toContain("Net charge: −1 → 0");
    expect(copied).toContain("Side-chain volume: 54 → 3 Å³");
    expect(copied).toContain("glycine frees the backbone");
  });

  it("reports a clipboard failure instead of silently claiming success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy the interpretation/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Copy failed/ })).toBeInTheDocument());
  });

  it("renders hostile narrative markup as inert text, not as DOM", () => {
    // The narrative is a model string; it must reach the DOM only as escaped text.
    const hostile = '**<img src=x onerror="alert(1)">** and <script>alert(2)</script>';
    const { container } = render(
      <ResidueShiftInspector analysisResult={{ ...NAE1_RESULT, insights: { biochemicalShift: hostile } }} />
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<img src=x onerror="alert\(1\)">/)).toBeInTheDocument();
  });

  it("cites the published sources by DOI, not a hand-made table", () => {
    render(<ResidueShiftInspector analysisResult={NAE1_RESULT} />);
    const sources = screen.getByTestId("residue-sources");
    for (const doi of ["10.1126/science.185.4154.862", "10.1016/0022-2836(82)90515-0", "10.1186/s13321-018-0285-8"]) {
      expect(within(sources).getByRole("link", { name: new RegExp(doi.replace(/[().]/g, "\\$&")) })).toHaveAttribute(
        "href",
        `https://doi.org/${doi}`
      );
    }
    expect(screen.queryByText(/IUPAC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/van der Waals volume table/)).not.toBeInTheDocument();
  });
});

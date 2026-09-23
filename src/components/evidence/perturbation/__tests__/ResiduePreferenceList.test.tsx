// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResiduePreferenceList } from "../ResiduePreferenceList";

/**
 * The Structural Perturbation tab's distribution panel, pinned against the defect that reached
 * review: `metadata.wildType` is three-letter ("Ser") while `preferences[].aa` is one-letter
 * ("S"), so comparing the two directly matched nothing — the legend dropped both percentages and
 * no row ever received the native or variant colour, leaving two legend swatches that explained
 * colours appearing nowhere in the list.
 *
 * The contract these tests pin is the prop split: *codes* match, *labels* display.
 */

/** A real payload shape: ranked descending, one-letter keys. Ser is rank 5, Cys rank 9. */
const PREFERENCES = [
  { aa: "K", prob: 0.1987 },
  { aa: "R", prob: 0.1061 },
  { aa: "G", prob: 0.0796 },
  { aa: "E", prob: 0.0783 },
  { aa: "S", prob: 0.0731 },
  { aa: "T", prob: 0.0549 },
  { aa: "Q", prob: 0.0535 },
  { aa: "N", prob: 0.0516 },
  { aa: "C", prob: 0.0126 }
];

const SKY = "rgb(2, 132, 199)";
const CLAY = "var(--cs-accent-clay)";

function barColours(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".h-full.rounded-r")).map(
    el => el.style.background
  );
}

function chipStyles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".w-6")).map(
    el => el.getAttribute("style") || ""
  );
}

function renderPanel(props: Partial<React.ComponentProps<typeof ResiduePreferenceList>> = {}) {
  return render(
    <ResiduePreferenceList
      preferences={PREFERENCES}
      wtCode="S"
      mutCode="C"
      wtLabel="Ser"
      mutLabel="Cys"
      pos={489}
      {...props}
    />
  );
}

describe("ResiduePreferenceList", () => {
  it("highlights the native and variant rows named by the legend", () => {
    const { container } = renderPanel();

    const bars = barColours(container);
    expect(bars.filter(c => c === SKY)).toHaveLength(1);
    expect(bars.filter(c => c === CLAY)).toHaveLength(1);

    // Both keyed rows also carry a tinted residue chip, so the highlight survives a colour-blind
    // reading of the bar alone.
    const chips = chipStyles(container);
    expect(chips.filter(s => s.includes("rgba(2, 132, 199, 0.1)"))).toHaveLength(1);
    expect(chips.filter(s => s.includes("rgba(196, 104, 73, 0.12)"))).toHaveLength(1);
  });

  it("labels the legend with the display name while matching on the one-letter code", () => {
    const { container } = renderPanel();
    const panel = container.firstElementChild as HTMLElement;
    const text = panel.textContent || "";

    expect(text).toContain("Native Ser");
    expect(text).toContain("Variant Cys");
    // Probability *and* rank: the variant of interest is routinely below the fold in a ranked
    // list of 20 inside a 220px scroll box, which is the other half of the reported defect.
    expect(text).toContain("7.31% · rank 5/9");
    expect(text).toContain("1.26% · rank 9/9");
  });

  it("resolves nothing from a three-letter code, because the payload cannot express one", () => {
    // This is the exact input the tab used to pass. Rendering it here documents why the tab must
    // resolve the pair first: no row matches, so both keyed colours disappear from the list while
    // the legend still announces them.
    const { container } = renderPanel({ wtCode: "Ser", mutCode: "Cys" });

    const bars = barColours(container);
    expect(bars.filter(c => c === SKY)).toHaveLength(0);
    expect(bars.filter(c => c === CLAY)).toHaveLength(0);
    expect(chipStyles(container).filter(s => s.includes("rgba("))).toHaveLength(0);
  });

  it("says so when the residue pair is unresolved instead of showing an inert legend", () => {
    const { container } = renderPanel({ wtCode: "", mutCode: "", wtLabel: "", mutLabel: "" });

    expect(container.textContent).toContain("Residue pair unresolved");
    expect(container.textContent).not.toContain("Native");
    expect(container.textContent).not.toContain("Variant");
  });

  it("keeps every residue row coloured by the shared background when nothing is keyed", () => {
    const { container } = renderPanel({ wtCode: "", mutCode: "", wtLabel: "", mutLabel: "" });

    const bars = barColours(container);
    expect(bars).toHaveLength(PREFERENCES.length);
    expect(bars.every(c => c === "var(--cs-text-muted)")).toBe(true);
  });
});

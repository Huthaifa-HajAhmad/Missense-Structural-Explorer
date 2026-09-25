// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Esm3ExploratorySection } from "../Esm3ExploratorySection";
import { UNMEASURED_BURIAL_ENVIRONMENT, isUnmeasuredEnvironment } from "../../../../shared/burialEvidence";

/**
 * The Microenvironment card renders every entry as a chip. One of those entries is not a
 * finding: when the SASA step never ran, `esm3_forge.ts` sends
 * `UNMEASURED_BURIAL_ENVIRONMENT` in place of a band, because it used to band the hard-coded
 * `rsa = 0.12` placeholder and assert "Hydrophobic core" for every variant with no structure.
 *
 * The fix that stopped the server asserting it left the chip painting it identically to a
 * classification — same purple, same bold, same uppercase — so on screen an absence of
 * evidence still read as evidence. These tests pin the distinction, and the tests below the
 * first one exist so that a renderer which marks *everything* muted cannot pass either.
 */

function evalWith(microenvironments: string[]) {
  return { microenvironments, structuralChangeLevel: "moderate" };
}

/** The chip element carrying this exact text. */
function chipFor(text: string): HTMLElement {
  const chip = screen.getByText(text);
  expect(chip).toBeTruthy();
  return chip as HTMLElement;
}

describe("Esm3ExploratorySection — the microenvironment chips", () => {
  it("marks the not-measured entry as unmeasured", () => {
    render(<Esm3ExploratorySection esm3Eval={evalWith([UNMEASURED_BURIAL_ENVIRONMENT, "Alpha-Helix"])} />);

    expect(chipFor(UNMEASURED_BURIAL_ENVIRONMENT).dataset.environment).toBe("unmeasured");
  });

  it("marks a real classification as measured, so the marking is a distinction and not a constant", () => {
    render(<Esm3ExploratorySection esm3Eval={evalWith(["Hydrophobic core", "Beta-Sheet"])} />);

    expect(chipFor("Hydrophobic core").dataset.environment).toBe("measured");
    expect(chipFor("Beta-Sheet").dataset.environment).toBe("measured");
  });

  it("distinguishes the two in the same card, rather than by which card it is", () => {
    render(<Esm3ExploratorySection esm3Eval={evalWith([UNMEASURED_BURIAL_ENVIRONMENT, "Loop / Flexible Turn"])} />);

    expect(chipFor(UNMEASURED_BURIAL_ENVIRONMENT).dataset.environment).toBe("unmeasured");
    expect(chipFor("Loop / Flexible Turn").dataset.environment).toBe("measured");
  });

  it("paints the unmeasured entry with a different class list from a classification", () => {
    render(<Esm3ExploratorySection esm3Eval={evalWith([UNMEASURED_BURIAL_ENVIRONMENT, "Hydrophobic core"])} />);

    const unmeasured = chipFor(UNMEASURED_BURIAL_ENVIRONMENT).className;
    const measured = chipFor("Hydrophobic core").className;

    expect(unmeasured).not.toBe(measured);
    // The measured chip keeps the classification treatment; the unmeasured one drops both the
    // purple "finding" colour and the bold weight that carried its authority.
    expect(measured).toContain("text-purple-400");
    expect(measured).toContain("font-bold");
    expect(unmeasured).not.toContain("text-purple-400");
    expect(unmeasured).not.toContain("font-bold");
  });

  it("renders nothing for an error payload rather than an empty card", () => {
    const { container } = render(<Esm3ExploratorySection esm3Eval={{ error: "sidecar unreachable" }} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("isUnmeasuredEnvironment", () => {
  it("recognises the shared entry and nothing else", () => {
    expect(isUnmeasuredEnvironment(UNMEASURED_BURIAL_ENVIRONMENT)).toBe(true);
    expect(isUnmeasuredEnvironment("Hydrophobic core")).toBe(false);
    expect(isUnmeasuredEnvironment("Surface")).toBe(false);
    expect(isUnmeasuredEnvironment("Binding pocket")).toBe(false);
    // Not a prefix or substring match: a classification that merely mentions burial is a finding.
    expect(isUnmeasuredEnvironment("burial not measured")).toBe(false);
  });
});

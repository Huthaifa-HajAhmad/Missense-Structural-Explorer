// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BrandMark } from "../BrandMark";

describe("BrandMark", () => {
  it("is decorative: hidden from assistive tech and out of the tab order", () => {
    const { container } = render(<BrandMark size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("viewBox", "-4 -4 72 72");
  });

  it("uses the heavier small drawing below 32px, not a scaled copy", () => {
    const widths = (size: number) =>
      Array.from(render(<BrandMark size={size} />).container.querySelectorAll("path"))
        .map((p) => Number(p.getAttribute("stroke-width")))
        .sort((a, b) => b - a);
    // The widest stroke is the tile-coloured gap around the residue: wider in the small cut.
    expect(widths(16)[0]).toBeGreaterThan(widths(32)[0]);
    expect(widths(31)).toEqual(widths(16));
    expect(widths(48)).toEqual(widths(32));
  });

  it("paints through CSS variables with the clay-tile defaults", () => {
    const { container } = render(<BrandMark size={32} />);
    const strokes = new Set(Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("stroke")));
    expect(strokes).toContain("var(--bm-bg, #C46849)");
    expect(strokes).toContain("var(--bm-body, #FFFFFF)");
    expect(strokes).toContain("var(--bm-back, #EFC9BB)");
    // the substituted residue
    expect(strokes).toContain("var(--bm-hit, #191816)");
  });
});

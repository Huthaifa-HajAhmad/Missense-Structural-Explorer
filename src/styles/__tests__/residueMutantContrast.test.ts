import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

describe("mutant residue code in Residue shifts", () => {
  it("is coloured with a text token that reads at 4.5:1 or better on a white card (WCAG AA)", () => {
    const styles = path.resolve(__dirname, "..");
    const rule = fs.readFileSync(path.join(styles, "residue.css"), "utf8").match(/\.rsx-glyph-code--mut\s*\{\s*color:\s*var\((--[\w-]+)\)/);
    expect(rule, "the mutant code rule names a colour token").not.toBeNull();
    const tokens = fs.readFileSync(path.join(styles, "variables.css"), "utf8");
    // The light theme's value: the first declaration of the token in variables.css.
    const value = tokens.match(new RegExp(`${rule![1]}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    expect(value, "the token has a hex value in the light theme").toBeDefined();
    const ratio = (1 + 0.05) / (luminance(value!) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guardrail: the light neutral ramp is a real ramp, and the declaration it is read from is the one
 * the browser computes.
 *
 * WHY THIS EXISTS — AND WHY IT WAS REWRITTEN
 * -----------------------------------------
 * This is a shadowless design, so a surface's depth is carried entirely by its fill and a hairline
 * border. That makes the neutral ramp load-bearing, and it was not a ramp:
 *
 *     --cs-surface-2   #FAF9F6   L 97.25%
 *     --cs-bg          #F9F8F6   L 97.06%   -> a step of MINUS 0.19 points
 *
 * `--cs-surface-2` is the fill of most card bodies in this app (332 references across 59 files). It sat
 * a fifth of a percentage point LIGHTER than the page it was drawn on — the same colour, so a card did
 * not read as a card.
 *
 * The first version of this guard read the FIRST declaration of each token:
 *
 *     // First declaration wins, so a later alias cannot overwrite the literal.
 *     if (!values.has(match[1])) values.set(match[1], match[2].toUpperCase());
 *
 * That is the inverse of the cascade. `variables.css` declared `--cs-surface-2` twice in `:root` — the
 * corrected value near the top and a legacy `#FAF9F6` straggler 140 lines later — and for one property
 * in one declaration block CSS takes the LAST value. So the fix was inert in the browser while this
 * guard read the new hex, computed a 3.14-point step, and passed. Two reviewers caught it
 * independently, one by minifying the file with the real CSS engine and one by resolving it through
 * jsdom. A guard that certifies the version of the theme that is not being rendered is worse than no
 * guard, because it is the thing that would have stopped the search.
 *
 * So the parser now models CSS (last wins) AND the file is forbidden from containing the ambiguity at
 * all: a token declared twice inside one block is a failure, named with both line numbers. The second
 * assertion is what makes the first truthful — with duplicates banned, "last wins" and "the only
 * declaration" are the same value, and neither reading can be right while the other is wrong.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. `:root` and `.dark` are located as SELECTORS, and both blocks parse;
 *   2. no token is declared twice inside `:root` (the defect above) or inside `.dark`;
 *   3. the light ramp is strictly ordered, lightest first, under the white card top;
 *   4. every adjacent step clears MIN_STEP lightness points;
 *   5. the fills are actually warm — the file claims a 40-42 degree hue band, and lightness alone does
 *      not constrain hue, so a blue fill passed the old version;
 *   6. `--cs-text-muted` clears AA on every fill it is painted on, and that list is non-empty.
 *
 * Numbers are HSL lightness, not WCAG relative luminance: luminance is the wrong measure for "do these
 * two fills look different", and it is the space a designer reads the ramp in.
 */

const REPO_ROOT = process.cwd();
const VARIABLES_CSS = path.join(REPO_ROOT, "src", "styles", "variables.css");
const PRINT_CSS = path.join(REPO_ROOT, "src", "styles", "print.css");

/**
 * Minimum lightness step between adjacent ramp levels, in percentage points.
 *
 * A CHOSEN perceptual floor, not a derived one. The defect was 0.19 points, so any positive threshold
 * would have caught it; 2.5 is the smallest step that survived on the panel this was triaged on, and
 * deliberately above the ~1 point at which a fill boundary reads as the same surface.
 */
const MIN_STEP = 2.5;

/** AA for normal-size text. `--cs-text-muted` carries 9.5-11px copy in the inspectors. */
const MIN_TEXT_CONTRAST = 4.5;

/** The ramp, lightest first. The white card top exists so every other fill is a wash below it. */
const RAMP: ReadonlyArray<string> = [
  "--cs-surface",
  "--cs-bg",
  "--cs-surface-2",
  "--cs-bg-subtle",
  "--cs-border-subtle",
  "--cs-border",
];

/** Fills that carry `--cs-text-muted` in the shipped UI. Must not be empty — see assertion 6. */
const MUTED_TEXT_FILLS: ReadonlyArray<string> = ["--cs-surface-2", "--cs-bg-subtle", "--cs-bg"];

/** The warm-cream band this palette declares. Hue in degrees; chroma as max-min channel spread. */
const HUE_MIN = 25;
const HUE_MAX = 65;
const MAX_CHROMA = 24;

interface Block {
  selector: string;
  body: string;
  /** 1-based line number of the selector, so failure messages can point at the file. */
  startLine: number;
}

/** Locate `selector { ... }` by its selector, never by a substring of the file. */
function findBlock(css: string, selector: string): Block | null {
  const pattern = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
  const match = pattern.exec(css);
  if (!match) return null;

  const bodyStart = match.index + match[0].length;
  const endAt = css.indexOf("\n}", bodyStart);
  if (endAt === -1) return null;

  return {
    selector,
    body: css.slice(bodyStart, endAt),
    startLine: css.slice(0, match.index).split("\n").length,
  };
}

interface Declaration {
  token: string;
  value: string;
  line: number;
}

/**
 * Every custom-property declaration in a block, in source order, with line numbers.
 *
 * Comment lines are skipped: this file explains its own values in prose that quotes them, and a
 * documented value must not be read as a declaration. `^\s*--cs-` cannot match a comment line, which
 * in this file always begins with ` * `, but the explicit guard keeps that from being load-bearing.
 */
function readDeclarations(css: string, block: Block): Declaration[] {
  const out: Declaration[] = [];
  const lines = block.body.split("\n");

  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;

    const match = text.match(/^\s*(--cs-[a-z0-9-]+)\s*:\s*([^;]+);/);
    if (!match) return;

    out.push({
      token: match[1],
      value: match[2].trim(),
      line: block.startLine + index + 1,
    });
  });

  return out;
}

/**
 * The value the cascade produces: the LAST declaration of each token.
 *
 * This is the whole point of the rewrite. Reading the first declaration is what let the guard certify
 * a `--cs-surface-2` the browser never used.
 */
function effectiveValues(declarations: Declaration[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const declaration of declarations) {
    values.set(declaration.token, declaration.value.toUpperCase());
  }
  return values;
}

/** Tokens declared more than once in one block, with every line — the defect class. */
function duplicates(declarations: Declaration[]): Array<{ token: string; lines: number[] }> {
  const byToken = new Map<string, number[]>();
  for (const declaration of declarations) {
    byToken.set(declaration.token, [...(byToken.get(declaration.token) ?? []), declaration.line]);
  }
  return [...byToken.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([token, lines]) => ({ token, lines }));
}

function lightness(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
  return ((Math.max(...channels) + Math.min(...channels)) / 2 / 255) * 100;
}

/** Hue in degrees and chroma as a 0-255 channel spread. */
function hueAndChroma(hex: string): { hue: number; chroma: number } {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, chroma: 0 };

  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;

  return { hue, chroma: delta };
}

function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const linear = [0, 2, 4].map(offset => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const css = fs.readFileSync(VARIABLES_CSS, "utf-8");
const root = findBlock(css, ":root");
const dark = findBlock(css, ".dark");
const printCss = fs.readFileSync(PRINT_CSS, "utf-8");

describe("light neutral ramp", () => {
  it("locates :root and .dark as selectors, not as substrings", () => {
    /**
     * The previous version sliced from `css.indexOf(":root")` to `css.indexOf(".dark")`. That second
     * index hit a PROSE mention of `.dark` inside a comment 36 lines above the real block, so the
     * light slice was truncated mid-comment and the "did we parse anything" check below was satisfied
     * by a comment. Deleting the entire `.dark` block still passed.
     */
    expect(root, "variables.css must declare the light palette in a `:root {` block").not.toBeNull();
    expect(dark, "variables.css must declare the dark overrides in a `.dark {` block").not.toBeNull();
    expect(root!.body).toContain("--cs-text-primary");
    expect(dark!.body).toContain("--cs-text-primary");
  });

  it("declares no token twice in one block", () => {
    /*
     * The defect this guard missed. `--cs-surface-2` was declared at the top of `:root` and again 140
     * lines later; the later one won, so the corrected value was never painted. Reported with both
     * line numbers because the fix is to delete one of them, and which one matters.
     */
    for (const [name, block] of [["`:root`", root!], ["`.dark`", dark!]] as const) {
      const dups = duplicates(readDeclarations(css, block));
      const report = dups
        .map(d => `  ${d.token} declared at lines ${d.lines.join(", ")}`)
        .join("\n");

      expect(
        dups,
        dups.length === 0
          ? ""
          : `A token declared twice in ${name} is resolved by source order, not by intent — the LAST ` +
            `declaration wins:\n${report}\n\nDelete the later one. This is how the neutral-ramp fix ` +
            `was silently reverted: \`--cs-surface-2\` was corrected near the top of \`:root\` and ` +
            `re-declared as the old #FAF9F6 further down.`
      ).toHaveLength(0);
    }
  });

  it("reads each ramp token's EFFECTIVE value — the last declaration, as CSS does", () => {
    const values = effectiveValues(readDeclarations(css, root!));
    for (const token of RAMP) {
      expect(
        values.get(token),
        `${token} must be a literal hex in :root so the ramp is measurable. An alias (var(...)) or a ` +
          `3-digit shorthand would also pass a naive parse while resolving to something else.`
      ).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("is strictly ordered from the white card top down to the hairline", () => {
    const values = effectiveValues(readDeclarations(css, root!));
    const levels = RAMP.map(token => ({ token, l: lightness(values.get(token)!) }));

    for (let i = 1; i < levels.length; i++) {
      const above = levels[i - 1];
      const below = levels[i];
      expect(
        below.l,
        `${below.token} (${below.l.toFixed(2)}%) must be darker than ${above.token} ` +
          `(${above.l.toFixed(2)}%) — the ramp inverted`
      ).toBeLessThan(above.l);
    }
  });

  it("keeps every adjacent step at or above the minimum visible step", () => {
    const values = effectiveValues(readDeclarations(css, root!));
    const levels = RAMP.map(token => ({ token, l: lightness(values.get(token)!) }));

    for (let i = 1; i < levels.length; i++) {
      const step = levels[i - 1].l - levels[i].l;
      expect(
        step,
        `step ${levels[i - 1].token} -> ${levels[i].token} is ${step.toFixed(2)} points; ` +
          `a fill boundary below ${MIN_STEP} reads as the same surface`
      ).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it("puts the nested panel below the page, never above it", () => {
    // The exact regression, as its own named assertion. "Lightening the card a little" is the edit
    // most likely to bring it back.
    const values = effectiveValues(readDeclarations(css, root!));
    const page = lightness(values.get("--cs-bg")!);
    const nested = lightness(values.get("--cs-surface-2")!);

    expect(nested).toBeLessThan(page);
    expect(
      page - nested,
      "the nested panel must clear the page by the minimum step, not by a fraction of a point"
    ).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it("keeps the ramp warm, which lightness alone does not constrain", () => {
    /*
     * `variables.css` states that hue is held in a 40-42 degree band. Nothing checked it, and a
     * clearly blue fill (`#E0E0FE`, chroma 30) passed every lightness assertion — so the claim was
     * prose, not a property.
     */
    const values = effectiveValues(readDeclarations(css, root!));

    for (const token of RAMP) {
      const hex = values.get(token)!;
      const { hue, chroma } = hueAndChroma(hex);
      if (chroma === 0) continue; // pure white/neutral is in-band by definition

      expect(
        chroma,
        `${token} (${hex}) has chroma ${chroma}; the neutral ramp must stay near-neutral`
      ).toBeLessThanOrEqual(MAX_CHROMA);
      expect(
        hue >= HUE_MIN && hue <= HUE_MAX,
        `${token} (${hex}) has hue ${hue.toFixed(0)} degrees, outside the declared ${HUE_MIN}-${HUE_MAX} ` +
          `warm band — the ramp is no longer the warm cream the palette documents`
      ).toBe(true);
    }
  });

  it("checks a non-empty list of fills for --cs-text-muted", () => {
    // With `MUTED_TEXT_FILLS = []` the contrast assertions below would run zero times and pass.
    expect(MUTED_TEXT_FILLS.length).toBeGreaterThan(0);
  });

  it("keeps --cs-text-muted above AA on every fill it is painted on", () => {
    const values = effectiveValues(readDeclarations(css, root!));
    const muted = values.get("--cs-text-muted")!;
    expect(muted, "--cs-text-muted must be a literal hex in :root").toMatch(/^#[0-9A-F]{6}$/);

    for (const fill of MUTED_TEXT_FILLS) {
      const backdrop = values.get(fill);
      expect(backdrop, `${fill} must resolve to a literal hex before its contrast can be measured`).toMatch(
        /^#[0-9A-F]{6}$/
      );
      const ratio = contrast(muted, backdrop!);
      expect(
        Number(ratio.toFixed(2)),
        `--cs-text-muted on ${fill} is ${ratio.toFixed(1)}:1 — below the ${MIN_TEXT_CONTRAST}:1 floor ` +
          `for the 9.5-11px copy the inspectors set in it`
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});

/**
 * The PRINTED report is a separate palette and had the same class of defect.
 *
 * `print.css` flattens the theme to document values. It flattened two pairs wrongly: `--cs-border-subtle`
 * and `--cs-surface-2` were the identical hex `#F3F4F6`, so every panel written as
 * `background: var(--cs-surface-2); border: 1px solid var(--cs-border-subtle)` (all of `ReportBlocks`)
 * lost its outline on paper at 1.00:1; and `--cs-bg-subtle` sat ABOVE `--cs-surface-2`, inverting the
 * ramp. The printed report is the artefact that gets filed, so a panel boundary disappearing there
 * matters more than on screen — and it is invisible to every test that only asserts the screen theme.
 */
describe("print neutral ramp", () => {
  /** Declarations in print.css resolve with `!important`, so the value carries the flag. */
  const printValues = (() => {
    const values = new Map<string, string>();
    const declaration = /^\s*(--cs-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*!important\s*;/gm;
    let match: RegExpExecArray | null;
    while ((match = declaration.exec(printCss)) !== null) {
      values.set(match[1], match[2].toUpperCase());
    }
    return values;
  })();

  it("declares the whole ramp, once each", () => {
    for (const token of RAMP) {
      expect(printValues.get(token), `print.css must flatten ${token} to a literal hex`).toMatch(
        /^#[0-9A-F]{6}$/
      );
    }
    // A duplicate would be resolved by source order here too, and print.css has no other guard.
    const seen = new Map<string, number>();
    const declaration = /^\s*(--cs-[a-z0-9-]+)\s*:\s*[^;]+;/gm;
    let match: RegExpExecArray | null;
    while ((match = declaration.exec(printCss)) !== null) {
      seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([token]) => token);
    expect(duplicates, `print.css declares ${duplicates.join(", ")} more than once`).toEqual([]);
  });

  it("is a monotonic ramp, so a panel border is never the colour of the panel", () => {
    const levels = RAMP.map(token => ({ token, l: lightness(printValues.get(token)!) }));

    for (let i = 1; i < levels.length; i++) {
      const step = levels[i - 1].l - levels[i].l;
      expect(
        step,
        `printed step ${levels[i - 1].token} -> ${levels[i].token} is ${step.toFixed(2)} points. ` +
          `At 0.00 the divider is the fill it borders and the panel loses its outline on paper — ` +
          `which is what --cs-border-subtle #F3F4F6 against --cs-surface-2 #F3F4F6 did.`
      ).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });
});

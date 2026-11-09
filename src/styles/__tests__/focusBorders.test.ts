import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guardrail: composed surfaces show exactly ONE focus outline.
 *
 * The query composer is a `.qe__bar` that carries the visible keyboard
 * boundary via `.qe__bar:has(:focus-visible)`. Any focusable child that
 * also paints its own `:focus-visible` outline produces the double
 * border (inner tool outline + outer bar outline) this guards against.
 * The chart frame had the same class of defect split across two rules:
 * pointer focus must be transparent, keyboard focus must be clay, in
 * one declaration pair.
 */

const workbench = fs.readFileSync(
  path.join(process.cwd(), "src", "styles", "variant-workbench.css"),
  "utf-8"
);
const charts = fs.readFileSync(
  path.join(process.cwd(), "src", "styles", "charts.css"),
  "utf-8"
);
const expression = fs.readFileSync(
  path.join(process.cwd(), "src", "styles", "expression.css"),
  "utf-8"
);
const contextWorkspace = fs.readFileSync(
  path.join(process.cwd(), "src", "styles", "context-workspace.css"),
  "utf-8"
);

describe("single focus outline on composed surfaces", () => {
  it("does not give the in-bar tool its own focus outline", () => {
    const focusList = workbench.match(
      /\.variant-workbench :is\([^)]*\):focus-visible \{[^}]*\}/
    );
    expect(focusList, "expected the shared focus-visible rule to exist").not.toBeNull();
    expect(
      focusList![0].includes(".qe__tool"),
      ".qe__tool sits inside .qe__bar, which already outlines on :has(:focus-visible) — " +
        "a second outline on the tool is the double border"
    ).toBe(false);
  });

  it("keeps the variant input itself outline-free (bar carries focus)", () => {
    expect(workbench).toMatch(/\.qe__input:focus-visible \{ outline: 2px solid transparent; \}/);
  });

  it("declares chart keyboard focus exactly once", () => {
    const occurrences = charts.match(/\.viz-frame svg:focus-visible/g) ?? [];
    expect(
      occurrences.length,
      `chart focus-visible must be one rule, got ${occurrences.length} — split rules drift apart`
    ).toBe(1);
    expect(charts).toMatch(
      /\.viz-frame svg:focus, \.viz-frame \[tabindex\]:focus \{ outline: 2px solid transparent; outline-offset: -3px; \}/
    );
    expect(charts).toMatch(
      /\.viz-frame svg:focus-visible, \.viz-frame \[tabindex\]:focus-visible \{ outline: 2px solid var\(--cs-accent-clay\); outline-offset: -3px; \}/
    );
  });

  it("does not let the leading disease span grow and push the systems count away", () => {
    // Disease now leads the summary. flex:1 1 25ch on the first span made it
    // absorb all free space, pushing the systems count to the far right.
    const xp = expression.match(/\.xp-review-settings > summary \.xp-review-disease \{[^}]*\}/);
    const sm = contextWorkspace.match(/\.sm-review-disease \{[^}]*\}/);
    expect(xp, "expected .xp-review-disease rule").not.toBeNull();
    expect(sm, "expected .sm-review-disease rule").not.toBeNull();
    for (const [name, rule] of [[".xp-review-disease", xp![0]], [".sm-review-disease", sm![0]]] as const) {
      expect(
        /flex:\s*1/.test(rule),
        `${name} must not grow (flex: 1…) once it leads the row — it would push the systems count to the edge`
      ).toBe(false);
    }
  });
});

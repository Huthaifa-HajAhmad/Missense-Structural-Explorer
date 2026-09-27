import { describe, it, expect } from "vitest";
import {
  ALLOW_MARKER,
  auditFocusIndicators,
  MIN_REASON_LENGTH,
  readSources,
} from "../../scripts/check-focus-indicators.mjs";

/**
 * The focus-indicator guard, and the exemption mechanism added to it.
 *
 * The guard used to report two suppressions in `SettingsDrawer` on every run: the search field, whose
 * ring is drawn by `.settings-search input:focus` in `src/styles/settings.css`, and the tab panel, which
 * is a `tabIndex={-1}` programmatic focus target. Both are correct, and neither can name a replacement
 * in the same string literal — the two ways out of a permanently-red check are to inline a redundant
 * indicator or to delete the check.
 *
 * So a suppression may carry `// focus-guard-allow: <reason>` instead, and the tests below are mostly
 * negative for the usual reason: the exemption is the part that can quietly turn the guard off. The
 * important one is the last: stripping the real repository's annotations must bring the violations
 * back, or the mechanism is decoration.
 */

const LONG_REASON = "a reason that is comfortably longer than the minimum";

function source(text: string) {
  return new Map([["src/Example.tsx", text]]);
}

describe("auditFocusIndicators — replacements", () => {
  it("accepts a suppression with a focus:ring companion in the same literal", () => {
    const result = auditFocusIndicators(source('<div className="focus:outline-none focus:ring-2" />'));
    expect(result.violations).toEqual([]);
    expect(result.suppressions).toBe(1);
    expect(result.allowed).toEqual([]);
  });

  it("counts every suppression, not just the first in a file", () => {
    const result = auditFocusIndicators(
      source('<div className="focus:outline-none" />\n<div className="focus:outline-none focus:border-x" />'),
    );
    expect(result.suppressions).toBe(2);
    expect(result.violations).toHaveLength(1);
  });
});

describe("auditFocusIndicators — negative controls", () => {
  it("flags a suppression with nothing to replace it", () => {
    const result = auditFocusIndicators(source('<div className="focus:outline-none" />'));
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("NO_REPLACEMENT");
    expect(result.violations[0].line).toBe(1);
  });

  it("does not accept a replacement from a DIFFERENT element's literal", () => {
    // The companion has to be on the control that lost its outline, not merely nearby.
    const result = auditFocusIndicators(
      source('<div className="focus:outline-none" />\n<span className="focus:ring-2" />'),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("NO_REPLACEMENT");
  });

  it("rejects a marker with no reason at all", () => {
    const result = auditFocusIndicators(
      source(`<div\n  // ${ALLOW_MARKER}\n  className="focus:outline-none"\n/>`),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("WEAK_REASON");
  });

  it("rejects a reason shorter than the minimum, so the marker cannot be a rubber stamp", () => {
    const result = auditFocusIndicators(
      source(`<div\n  // ${ALLOW_MARKER} fine\n  className="focus:outline-none"\n/>`),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("WEAK_REASON");
    expect(result.violations[0].reason).toBe("fine");
    expect(MIN_REASON_LENGTH).toBeGreaterThan("fine".length);
  });

  it("does not honour an annotation two lines above the suppression", () => {
    /*
     * Locality is the point: the reason has to sit on the control it excuses. A marker that reached any
     * further would cover the next `focus:outline-none` added to the same element by accident.
     */
    const result = auditFocusIndicators(
      source(`<div\n  // ${ALLOW_MARKER} ${LONG_REASON}\n  data-x="1"\n  className="focus:outline-none"\n/>`),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("NO_REPLACEMENT");
  });

  it("ignores a marker smuggled inside the literal it would excuse", () => {
    // `className="... // focus-guard-allow: ..."` passes a naive same-line check while putting the
    // reason into the DOM as a class name. The marker is only honoured outside the literal.
    const result = auditFocusIndicators(
      source(`<div className="focus:outline-none // ${ALLOW_MARKER} ${LONG_REASON}" />`),
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("NO_REPLACEMENT");
  });
});

describe("auditFocusIndicators — exemptions", () => {
  it("accepts a stated reason on the line above, which is the only place JSX allows a comment", () => {
    const result = auditFocusIndicators(
      source(`<div\n  // ${ALLOW_MARKER} ${LONG_REASON}\n  className="focus:outline-none"\n/>`),
    );
    expect(result.violations).toEqual([]);
    expect(result.allowed).toHaveLength(1);
    expect(result.allowed[0].reason).toBe(LONG_REASON);
    expect(result.allowed[0].line).toBe(3);
  });

  it("accepts a stated reason trailing the suppression on its own line", () => {
    const result = auditFocusIndicators(
      source(`<div className="focus:outline-none" /> // ${ALLOW_MARKER} ${LONG_REASON}`),
    );
    expect(result.violations).toEqual([]);
    expect(result.allowed).toHaveLength(1);
  });

  it("still requires the replacement when a suppression has one — the marker is not a shortcut", () => {
    // A marker next to an element that already names its replacement stays a plain replacement.
    const result = auditFocusIndicators(
      source(`<div\n  // ${ALLOW_MARKER} ${LONG_REASON}\n  className="focus:outline-none focus:ring-2"\n/>`),
    );
    expect(result.allowed).toEqual([]);
    expect(result.violations).toEqual([]);
  });
});

describe("the real repository", () => {
  const sources = readSources();

  it("passes", () => {
    expect(auditFocusIndicators(sources).violations).toEqual([]);
  });

  it("actually scans the source tree", () => {
    const result = auditFocusIndicators(sources);
    expect(sources.size).toBeGreaterThan(50);
    expect(result.suppressions).toBeGreaterThanOrEqual(9);
  });

  it("uses exemptions, and they are LOAD-BEARING", () => {
    /*
     * The assertion that keeps the exemption honest: remove every annotation and the same number of
     * violations must appear. If this ever reports 0, the markers in `SettingsDrawer` are decoration and
     * the guard is passing for a different reason than the one the code claims.
     */
    const annotated = auditFocusIndicators(sources);
    expect(annotated.allowed.length).toBeGreaterThan(0);

    const stripped = new Map(
      [...sources].map(([file, text]) => [
        file,
        text
          .split("\n")
          .filter((line: string) => !line.includes(ALLOW_MARKER))
          .join("\n"),
      ]),
    );
    const without = auditFocusIndicators(stripped);

    expect(without.allowed).toEqual([]);
    expect(without.violations).toHaveLength(annotated.allowed.length);
    // Line numbers shift when the annotation lines are removed, so the files are what is comparable.
    expect(without.violations.map((v) => v.file).sort()).toEqual(annotated.allowed.map((a) => a.file).sort());
    expect(without.violations.every((v) => v.kind === "NO_REPLACEMENT")).toBe(true);
  });
});

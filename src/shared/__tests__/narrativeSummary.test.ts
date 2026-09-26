import { describe, it, expect } from "vitest";
import { summariseNarrative } from "../narrativeSummary";

/**
 * The Insights view carried the whole narrative, verbatim, beside the Report's copy of it.
 *
 * The two were the same AI text rendered in two panes of one viewport, and only the Report copy was
 * covered by the section toggles, the print pass, the EHR export and the report fingerprint. The
 * Insights view now shows a condensed clinical summary and links to the full text; these tests pin
 * the two properties that make that safe — it selects the right section, and it never cuts a claim
 * in half.
 */

/** Shaped like the real response: four `###` sections, emoji-prefixed headings, markdown prose. */
const NARRATIVE = [
  "### \u{1F9EC} Molecular and Chemical Shift",
  "",
  "Wild-type Ser is **polar and small**, while Cys is polar but bulkier. The side chain loses a",
  "hydrogen-bond donor and gains a thiol.",
  "",
  "### \u{1F9F1} Structural Context & Disruptive Potential",
  "",
  "1. No steric clash is predicted.",
  "2. The local helix packing is preserved.",
  "",
  "### \u{1F3E5} Clinical and Pathogenicity Interpretation",
  "",
  "The variant is plausibly uncertain in pathogenicity. In-silico predictors disagree, so PP3 cannot",
  "be applied at full weight. No functional study has been reported. Curator review is required.",
  "",
  "### \u{1F52C} Recommended 3D Visualization Landmarks",
  "",
  "Inspect the loop between the two helices and check solvent exposure.",
].join("\n");

describe("summariseNarrative", () => {
  it("selects the clinical interpretation section, not the opening one", () => {
    const summary = summariseNarrative(NARRATIVE);

    expect(summary.text).toContain("plausibly uncertain in pathogenicity");
    // The molecular-shift argument is not the conclusion, and must not be what the summary leads with.
    expect(summary.text).not.toContain("Wild-type Ser is");
    expect(summary.sourceSection).toBe("Clinical and Pathogenicity Interpretation");
  });

  it("strips markdown so the prose does not render a stray marker", () => {
    const summary = summariseNarrative(NARRATIVE);
    expect(summary.text).not.toMatch(/\*\*/);
    expect(summary.text).not.toMatch(/^#/m);
    expect(summary.text).not.toMatch(/\|/);
  });

  it("strips list markers when it falls back to a list-shaped section", () => {
    const structureOnly = [
      "### Structural Context",
      "",
      "1. No steric clash is predicted.",
      "2. Local helix packing is preserved.",
    ].join("\n");

    const summary = summariseNarrative(structureOnly);
    expect(summary.text).toBe("No steric clash is predicted. Local helix packing is preserved.");
  });

  it("truncates on a sentence boundary and says that it did", () => {
    // A ceiling short enough to force a cut inside the clinical section.
    const summary = summariseNarrative(NARRATIVE, { maxChars: 90 });

    expect(summary.truncated).toBe(true);
    expect(summary.text.length).toBeLessThanOrEqual(91);
    // The cut lands on sentence punctuation, so no claim is left half-stated.
    expect(summary.text).toMatch(/[.!?]$/);
    expect(summary.text).not.toMatch(/[a-z]$/);
  });

  it("NEGATIVE CONTROL: a hard character cut would end mid-sentence", () => {
    const clinical = "The variant is plausibly uncertain in pathogenicity. No functional study exists.";
    const firstSentence = "The variant is plausibly uncertain in pathogenicity.";
    // The ceiling has to clear the first sentence but not the whole section, so the two behaviours
    // differ. Below the first sentence's length the only honest option is the marked
    // word-boundary fallback, which the next test covers.
    const ceiling = firstSentence.length + 8;
    const hardCut = clinical.slice(0, ceiling);

    // The property the implementation must NOT have: a naive slice stops mid-sentence.
    expect(hardCut.startsWith(firstSentence)).toBe(true);
    expect(hardCut).not.toBe(firstSentence);
    expect(hardCut).not.toMatch(/[.!?]$/);
    // The property it does have: the cut lands on the sentence end inside the window.
    expect(summariseNarrative(`### Clinical Interpretation\n\n${clinical}`, { maxChars: ceiling }).text)
      .toBe(firstSentence);
  });

  it("marks a word-boundary fallback as truncated rather than passing it off as complete", () => {
    // No sentence punctuation at all: the only honest options are a mid-word cut or a marked ellipsis.
    const runOn = "### Clinical Interpretation\n\n" + "word ".repeat(60).trim();
    const summary = summariseNarrative(runOn, { maxChars: 50 });

    expect(summary.truncated).toBe(true);
    expect(summary.text.endsWith("\u2026")).toBe(true);
  });

  it("does not claim truncation when the section fits", () => {
    const summary = summariseNarrative("### Clinical Interpretation\n\nShort and complete.");
    expect(summary).toEqual({
      text: "Short and complete.",
      truncated: false,
      sourceSection: "Clinical Interpretation",
    });
  });

  it("falls back to the opening section when there is no clinical heading", () => {
    const summary = summariseNarrative("### Evidence Considered\n\nThe rule engine applied PM2.");
    expect(summary.text).toBe("The rule engine applied PM2.");
    expect(summary.sourceSection).toBe("Evidence Considered");
  });

  it("handles a narrative with no headings at all", () => {
    const summary = summariseNarrative("Plain prose with no headings. A second sentence follows.");
    expect(summary.text).toBe("Plain prose with no headings. A second sentence follows.");
    expect(summary.sourceSection).toBeNull();
  });

  it("returns nothing for a missing narrative rather than inventing a placeholder", () => {
    for (const empty of [null, undefined, "", "   \n  "]) {
      expect(summariseNarrative(empty)).toEqual({ text: "", truncated: false, sourceSection: null });
    }
  });

  it("never exceeds the requested ceiling when a sentence boundary exists inside it", () => {
    const summary = summariseNarrative(NARRATIVE, { maxChars: 120 });
    expect(summary.text.length).toBeLessThanOrEqual(120);
  });

  it("extracts a link's text instead of its markdown", () => {
    const summary = summariseNarrative(
      "### Clinical Interpretation\n\nSee [Richards et al. 2015](https://example.org/acmg) for the rules."
    );
    expect(summary.text).toBe("See Richards et al. 2015 for the rules.");
  });

  /**
   * The two defects that survived the first version of this module, both of which its own tests passed
   * over. `toProse(chosen.body) || toProse(source)` fell back to the WHOLE document while
   * `sourceSection` kept naming the chosen heading, and `toProse` had no heading rule — so a section
   * whose heading was present but whose body was empty produced the next section's prose, led by its
   * raw `###` marker, under a label describing a different section.
   */
  it("never returns raw markdown, including when a section is heading-only", () => {
    const headingOnly = [
      "### \u{1F9EC} Molecular and Chemical Shift",
      "",
      "### \u{1F3E5} Clinical and Pathogenicity Interpretation",
      "",
      "### \u{1F52C} Recommended 3D Visualization Landmarks",
    ].join("\n");

    const summary = summariseNarrative(headingOnly);

    // No prose exists anywhere, so there is nothing to summarise and no section to name.
    expect(summary.text).toBe("");
    expect(summary.sourceSection).toBeNull();
  });

  it("does not label a summary with a heading whose body it could not use", () => {
    // Clinical heading empty; the next section has prose. The label must describe the text beside it,
    // or it must be absent — never the heading that produced nothing.
    const summary = summariseNarrative(
      [
        "### Clinical and Pathogenicity Interpretation",
        "",
        "### Structural Context",
        "",
        "The substitution sits in the third helix.",
      ].join("\n")
    );

    expect(summary.text).toBe("The substitution sits in the third helix.");
    expect(summary.text).not.toMatch(/#/);
    expect(summary.sourceSection).toBe("Structural Context");
  });

  it("prefers the conclusion over an earlier heading that merely matches 'interpretation'", () => {
    /*
     * `find` on one pattern took the FIRST match, and "Structural Interpretation of the Model" is the
     * argument, not the conclusion.
     */
    const summary = summariseNarrative(
      [
        "### Structural Interpretation of the Model",
        "",
        "This is the argument, not the conclusion.",
        "",
        "### Clinical and Pathogenicity Interpretation",
        "",
        "This is the conclusion.",
      ].join("\n")
    );

    expect(summary.text).toBe("This is the conclusion.");
    expect(summary.sourceSection).toBe("Clinical and Pathogenicity Interpretation");
  });

  it("skips the process boilerplate a rule-based fallback report opens with", () => {
    /*
     * The server's degraded report's first clinical-matching heading is "Rule-Based Clinical Summary",
     * whose body explains HOW the report was assembled, while the verdict lives in "Classification".
     * A reader was shown the boilerplate and told it was the clinical summary.
     */
    const fallbackReport = [
      "### Rule-Based Clinical Summary",
      "",
      "This report was assembled from curated database evidence and deterministic ACMG/AMP decision rules.",
      "",
      "### Classification",
      "",
      "Rule-based ACMG/AMP consensus: **Variant of Uncertain Significance (VUS)**.",
    ].join("\n");

    const summary = summariseNarrative(fallbackReport);

    expect(summary.sourceSection).toBe("Classification");
    expect(summary.text).toContain("Variant of Uncertain Significance");
  });

  it("preserves clinical notation that uses a pipe or a magnitude bar", () => {
    /*
     * A blanket `replace(/\|/g, " ")` rewrote clinical text: `|ΔΔG|` lost its magnitude bars and became
     * a SIGNED value (a different claim), and `p.Gly12Asp|p.Gly12Val` lost an allele separator. A pipe
     * is punctuation only inside a table row.
     */
    const clinical = [
      "### Clinical and Pathogenicity Interpretation",
      "",
      "The magnitude |ΔΔG| > 2 kcal/mol is destabilizing, and the genotype p.Gly12Asp|p.Gly12Val was observed.",
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| REVEL | 0.55 |",
    ].join("\n");

    const summary = summariseNarrative(clinical, { maxChars: 2000 });

    expect(summary.text).toContain("|ΔΔG| > 2 kcal/mol");
    expect(summary.text).toContain("p.Gly12Asp|p.Gly12Val");
    // The table is still flattened, because a pipe there IS punctuation.
    expect(summary.text).not.toContain("| Metric |");
    expect(summary.text).toContain("Metric");
  });

  it("keeps variant notation with underscores intact", () => {
    // The italics rule requires whitespace or an opening paren before the first underscore, so a
    // deletion's coordinates survive. Pinned because the rule is one edit away from eating them.
    const summary = summariseNarrative(
      "### Clinical Interpretation\n\nThe deletion c.123_456del removes a conserved stretch."
    );
    expect(summary.text).toBe("The deletion c.123_456del removes a conserved stretch.");
  });
});

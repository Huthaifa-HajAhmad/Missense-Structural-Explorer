/**
 * narrativeSummary.ts — condense the model's narrative for the working view, without inventing text.
 *
 * WHY THIS EXISTS
 * ---------------
 * The narrative was rendered in full in two places. The Report view's "Executive Summary & Clinical
 * Narrative" section is its home: it is printable, it is covered by the report section toggles, it is
 * what the EHR export and the fingerprint include, and the sidebar labels the Report tab "Clinical
 * narrative". The Insights card also carried the whole thing, verbatim, inside a collapsible panel —
 * the same ~2,500 characters of AI prose in two panes of one viewport.
 *
 * A reader who wants the narrative should have one place to read and cite it. A reader working in the
 * Insights pane wants the clinical conclusion, not the four-section argument. So the Insights card
 * gets a CONDENSED summary and a link to the full text, and the Report keeps the narrative unchanged.
 *
 * WHAT "CONDENSED" MEANS HERE
 * ---------------------------
 * This module never writes prose and never calls a model. It selects and tidies:
 *
 *   1. It prefers the narrative's own clinical section — the heading matching `clinical`,
 *      `pathogenic` or `interpretation` — because that is the part that states the conclusion; the
 *      molecular-shift and visualisation-landmark sections are the argument for it.
 *   2. With no such heading it takes the opening section.
 *   3. It strips markdown emphasis and list markers, because the summary renders as plain text and
 *      a lone `**` in a clinical sentence reads as a typo.
 *   4. It truncates on a SENTENCE boundary, never mid-clause, and tells the caller it did.
 *
 * The caller is required to disclose truncation and to link to the full narrative — a summary that
 * silently stands in for the whole is a different claim from the one the model made. `truncated` and
 * `sourceSection` exist so that disclosure is possible without re-deriving anything.
 *
 * Deliberately dependency-free: `src/shared/` may not import outside itself.
 */

export interface NarrativeSummary {
  /** Plain prose, markdown markers removed. Empty when the input had no prose. */
  text: string;
  /** True when `text` is a prefix of a longer selected section. */
  truncated: boolean;
  /** The heading the summary was taken from, or null when it fell back to the opening. */
  sourceSection: string | null;
}

export interface SummariseNarrativeOptions {
  /**
   * Soft ceiling on the summary, in characters.
   *
   * 420 is roughly five lines at the Insights card's 12.5px measure — long enough for a clinical
   * conclusion, short enough that it does not become the second copy of the narrative this module
   * exists to prevent. Truncation always happens at a sentence boundary, so the real length may be
   * under this value.
   */
  maxChars?: number;
}

/**
 * Headings whose section states the CONCLUSION. Ordered by preference, most specific first.
 *
 * `find` on a single pattern took the FIRST clinical-ish heading, which is not the same thing:
 * "Structural Interpretation of the Model" matches `interpretation` and is the argument, and the
 * server's own rule-based fallback report opens with "Rule-Based Clinical Summary" — process
 * boilerplate — while placing the verdict in "Classification". A reader of the Insights card would
 * have been shown the argument or the boilerplate and told it was the clinical conclusion.
 */
const PREFERRED_HEADINGS: ReadonlyArray<RegExp> = [
  /\bclinical\b.*\b(pathogenicity|interpretation)\b/i,
  /\bpathogenicity\b/i,
  /\bclassification\b/i,
  /\bclinical\b/i,
  /\binterpretation\b/i,
];

/**
 * Symbols a generated heading may open with — the narrative's own headings are emoji-prefixed
 * ("### 🏥 Clinical and Pathogenicity Interpretation"). Stripped from the label only.
 */
const HEADING_PREFIX = /^[^\p{L}\p{N}]+/u;

/**
 * Markdown ATX heading line. Applied to the SELECTED BODY, because the body of a chosen section is
 * normally prose but the fallback path (an empty or heading-only selection) can hand this function a
 * whole document.
 */
const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]+.*$/gm;

/** Markdown heading, captured with its text — used to split the document into sections. */
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*$/;

interface Section {
  heading: string;
  body: string;
}

function splitSections(markdown: string): { heading: string; body: string }[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const match = line.match(HEADING);
    if (match) {
      if (current) sections.push(current);
      current = { heading: match[1].trim(), body: "" };
      continue;
    }
    if (current) current.body += line + "\n";
  }
  if (current) sections.push(current);

  return sections.length > 0 ? sections : [{ heading: "", body: markdown }];
}

/**
 * Strip the markdown this module's input is known to carry, so the summary reads as prose.
 *
 * Ordered deliberately: headings first (a summary that begins "### 🧬 Molecular…" is not prose and
 * the label beside it would be describing a different section), then links and code (they contain
 * characters the emphasis rules would eat), then emphasis, then structural markers, then soft breaks.
 *
 * The soft-break step is load-bearing. A generated narrative wraps its paragraphs at a fixed column,
 * so a single `\n` inside a paragraph is a LAYOUT break, not a semantic one — Markdown renders it as a
 * space. Dropping it left the summary reading "…is predicted.\nLocal helix packing…". A blank line is
 * a real paragraph break and is preserved.
 *
 * Pipes are stripped ONLY from lines that are structurally table rows — a row begins AND ends with one.
 * A blanket `replace(/\|/g, " ")` silently rewrote clinical notation: `|ΔΔG| > 2 kcal/mol` lost its
 * magnitude bars and became a signed value (a different claim), and `p.Gly12Asp|p.Gly12Val` lost the
 * allele separator. Matching on "two or more pipes on the line" is not enough — a sentence carrying
 * `|ΔΔG|` and an allele separator has three and is not a table.
 */
function toProse(markdown: string): string {
  return markdown
    .replace(HEADING_LINE, "")                      // ATX headings
    .replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "")   // thematic breaks (---, ***, ___)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")          // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")        // links -> their text
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")          // inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")              // bold
    .replace(/__([^_]+)__/g, "$1")                  // bold, underscore form
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2")     // italics
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1$2")       // italics, underscore form
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")            // bullet markers
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")          // ordered-list markers
    .replace(/^[ \t]*>[ \t]?/gm, "")                // blockquote markers
    .replace(/^[ \t]*\|[ \t:|-]*\|[ \t]*$/gm, "")   // table delimiter rows -> dropped
    .replace(/^[ \t]*\|.*\|[ \t]*$/gm, row => row.replace(/\|/g, " "))  // table data rows only
    .replace(/\n{2,}/g, "\u0000")                   // paragraph break -> sentinel
    .replace(/\n/g, " ")                            // soft break -> space
    .replace(/\u0000/g, "\n\n")                     // restore paragraph breaks
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut at the last sentence end at or before `maxChars`.
 *
 * A hard cut mid-sentence changes the claim — "the variant is predicted to be" and "the variant is
 * predicted to be pathogenic" are not the same statement, and a clinical reader filling in the rest
 * from context is exactly the failure this avoids. Sentence punctuation only; an abbreviation that
 * ends a sentence early costs a little length and is not a correctness problem.
 */
function truncateOnSentence(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  const window = text.slice(0, maxChars);
  let cut = -1;
  for (const match of window.matchAll(/[.!?](?=\s|$)/g)) {
    cut = match.index + match[0].length;
  }

  if (cut > 0) return { text: window.slice(0, cut).trim(), truncated: true };

  // No sentence boundary inside the window: fall back to a word boundary, and mark it, so the
  // caller still discloses that this is a fragment.
  const lastSpace = window.lastIndexOf(" ");
  const hardCut = lastSpace > 0 ? window.slice(0, lastSpace) : window;
  return { text: hardCut.trim() + "\u2026", truncated: true };
}

/**
 * Select and tidy a narrative for a compact surface.
 *
 * Returns an empty `text` for empty input rather than a placeholder sentence: the caller decides how
 * to describe a missing narrative, and this module cannot know whether it is missing because the run
 * degraded or because synthesis has not been attempted yet.
 */
export function summariseNarrative(
  markdown: string | null | undefined,
  options: SummariseNarrativeOptions = {}
): NarrativeSummary {
  const maxChars = options.maxChars ?? 420;
  const source = (markdown ?? "").trim();
  if (!source) return { text: "", truncated: false, sourceSection: null };

  const sections = splitSections(source);

  /*
   * Preference order, not first-match.
   *
   * A section only qualifies if it HAS prose: a heading whose body is empty would otherwise be
   * selected, produce no text, and (in the previous version) fall back to the whole document while
   * still reporting that heading as the source — so the card rendered the molecular-shift section,
   * led by its raw `###` marker, under the label "Clinical and Pathogenicity Interpretation".
   */
  const withProse = sections.filter(section => toProse(section.body).length > 0);
  const chosen =
    PREFERRED_HEADINGS.map(pattern => withProse.find(section => pattern.test(section.heading))).find(Boolean)
    ?? withProse[0]
    ?? null;

  if (!chosen) {
    // Headings only, or nothing but markup. There is no prose to summarise, and claiming a section
    // would be a label the body cannot support.
    return { text: "", truncated: false, sourceSection: null };
  }

  const { text, truncated } = truncateOnSentence(toProse(chosen.body), maxChars);
  const label = chosen.heading.replace(HEADING_PREFIX, "").trim();

  return {
    text,
    truncated,
    sourceSection: label || null,
  };
}

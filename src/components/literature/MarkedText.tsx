import React from "react";
import { highlightSegments, type VariantForms } from "../../shared/literatureEvidence";

/**
 * Text with the variant notations and the gene symbol marked.
 *
 * The marks are the same literal matches `readMentions` counted, so a chip that says "Names p.Asp116Gly"
 * can always be checked by eye against a highlighted run in the title or abstract. Colour alone is not
 * the signal: `data-kind` also changes weight and underline, and the matched text stays in the
 * accessible name (a `<mark>` is announced by screen readers that support it, and read as plain text
 * by those that do not).
 */
export function MarkedText({ text, gene, forms }: { text: string; gene: string; forms: VariantForms | null }) {
  const segments = highlightSegments(text, gene, forms);
  return (
    <>
      {segments.map((s, i) =>
        s.kind ? (
          <mark key={i} className="lit-mark" data-kind={s.kind}>
            {s.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </>
  );
}

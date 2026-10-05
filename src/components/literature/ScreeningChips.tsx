import React from "react";
import type { ScreeningTag } from "../../shared/literatureScreening";

const labels: Record<ScreeningTag["tag"], string> = {
  "names-variant": "Variant named",
  "names-gene": "Gene named",
  "functional-assay": "Functional",
  "clinical-case": "Clinical case",
  mechanism: "Mechanism",
  review: "Review",
  preprint: "Preprint",
  "full-text-only": "Full-text only",
  "same-residue": "Same residue",
  "multi-variant": "Multi-variant",
  "model-system": "Model system",
};

function tone(tag: ScreeningTag): "accent" | "neutral" | "muted" {
  if (tag.tag === "names-variant") return "accent";
  if (["review", "preprint", "multi-variant", "full-text-only", "model-system"].includes(tag.tag)) return "muted";
  return "neutral";
}

export function ScreeningChips({ tags }: { tags: readonly ScreeningTag[] }) {
  const shown = tags.slice(0, 3);
  return (
    <>
      {shown.map(tag => (
        <span
          key={tag.tag}
          className={`ev-tier${tag.source === "lexicon" ? " lit-screening-chip--lexicon" : ""}`}
          data-tone={tone(tag)}
          title={tag.source === "lexicon" ? "lexical match — verify in the abstract" : `${tag.source}: ${tag.quote}`}
        >
          {labels[tag.tag]}
        </span>
      ))}
      {tags.length > shown.length && <span className="ev-tier" data-tone="muted" title={tags.slice(3).map(tag => labels[tag.tag]).join(", ")}>+{tags.length - shown.length}</span>}
    </>
  );
}

export { labels as screeningTagLabels };

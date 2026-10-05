import type { PaperReading } from "../../shared/literatureEvidence";
import type { ScreeningTagName } from "../../shared/literatureScreening";

export type TierFilter = "readFirst" | "readNext" | "all";

/** Pure local narrowing: screening observations combine with AND semantics. */
export function filterByScreening(
  papers: readonly PaperReading[],
  tier: TierFilter,
  tags: readonly ScreeningTagName[],
): PaperReading[] {
  return papers.filter(paper => {
    const inTier = tier === "all"
      || (tier === "readFirst" && paper.screening.tier <= 2)
      || (tier === "readNext" && paper.screening.tier >= 3 && paper.screening.tier <= 4);
    return inTier && tags.every(tag => paper.screening.tags.some(item => item.tag === tag));
  });
}

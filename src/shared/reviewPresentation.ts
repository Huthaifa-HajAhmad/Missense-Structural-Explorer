import type { PaperReading, MentionLevel } from './literatureEvidence';

/** Disjoint literal-mention groups. Denominator is the loaded set, never the search hit count. */
export function literatureCoverage(papers: readonly PaperReading[]) {
  const levels: MentionLevel[] = ['variant', 'gene', 'elsewhere'];
  return levels.map(level => {
    const count = papers.filter(p => p.mentions.level === level).length;
    return { level, count, total: papers.length, percent: papers.length ? count / papers.length * 100 : 0 };
  });
}

export const READING_DESK_LIMIT = 8;

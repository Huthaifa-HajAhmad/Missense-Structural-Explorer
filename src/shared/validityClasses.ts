/**
 * GenCC gene–disease validity classes: one list that the tab, the comparison matrix and the inspector
 * reference all read.
 *
 * INVARIANTS
 *  - Only Limited, Moderate, Strong and Definitive form a graded strength scale. Disputed and Refuted
 *    contest the relationship; they are not "weaker" rungs of the same scale.
 *  - Supportive, Animal model only and No known relationship are not grades. GenCC describes Supportive
 *    as "a basic level of evidence ... such as that used by OMIM and Orphanet": a resource that does not
 *    grade, not a level between Limited and Moderate.
 *  - A term outside the nine is kept as submitted and listed as unlisted, never forced onto a class.
 *
 * Defect this replaced: an eight-rung scale that placed Supportive between Limited and Moderate, ranked
 * Disputed and Refuted below Limited, and left Animal Model Only out of the reference.
 *
 * Definitions are short paraphrases of the GenCC FAQ (https://thegencc.org/faq/).
 */
export type ValidityGroup = 'graded' | 'contested' | 'ungraded';
export interface ValidityClass {
  key: string; label: string; group: ValidityGroup;
  /** Dispute, refutation or no known relationship: shown first, with a warning tone. */
  caution: boolean; definition: string;
}

/** Strongest first, then contested, then ungraded: the order every list and sort uses. */
export const VALIDITY_CLASSES: readonly ValidityClass[] = [
  { key: 'definitive', label: 'Definitive', group: 'graded', caution: false, definition: 'The gene’s role in this disease has been shown repeatedly in research and clinical diagnosis, and upheld over time (at least 2 independent publications over 3 years). No convincing evidence contradicts it.' },
  { key: 'strong', label: 'Strong', group: 'graded', caution: false, definition: 'Repeated, independent human evidence gives very strong support for a causal role, with no conflicting evidence.' },
  { key: 'moderate', label: 'Moderate', group: 'graded', caution: false, definition: 'Moderate human evidence supports a causal role, with no contradictory evidence.' },
  { key: 'limited', label: 'Limited', group: 'graded', caution: false, definition: 'Little human evidence supports a causal role.' },
  { key: 'disputed', label: 'Disputed', group: 'contested', caution: true, definition: 'Other evidence of equal weight disputes the claimed relationship.' },
  { key: 'refuted', label: 'Refuted', group: 'contested', caution: true, definition: 'New valid evidence refutes the whole original body of evidence.' },
  { key: 'supportive', label: 'Supportive', group: 'ungraded', caution: false, definition: 'A basic level of evidence for an association, as used by OMIM and Orphanet. It is not a grade between Limited and Moderate.' },
  { key: 'animal-model', label: 'Animal model only', group: 'ungraded', caution: false, definition: 'Little or no human evidence, but a convincing animal model.' },
  { key: 'no-known', label: 'No known relationship', group: 'ungraded', caution: true, definition: 'No disease claim has ever been made for this gene, in any organism.' },
];

/** The graded scale, weakest to strongest. */
export const GRADED_VALIDITY = VALIDITY_CLASSES.filter(c => c.group === 'graded').reverse();

const ALIASES: Record<string, string> = { 'no known disease relationship': 'no known relationship' };
export function validityClass(level: string): ValidityClass | null {
  const name = level.trim().toLowerCase().replace(/\s+evidence$/, '');
  const wanted = ALIASES[name] ?? name;
  return VALIDITY_CLASSES.find(c => c.label.toLowerCase() === wanted) ?? null;
}
/** Rung on the graded scale (0 = Limited … 3 = Definitive), or null for a class that is not graded. */
export function validityRung(level: string): number | null {
  const cls = validityClass(level);
  const i = cls ? GRADED_VALIDITY.indexOf(cls) : -1;
  return i < 0 ? null : i;
}
/** Sort key: strongest first, unknown terms last. */
export function validityOrder(level: string): number {
  const cls = validityClass(level);
  return cls ? VALIDITY_CLASSES.indexOf(cls) : VALIDITY_CLASSES.length;
}

export interface ValidityReference { classes: Array<ValidityClass & { count: number }>; unlisted: string[] }
/** Every class with how many of this disease's submissions use it; unknown terms are kept apart. */
export function validityReference(levels: readonly string[]): ValidityReference {
  const counts = new Map<string, number>(); const unlisted: string[] = [];
  for (const level of levels) {
    const cls = validityClass(level);
    if (cls) counts.set(cls.key, (counts.get(cls.key) ?? 0) + 1);
    else if (!unlisted.includes(level)) unlisted.push(level);
  }
  return { classes: VALIDITY_CLASSES.map(c => ({ ...c, count: counts.get(c.key) ?? 0 })), unlisted };
}

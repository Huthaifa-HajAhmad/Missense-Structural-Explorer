import { describe, expect, it } from 'vitest';
import { GRADED_VALIDITY, VALIDITY_CLASSES, validityClass, validityOrder, validityReference, validityRung } from '../validityClasses';

// Source: GenCC FAQ, https://thegencc.org/faq/ (read 2026-11-27). It lists nine terms and describes
// "Supportive" as "a basic level of evidence ... such as that used by OMIM and Orphanet".
describe('GenCC validity classes', () => {
  it('lists all nine GenCC terms once, including Animal Model Only', () => {
    expect(VALIDITY_CLASSES.map(c => c.label)).toEqual(['Definitive', 'Strong', 'Moderate', 'Limited', 'Disputed', 'Refuted',
      'Supportive', 'Animal model only', 'No known relationship']);
  });
  it('grades only Limited to Definitive; Supportive is not a rung between Limited and Moderate', () => {
    expect(GRADED_VALIDITY.map(c => c.label)).toEqual(['Limited', 'Moderate', 'Strong', 'Definitive']);
    expect(validityRung('Supportive')).toBeNull();
    expect(validityClass('Supportive')?.group).toBe('ungraded');
  });
  it('keeps the qualifiers that separate the top three grades', () => {
    expect(validityClass('Definitive')?.definition).toMatch(/at least 2 independent publications over 3 years/);
    for (const level of ['Definitive', 'Strong', 'Moderate']) expect(validityClass(level)?.definition).toMatch(/contradict|conflicting/);
  });
  it('reads the export spellings of each term', () => {
    expect(validityClass('Disputed Evidence')?.key).toBe('disputed');
    expect(validityClass('Refuted Evidence')?.key).toBe('refuted');
    expect(validityClass('No Known Disease Relationship')?.key).toBe('no-known');
    expect(validityClass(' Animal Model Only ')?.key).toBe('animal-model');
    expect(validityRung('Definitive')).toBe(3);
    expect(validityClass('Probable')).toBeNull();
  });
  it('flags dispute, refutation and "no known relationship" for caution, and nothing else', () => {
    expect(VALIDITY_CLASSES.filter(c => c.caution).map(c => c.key)).toEqual(['disputed', 'refuted', 'no-known']);
  });
  it('orders known classes strongest first and unknown terms last', () => {
    const sorted = ['Limited', 'Probable', 'Definitive', 'Supportive'].sort((a, b) => validityOrder(a) - validityOrder(b));
    expect(sorted).toEqual(['Definitive', 'Limited', 'Supportive', 'Probable']);
  });
  it('counts this disease’s submissions per class and keeps unlisted terms visible', () => {
    const ref = validityReference(['Strong', 'Strong Evidence', 'Supportive', 'Probable']);
    expect(ref.classes.find(c => c.key === 'strong')?.count).toBe(2);
    expect(ref.classes.find(c => c.key === 'supportive')?.count).toBe(1);
    expect(ref.classes.find(c => c.key === 'definitive')?.count).toBe(0);
    expect(ref.unlisted).toEqual(['Probable']);
  });
});

import { describe, expect, it } from 'vitest';
import { EXPLANATION_TEACHING } from '../explanationTeaching';

describe('illustrative teaching calculations', () => {
  it('keeps the LLR example consistent with log(alternate/native)', () => {
    const example = EXPLANATION_TEACHING.llr;
    expect(example.kind).toBe('example');
    if (example.kind !== 'example') throw new Error('Missing example');
    const [native, alternate, ratio] = example.values.map(v => parseFloat(v.value));
    expect(alternate / native).toBe(ratio);
    expect(example.explanation).toContain(Math.log(ratio).toFixed(2).replace('-', '−'));
    expect(example.heading).toMatch(/illustrative/i);
  });
  it('uses assessed allele copies as the frequency denominator', () => {
    const example = EXPLANATION_TEACHING.allele_frequency;
    if (example.kind !== 'example') throw new Error('Missing frequency example');
    const [ac, an, frequency] = example.values.map(v => v.value.replaceAll(',', ''));
    const expected = Number(ac) / Number(an);
    expect(parseFloat(frequency)).toBe(expected);
    expect(frequency).toContain(`${expected * 100}%`);
    expect(example.explanation).toMatch(/not people/);
    expect(example.heading).toMatch(/illustrative/i);
  });
});

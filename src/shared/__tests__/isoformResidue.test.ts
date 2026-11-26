import { describe, expect, it } from 'vitest';
import { mapIsoformResidue } from '../isoformResidue';

/** 32 residues with no repeated stretch, so every window of 11 or more occurs once. */
const CORE = 'QWERTYIPLKHGFDSNMVCAELMNPRSTVWYA';
const at = (sequence: string, position: number) => sequence[position - 1];

describe('placing a residue on another isoform', () => {
  it('follows the neighbourhood when the other isoform has a longer start', () => {
    expect(mapIsoformResidue(CORE, `MSTT${CORE}`, 16, at(CORE, 16))).toBe(20);
  });

  it('uses the shorter window left at either end of the protein', () => {
    expect(mapIsoformResidue(CORE, `MSTT${CORE}`, 1, at(CORE, 1))).toBe(5);
    expect(mapIsoformResidue(CORE, `${CORE}GGGG`, CORE.length, at(CORE, CORE.length))).toBe(CORE.length);
  });

  it('refuses a neighbourhood that occurs twice', () => {
    expect(mapIsoformResidue(CORE, `${CORE}${CORE}`, 16, at(CORE, 16))).toBeNull();
  });

  it('refuses when any residue of the neighbourhood differs, including the variant site itself', () => {
    const swapped = (position: number) => `${CORE.slice(0, position - 1)}K${CORE.slice(position)}`;
    expect(mapIsoformResidue(CORE, swapped(16), 16, at(CORE, 16))).toBeNull();
    expect(mapIsoformResidue(CORE, swapped(26), 16, at(CORE, 16))).toBeNull();
    // Ten residues each side count; the eleventh is outside the window.
    expect(mapIsoformResidue(CORE, swapped(27), 16, at(CORE, 16))).toBe(16);
  });

  it('refuses a wild type that is not on the source sequence', () => {
    expect(mapIsoformResidue(CORE, CORE, 16, 'K')).toBeNull();
    expect(mapIsoformResidue(CORE, CORE, CORE.length + 1, 'A')).toBeNull();
  });
});

/**
 * When the structure rule examined several experimental chains and refused them all, the record names
 * the first one refused. This sentence says how many others were examined and refused, so the one
 * named chain is not read as the only one checked.
 */
export function otherRefusedChainsText(refused: { otherChainsRefused?: number }): string {
  const n = refused.otherChainsRefused ?? 0;
  if (n <= 0) return "";
  return `${n} other examined chain${n === 1 ? " was" : "s were"} not usable either.`;
}

/** Why no experimental structure was used when none has coordinates for the residue; reads mid-sentence. */
export function unmodelledSiteText(refused: { unmodelledResidue: number; entries: number }): string {
  const residue = refused.unmodelledResidue;
  return refused.entries === 1
    ? `the only solved structure spanning residue ${residue} has no coordinates for it`
    : `none of the ${refused.entries} solved structures spanning residue ${residue} has coordinates for it`;
}

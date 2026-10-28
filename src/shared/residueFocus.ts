/**
 * A residue selection that carries companions: the selected residue plus others a surface wants drawn
 * with it, such as the two cysteines of a disulfide bond or the residues PDBe-KB places at one interface.
 *
 * The selection itself stays a single residue (`selectedResidueIndex`), because the inspector, the
 * Landscape and the structure facts all read one position. The companions are only for the canvas.
 * They are set together with the selection and cleared by the next selection of any kind.
 */
export interface ResidueFocus {
  /** UniProt numbering, ascending, never the selected residue itself. */
  companions: readonly number[];
  /** What the set is and where it comes from, shown beside the viewer. */
  label: string;
}

/** An interface this large is not a patch worth drawing as sticks; the canvas would be all stick. */
export const MAX_FOCUS_COMPANIONS = 200;

/** The focus for `primary` with `companions`, or null when no valid companion remains. */
export function residueFocus(primary: number, companions: readonly number[], label: string): ResidueFocus | null {
  const kept = [...new Set(companions)].filter(r => Number.isInteger(r) && r >= 1 && r !== primary).sort((a, b) => a - b);
  return kept.length && kept.length <= MAX_FOCUS_COMPANIONS ? { companions: kept, label } : null;
}

export interface FocusedSelection {
  index: number;
  focus: ResidueFocus | null;
}

/**
 * "View in 3D" for a UniProt feature row. A disulfide bond is two cysteines, so both are drawn; any other
 * row selects its first residue, or the variant residue when the row covers it.
 */
export function disulfideSelection(
  row: { start: number; end: number; isPair: boolean; covers: boolean },
  variantResidue: number
): FocusedSelection {
  const index = row.covers ? variantResidue : row.start;
  const focus = row.isPair
    ? residueFocus(index, [row.start, row.end], `Disulfide bond between Cys${row.start} and Cys${row.end}`)
    : null;
  return { index, focus };
}

/**
 * "Show interface in 3D" for one partner seen in solved structures. The variant residue is the selection
 * (it is already drawn as the variant site); the partner's interface residues are the companions. Returns
 * null when there is nothing to select.
 */
export function interfaceSelection(
  partner: { label: string; residues: readonly number[]; n: number },
  variantResidue: number | null
): FocusedSelection | null {
  const index = variantResidue ?? partner.residues[0];
  if (!index) return null;
  const structures = partner.n === 1 ? "1 solved structure" : `${partner.n} solved structures`;
  return {
    index,
    focus: residueFocus(
      index,
      partner.residues,
      `${partner.label} interface: ${partner.residues.length} residues observed in ${structures} (PDBe-KB), not computed on this model`
    )
  };
}

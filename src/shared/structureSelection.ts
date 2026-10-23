import { indexStructureResidues } from './coordinateText';
import type { ResidueAt } from './coordinateText';
import { formatResidueCount } from './foldingLimits';
import { ALPHAFOLD_DB_MAX_MODELLED_AA } from './alphafoldAvailability';

export { indexStructureResidues };
import type { Structure3dEvidence } from './structure3dEvidence';

export interface StructurePick { chain: string; resName: string; insertionCode: string; /** Picked on the superposed variant, not the primary coordinates. */ secondary?: boolean }

/**
 * Residue numbers link only where the entry is numbered by UniProt. A site that is merely absent from
 * the coordinates (a disordered loop) does not call the numbering into question; a residue-identity
 * mismatch does.
 */
function numberingTrusted(model: Structure3dEvidence): boolean {
  return model.canvas.primary?.numbering === 'uniprot' && model.site.check.state !== 'mismatch';
}

export function canLinkStructurePick(model: Structure3dEvidence, residues: ReadonlyMap<number, ResidueAt>, position: number, pick?: StructurePick): boolean {
  const residue = residues.get(position);
  return numberingTrusted(model) && !!residue && (!pick || (!pick.secondary && !pick.insertionCode.trim() &&
    pick.chain.trim().toUpperCase() === residue.chain && pick.resName.trim().toUpperCase() === residue.resName));
}

/** The position a canvas pick may write to the shared selection, or null when it must be ignored. */
export function linkedPickPosition(active: boolean, model: Structure3dEvidence, residues: ReadonlyMap<number, ResidueAt>, position: number | null, pick?: StructurePick): number | null {
  return active && position && canLinkStructurePick(model, residues, position, pick) ? position : null;
}

export interface StructureSelection {
  preview?: boolean;
  position: number | null;
  state: 'empty' | 'unmapped' | 'missing' | 'available';
  summary: string;
  residue: ResidueAt | null;
  measurement: { label: string; value: string; note: string } | null;
  source: string | null;
}

/** Selected-residue facts always come from the primary canvas, never the queried variant's metrics. */
export function buildStructureSelection(model: Structure3dEvidence, residues: ReadonlyMap<number, ResidueAt>, position: number | null): StructureSelection {
  const base = { position, residue: null, measurement: null, source: model.canvas.primary?.name ?? null };
  if (!position) return { ...base, state: 'empty', summary: 'Select a residue in Landscape or on the structure.' };
  if (!numberingTrusted(model)) {
    // A protein past AlphaFold DB's ceiling has no full-length predicted model to switch to, so
    // suggesting one would send the reader after coordinates that cannot exist.
    const summary = model.alphaFold?.coverage === 'beyond-limit'
      ? `Selection retained, but this structure’s numbering is not verified against UniProt. AlphaFold DB has no full-length model for a protein this long (its single-chain limit is ${formatResidueCount(ALPHAFOLD_DB_MAX_MODELLED_AA)} aa), so a UniProt-numbered predicted model cannot be offered here; a mapped experimental entry is the only way to inspect this position in 3D.`
      : 'Selection retained, but this structure’s numbering is not verified against UniProt. Switch to a UniProt-numbered model (e.g. AlphaFold) to inspect it in 3D.';
    return { ...base, state: 'unmapped', summary };
  }
  const residue = residues.get(position);
  if (!residue) return { ...base, state: 'missing', summary: 'Selection retained. No uniquely mapped Cα atom is available at this position in the current model.' };
  const channel = model.canvas.primary!.channel;
  const b = residue.caBFactor;
  const copied = channel.inherited ? 'Template ' : 'Cα ';
  const measurement = b === null ? null : channel.kind === 'plddt' && channel.scale
    ? { label: `${copied}pLDDT${channel.inherited ? ' (copied)' : ''}`, value: (b * 100 / channel.scale).toFixed(1), note: channel.note }
    : channel.kind === 'temperature-factor'
      ? { label: `${copied}B-factor${channel.inherited ? ' (copied)' : ''}`, value: `${b.toFixed(1)} Å²`, note: channel.note } : null;
  return { ...base, state: 'available', residue, measurement, summary: `${residue.resName} ${position} · chain ${residue.chain || '(unnamed)'}` };
}

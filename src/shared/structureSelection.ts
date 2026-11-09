import { indexStructureResidues } from './coordinateText';
import type { CaTrace, ResidueAt } from './coordinateText';
import { formatResidueCount } from './foldingLimits';
import { ALPHAFOLD_DB_MAX_MODELLED_AA } from './alphafoldAvailability';
import { AMINO_ACID_3_TO_1, AMINO_ACID_FULL_NAME } from './aminoAcids';
import { plddtBand } from './structure3dEvidence';
import { formatSecondaryShort, secondaryAt, type ModelSecondary, type SecondaryAt, type SecondarySource } from './structureSecondary';
import { betweenDomainsAt, regionsAt, type BetweenDomains, type RegionFeature, type RegionHit } from './residueRegions';

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

/** What the selection is read against, besides the evidence model: all optional, all from the canvas or UniProt. */
export interface SelectionContext {
  /** Secondary structure Mol* assigned to the drawn primary model. */
  secondary?: ModelSecondary | null;
  /** UniProt features (UniProt numbering). */
  features?: readonly RegionFeature[] | null;
  /** Cα coordinates of the drawn primary model, for the distance to the variant site. */
  trace?: CaTrace | null;
}

export interface StructureSelection {
  preview?: boolean;
  position: number | null;
  state: 'empty' | 'unmapped' | 'missing' | 'available';
  /** True only when this selection is at the queried variant site on a structure with verified UniProt numbering. */
  isQueriedSite?: boolean;
  summary: string;
  residue: ResidueAt | null;
  /** "Serine": the residue's name, from the coordinates. */
  residueName?: string | null;
  measurement: { label: string; value: string; note: string } | null;
  /** AlphaFold DB's band for the pLDDT reading; null for B-factors and unknown columns. */
  band?: { label: string; color: number } | null;
  secondary?: SecondaryAt | null;
  secondarySource?: SecondarySource | null;
  /** UniProt annotations that contain the residue (UniProt numbering, so valid in every non-empty state). */
  regions?: RegionHit[];
  betweenDomains?: BetweenDomains | null;
  /** Cα–Cα distance to the queried site on the drawn model, and the sequence gap in residue numbers. */
  siteDistance?: { angstrom: number; separation: number } | null;
  source: string | null;
}

function caDistance(trace: CaTrace | null | undefined, a: number, b: number): number | null {
  if (!trace) return null;
  const i = trace.residues.indexOf(a);
  const j = trace.residues.indexOf(b);
  if (i < 0 || j < 0) return null;
  const c = trace.coords;
  return Math.hypot(c[3 * i] - c[3 * j], c[3 * i + 1] - c[3 * j + 1], c[3 * i + 2] - c[3 * j + 2]);
}

/** Selected-residue facts always come from the primary canvas, never the queried variant's metrics. */
export function buildStructureSelection(model: Structure3dEvidence, residues: ReadonlyMap<number, ResidueAt>, position: number | null, context: SelectionContext = {}): StructureSelection {
  const base = { position, isQueriedSite: false, residue: null, measurement: null, source: model.canvas.primary?.name ?? null };
  if (!position) return { ...base, state: 'empty', summary: 'Select a residue in Landscape or on the structure.' };
  const annotations = { regions: regionsAt(context.features, position), betweenDomains: betweenDomainsAt(context.features, position) };
  if (!numberingTrusted(model)) {
    // A protein past AlphaFold DB's ceiling has no full-length predicted model to switch to, so
    // suggesting one would send the reader after coordinates that cannot exist.
    const summary = model.alphaFold?.coverage === 'beyond-limit'
      ? `Selection retained, but this structure’s numbering is not verified against UniProt. AlphaFold DB has no full-length model for a protein this long (its single-chain limit is ${formatResidueCount(ALPHAFOLD_DB_MAX_MODELLED_AA)} aa), so a UniProt-numbered predicted model cannot be offered here; a mapped experimental entry is the only way to inspect this position in 3D.`
      : 'Selection retained, but this structure’s numbering is not verified against UniProt. Switch to a UniProt-numbered model (e.g. AlphaFold) to inspect it in 3D.';
    return { ...base, ...annotations, state: 'unmapped', summary };
  }
  const residue = residues.get(position);
  if (!residue) return { ...base, ...annotations, state: 'missing', summary: 'Selection retained. No uniquely mapped Cα atom is available at this position in the current model.' };
  const channel = model.canvas.primary!.channel;
  const b = residue.caBFactor;
  const copied = channel.inherited ? 'Template ' : 'Cα ';
  const plddt = b !== null && channel.kind === 'plddt' && channel.scale ? b * 100 / channel.scale : null;
  const measurement = b === null ? null : plddt !== null
    ? { label: `${copied}pLDDT${channel.inherited ? ' (copied)' : ''}`, value: plddt.toFixed(1), note: channel.note }
    : channel.kind === 'temperature-factor'
      ? { label: `${copied}B-factor${channel.inherited ? ' (copied)' : ''}`, value: `${b.toFixed(1)} Å²`, note: channel.note } : null;
  const band = plddt === null ? null : plddtBand(plddt);
  const sitePosition = model.site.position;
  const isQueriedSite = model.site.canAddressVariantSite && sitePosition !== null && position === sitePosition;
  const distance = !isQueriedSite && sitePosition !== null && model.site.canAddressVariantSite ? caDistance(context.trace, position, sitePosition) : null;
  const one = AMINO_ACID_3_TO_1[residue.resName];
  return {
    ...base,
    ...annotations,
    state: 'available',
    isQueriedSite,
    residue,
    residueName: one ? AMINO_ACID_FULL_NAME[one] ?? null : null,
    measurement,
    band: band ? { label: band.label, color: band.color } : null,
    secondary: secondaryAt(context.secondary ?? null, position),
    secondarySource: context.secondary?.source ?? null,
    siteDistance: distance === null ? null : { angstrom: distance, separation: Math.abs(position - sitePosition!) },
    summary: `${residue.resName} ${position} · chain ${residue.chain || '(unnamed)'}`,
  };
}

/** One row of a canvas callout: a short label, the value, and an optional qualifier. */
export interface CalloutFact {
  label: string;
  value: string;
  note?: string;
}

/**
 * The rows a canvas callout prints for a residue, most structural first: where it sits in the fold,
 * how confident the model is there, and how far it is from the variant site. UniProt annotation stays
 * in the rail: it is the longest string and the least structural fact.
 */
export function selectionCalloutFacts(selection: StructureSelection): CalloutFact[] {
  const facts: CalloutFact[] = [];
  if (selection.secondary) facts.push({ label: "Fold", value: formatSecondaryShort(selection.secondary) });
  if (selection.measurement) {
    const plddt = /plddt/i.test(selection.measurement.label);
    facts.push({
      label: plddt ? "Confidence" : "B-factor",
      value: selection.measurement.value,
      note: selection.band ? selection.band.label.toLowerCase() : undefined,
    });
  }
  if (selection.siteDistance) {
    facts.push({
      label: "To site",
      value: `${selection.siteDistance.angstrom.toFixed(1)} Å`,
      note: `Cα–Cα · ${selection.siteDistance.separation} apart in sequence`,
    });
  }
  return facts;
}

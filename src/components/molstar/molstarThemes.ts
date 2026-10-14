/**
 * molstarThemes.ts — the 3D view's Mol* colour themes.
 *
 * Every band and colour comes from `STRUCTURE_COLOUR_BANDS` / `THRESHOLDS.esm3Drift` in
 * `src/shared/thresholds`, which the on-canvas legend reads too, so the canvas and its key cannot
 * disagree. Which theme a structure gets is decided by `src/shared/structure3dEvidence.ts` from
 * provenance — never here, and never from the B-factor values themselves.
 *
 * Replaced: a pLDDT theme that assumed 0–100 (ESM Atlas writes 0–1, so every residue came out "very
 * low"); a B-factor theme banded at 20/40/60 Å² with no source (B-factors are not comparable across
 * entries); an "ESM3 Allosteric" theme banded at 0.05/0.15/0.35 while the engine used 0.08/0.22/0.38.
 */
import { StructureElement, StructureProperties, Unit, Bond } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import { ColorTheme } from "molstar/lib/mol-theme/color";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";
import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";
import { STRUCTURE_COLOUR_BANDS, THRESHOLDS } from "../../shared/thresholds";

export type { PocketResidue, PocketResult } from "../../types";

const NONE = Color(STRUCTURE_COLOUR_BANDS.none);

/**
 * Wraps a per-atom colour function into a Mol* theme: bonds take their first atom's colour, and any
 * non-atomic location is "not covered".
 */
function atomTheme(
  ctx: any,
  props: any,
  factory: any,
  description: string,
  colorOf: (unit: Unit.Atomic, element: number, location: StructureElement.Location) => Color
) {
  let color = (_location: any) => NONE;
  if (ctx.structure) {
    const scratch = StructureElement.Location.create(ctx.structure.root);
    const atomColor = (location: StructureElement.Location) => {
      const { unit, element } = location;
      if (!Unit.isAtomic(unit)) return NONE;
      return colorOf(unit, element, location);
    };
    color = (location: any) => {
      if (StructureElement.Location.is(location)) return atomColor(location);
      if (Bond.isLocation(location)) {
        scratch.unit = location.aUnit;
        scratch.element = location.aUnit.elements[location.aIndex];
        return atomColor(scratch);
      }
      return NONE;
    };
  }
  return { factory, granularity: "group" as any, preferSmoothing: true, color, props, description };
}

/* ── pLDDT, AlphaFold DB bands, on either stored scale ─────────────────── */

export const PlddtThemeParams = {
  /** 100 when the file stores 0–100 (AlphaFold DB, ESMFold2), 1 when it stores 0–1 (ESM Atlas). */
  scale: PD.Numeric(100, { min: 1, max: 100, step: 99 }),
};

export function plddtColor(raw: number, scale: number): Color {
  if (!Number.isFinite(raw) || raw < 0) return NONE;
  const value = scale === 1 ? raw * 100 : raw;
  const band = STRUCTURE_COLOUR_BANDS.plddt.find(b => value > b.min) ?? STRUCTURE_COLOUR_BANDS.plddt[3];
  return Color(band.color);
}

export function PlddtColorTheme(ctx: any, props: any) {
  const scale = props?.scale === 1 ? 1 : 100;
  return atomTheme(ctx, props, PlddtColorTheme, "pLDDT, AlphaFold DB bands", (unit, element) =>
    plddtColor(unit.model.atomicConformation.B_iso_or_equiv.value(element), scale)
  );
}

export const PlddtColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: "plddt-confidence",
  label: "pLDDT (AlphaFold DB bands)",
  category: ColorThemeCategory.Validation,
  factory: PlddtColorTheme,
  getParams: () => PlddtThemeParams,
  defaultValues: PD.getDefaultValues(PlddtThemeParams),
  isApplicable: (ctx: any) => !!ctx.structure,
};

/* ── Crystallographic B-factor, by quartile of this structure ──────────── */

/** Quartile cuts of Cα B-factors over the structure the theme is applied to. */
function caQuartiles(structure: any): [number, number, number] | null {
  const values: number[] = [];
  const loc = StructureElement.Location.create(structure.root);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    loc.unit = unit;
    const els = unit.elements;
    for (let i = 0; i < els.length; i++) {
      loc.element = els[i];
      if (StructureProperties.atom.label_atom_id(loc) !== "CA") continue;
      const b = unit.model.atomicConformation.B_iso_or_equiv.value(els[i]);
      if (Number.isFinite(b)) values.push(b);
    }
  }
  if (values.length < 4) return null;
  values.sort((a, b) => a - b);
  const q = (p: number) => {
    const pos = (values.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? values[lo] : values[lo] + (values[hi] - values[lo]) * (pos - lo);
  };
  return [q(0.25), q(0.5), q(0.75)];
}

export function BFactorQuartileColorTheme(ctx: any, props: any) {
  const cuts = ctx.structure ? caQuartiles(ctx.structure) : null;
  const colours = STRUCTURE_COLOUR_BANDS.bFactorQuartile.map(b => Color(b.color));
  return atomTheme(ctx, props, BFactorQuartileColorTheme, "B-factor quartile within this entry", (unit, element) => {
    if (!cuts) return NONE;
    const b = unit.model.atomicConformation.B_iso_or_equiv.value(element);
    if (!Number.isFinite(b)) return NONE;
    return b <= cuts[0] ? colours[0] : b <= cuts[1] ? colours[1] : b <= cuts[2] ? colours[2] : colours[3];
  });
}

export const BFactorQuartileColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: "bfactor-quartile",
  label: "B-factor (quartiles of this entry)",
  category: ColorThemeCategory.Validation,
  factory: BFactorQuartileColorTheme,
  getParams: () => ({}),
  defaultValues: {},
  isApplicable: (ctx: any) => !!ctx.structure,
};

/* ── Cα displacement after superposition (the aligner writes Å into B) ─── */

export function displacementColor(value: number): Color {
  if (!Number.isFinite(value)) return NONE;
  const band = STRUCTURE_COLOUR_BANDS.displacement.find(b => value < b.max) ?? STRUCTURE_COLOUR_BANDS.displacement[4];
  return Color(band.color);
}

export function DisplacementColorTheme(ctx: any, props: any) {
  return atomTheme(ctx, props, DisplacementColorTheme, "Cα displacement after superposition (app-defined bands)", (unit, element) =>
    displacementColor(unit.model.atomicConformation.B_iso_or_equiv.value(element))
  );
}

export const DisplacementColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: "backbone-displacement",
  label: "Cα displacement (app-defined bands)",
  category: ColorThemeCategory.Validation,
  factory: DisplacementColorTheme,
  getParams: () => ({}),
  defaultValues: {},
  isApplicable: (ctx: any) => !!ctx.structure,
};

/* ── ESM3 embedding shift, the engine's own bands ───────────────────────── */

export const Esm3ShiftThemeParams = {
  perturbationScores: PD.Value<number[]>([], { isEssential: true }),
};

export function esm3ShiftColor(score: number | null | undefined): Color {
  if (score === null || score === undefined || !Number.isFinite(score) || score < 0) return NONE;
  const d = THRESHOLDS.esm3Drift;
  const c = STRUCTURE_COLOUR_BANDS.esm3Shift;
  return Color(score < d.none ? c[0] : score < d.minor ? c[1] : score < d.moderate ? c[2] : c[3]);
}

export function Esm3ShiftColorTheme(ctx: any, props: any) {
  const scores: number[] = props?.perturbationScores || [];
  return atomTheme(ctx, props, Esm3ShiftColorTheme, "Sequence embedding shift (app-defined bands)", (_unit, _element, location) => {
    // Scores are indexed by UniProt position; the model only offers this theme on UniProt-numbered structures.
    const seq = StructureProperties.residue.auth_seq_id(location);
    return esm3ShiftColor(seq > 0 && seq <= scores.length ? scores[seq - 1] : null);
  });
}

export const Esm3ShiftColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: "esm3-shift",
  label: "Sequence embedding shift",
  category: ColorThemeCategory.Validation,
  factory: Esm3ShiftColorTheme,
  getParams: () => Esm3ShiftThemeParams,
  defaultValues: PD.getDefaultValues(Esm3ShiftThemeParams),
  isApplicable: (ctx: any) => !!ctx.structure,
};

export const STRUCTURE_THEME_PROVIDERS = [
  PlddtColorThemeProvider,
  BFactorQuartileColorThemeProvider,
  DisplacementColorThemeProvider,
  Esm3ShiftColorThemeProvider,
];

export function isValidPdbUrl(url: string): boolean {
  if (!url) return false;
  // Protocol-relative ("//host/…") is an external origin, and `fetchWithAuth` would send it the
  // session credentials; it used to pass as a "local" path because it starts with "/".
  if (url.startsWith("//") || url.startsWith("\\")) return false;
  if (url.startsWith("/") || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const allowedDomains = ["alphafold.ebi.ac.uk", "files.rcsb.org", "pdbe.org", "www.ebi.ac.uk"];
    return allowedDomains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith("." + domain));
  } catch {
    return false;
  }
}

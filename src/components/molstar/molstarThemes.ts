/**
 * molstarThemes.ts — Molstar color themes, interfaces, and utilities.
 * Extracted from MolstarViewer.tsx. No React imports needed.
 */
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection, StructureElement, StructureProperties, Unit, Bond } from "molstar/lib/mol-model/structure";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra/3d/vec3";
import { Color } from "molstar/lib/mol-util/color";
import { ColorTheme } from "molstar/lib/mol-theme/color";
import { TableLegend } from "molstar/lib/mol-util/legend";
import { ColorThemeCategory } from "molstar/lib/mol-theme/color/categories";

// Pocket coordinate-level structures
export interface PocketResidue {
  index: number;
  name: string;
  distance: number;
  score: number;
  role: string;
  type: string;
}

export interface PocketResult {
  pocketResidues: PocketResidue[];
  pocketScore: number;
  pocketVolume: number;
  likelyCofactor: string;
  pocketDistance: number | null;
  status?: string;
}

const CustomPLDDTColors = {
  'No Score': Color(0xaaaaaa),
  'Very Low': Color(0xff7d45),
  'Low': Color(0xffdb13),
  'Confident': Color(0x65cbf3),
  'Very High': Color(0x0053d6)
};

const CustomPLDDTLegend = TableLegend(Object.entries(CustomPLDDTColors) as any);

export function CustomPLDDTColorTheme(ctx: any, props: any) {
  let color = (location: any) => Color(0xaaaaaa);
  
  if (ctx.structure) {
    const l = StructureElement.Location.create(ctx.structure.root);
    
    const getColor = (location: any) => {
      const { unit, element } = location;
      if (!Unit.isAtomic(unit)) return Color(0xaaaaaa);
      
      const score = unit.model.atomicConformation.B_iso_or_equiv.value(element);
      
      if (score < 0 || typeof score !== 'number') {
        return Color(0xaaaaaa);
      } else if (score <= 50) {
        return Color(0xff7d45); // Orange/Red
      } else if (score <= 70) {
        return Color(0xffdb13); // Yellow
      } else if (score <= 90) {
        return Color(0x65cbf3); // Cyan
      } else {
        return Color(0x0053d6); // Blue
      }
    };
    
    color = (location: any) => {
      if (StructureElement.Location.is(location)) {
        return getColor(location);
      } else if (Bond.isLocation(location)) {
        l.unit = location.aUnit;
        l.element = location.aUnit.elements[location.aIndex];
        return getColor(l);
      }
      return Color(0xaaaaaa);
    };
  }
  
  return {
    factory: CustomPLDDTColorTheme,
    granularity: 'group' as any,
    preferSmoothing: true,
    color,
    props,
    description: 'Custom pLDDT confidence coloring based on PDB B-factors',
    legend: CustomPLDDTLegend
  };
}

export const CustomPLDDTColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: 'plddt-confidence',
  label: 'pLDDT Confidence (B-factor)',
  category: ColorThemeCategory.Validation,
  factory: CustomPLDDTColorTheme,
  getParams: () => ({}),
  defaultValues: {},
  isApplicable: (ctx: any) => !!ctx.structure
};

export function CustomBFactorColorTheme(ctx: any, props: any) {
  let color = (location: any) => Color(0xaaaaaa);
  if (ctx.structure) {
    const l = StructureElement.Location.create(ctx.structure.root);
    const getColor = (location: any) => {
      const { unit, element } = location;
      if (!Unit.isAtomic(unit)) return Color(0xaaaaaa);
      const score = unit.model.atomicConformation.B_iso_or_equiv.value(element);
      if (score === null || score === undefined || typeof score !== 'number') {
        return Color(0xaaaaaa);
      } else if (score < 20) {
        return Color(0x0053d6); // Blue (Highly Rigid)
      } else if (score < 40) {
        return Color(0x65cbf3); // Cyan (Stable)
      } else if (score < 60) {
        return Color(0xffdb13); // Yellow (Moderately Mobile)
      } else {
        return Color(0xff7d45); // Orange/Red (Highly Mobile)
      }
    };
    color = (location: any) => {
      if (StructureElement.Location.is(location)) return getColor(location);
      if (Bond.isLocation(location)) {
        l.unit = location.aUnit;
        l.element = location.aUnit.elements[location.aIndex];
        return getColor(l);
      }
      return Color(0xaaaaaa);
    };
  }
  return {
    factory: CustomBFactorColorTheme,
    granularity: 'group' as any,
    preferSmoothing: true,
    color,
    props,
    description: 'Custom B-factor mobility coloring based on PDB temperature factors',
    legend: TableLegend(Object.entries({
      'Highly Rigid (<20)': Color(0x0053d6),
      'Stable (20-40)': Color(0x65cbf3),
      'Moderately Mobile (40-60)': Color(0xffdb13),
      'Highly Mobile (>60)': Color(0xff7d45),
    }) as any)
  };
}

export const CustomBFactorColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: 'bfactor-mobility',
  label: 'B-factor / Mobility',
  category: ColorThemeCategory.Validation,
  factory: CustomBFactorColorTheme,
  getParams: () => ({}),
  defaultValues: {},
  isApplicable: (ctx: any) => !!ctx.structure
};

export function CustomDisplacementColorTheme(ctx: any, props: any) {
  let color = (location: any) => Color(0x3b82f6);
  if (ctx.structure) {
    const l = StructureElement.Location.create(ctx.structure.root);
    const getColor = (location: any) => {
      const { unit, element } = location;
      if (!Unit.isAtomic(unit)) return Color(0x3b82f6);
      const score = unit.model.atomicConformation.B_iso_or_equiv.value(element);
      if (score === null || score === undefined || typeof score !== 'number' || isNaN(score)) {
        return Color(0x3b82f6);
      } else if (score < 0.2) {
        return Color(0x3b82f6); // Negligible (<0.2 Å) Blue
      } else if (score < 0.5) {
        return Color(0x65cbf3); // Minor (0.2-0.5 Å) Cyan/Light Blue
      } else if (score < 1.0) {
        return Color(0x10b981); // Moderate (0.5-1.0 Å) Green
      } else if (score < 2.5) {
        return Color(0xf59e0b); // Significant (1.0-2.5 Å) Orange/Yellow
      } else {
        return Color(0xef4444); // Severe (>=2.5 Å) Red
      }
    };
    color = (location: any) => {
      if (StructureElement.Location.is(location)) return getColor(location);
      if (Bond.isLocation(location)) {
        l.unit = location.aUnit;
        l.element = location.aUnit.elements[location.aIndex];
        return getColor(l);
      }
      return Color(0x3b82f6);
    };
  }
  return {
    factory: CustomDisplacementColorTheme,
    granularity: 'group' as any,
    preferSmoothing: true,
    color,
    props,
    description: 'Custom backbone Cα displacement heatmap coloring',
    legend: TableLegend(Object.entries({
      'Negligible (<0.2 Å)': Color(0x3b82f6),
      'Minor (0.2-0.5 Å)': Color(0x65cbf3),
      'Moderate (0.5-1.0 Å)': Color(0x10b981),
      'Significant (1.0-2.5 Å)': Color(0xf59e0b),
      'Severe (≥2.5 Å)': Color(0xef4444)
    }) as any)
  };
}

export const CustomDisplacementColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: 'backbone-displacement',
  label: 'Backbone Displacement (heatmap)',
  category: ColorThemeCategory.Validation,
  factory: CustomDisplacementColorTheme,
  getParams: () => ({}),
  defaultValues: {},
  isApplicable: (ctx: any) => !!ctx.structure
};

export function CustomESM3AllostericColorTheme(ctx: any, props: any) {
  let color = (location: any) => Color(0x38bdf8);
  const perturbationScores: number[] = props?.perturbationScores || [];
  if (ctx.structure) {
    const l = StructureElement.Location.create(ctx.structure.root);
    const getColor = (location: any) => {
      const { unit, element } = location;
      if (!Unit.isAtomic(unit)) return Color(0x38bdf8);
      const seqNum = StructureProperties.residue.auth_seq_id(location);
      const score = (perturbationScores && seqNum > 0 && seqNum <= perturbationScores.length)
        ? perturbationScores[seqNum - 1]
        : -1;
      if (score === null || score === undefined || score < 0 || isNaN(score)) return Color(0x94a3b8); // Uncomputed Grey
      if (score <= 0.05) return Color(0x38bdf8); // Unperturbed Ice Cyan
      if (score <= 0.15) return Color(0x34d399); // Minor Emerald
      if (score <= 0.35) return Color(0xf59e0b); // Moderate Amber
      return Color(0xe11d48); // High Disruption Rose/Crimson
    };
    color = (location: any) => {
      if (StructureElement.Location.is(location)) return getColor(location);
      if (Bond.isLocation(location)) {
        l.unit = location.aUnit;
        l.element = location.aUnit.elements[location.aIndex];
        return getColor(l);
      }
      return Color(0x38bdf8);
    };
  }
  return {
    factory: CustomESM3AllostericColorTheme,
    granularity: 'group' as any,
    preferSmoothing: true,
    color,
    props,
    description: 'ESM3 Allosteric Disruption Heatmap',
    legend: TableLegend(Object.entries({
      'No Data / Uncomputed': Color(0x94a3b8),
      'Unperturbed (<0.05)': Color(0x38bdf8),
      'Minor Shift (0.05-0.15)': Color(0x34d399),
      'Moderate Shift (0.15-0.35)': Color(0xf59e0b),
      'Severe Allosteric Hub (>0.35)': Color(0xe11d48),
    }) as any)
  };
}

import { ParamDefinition as PD } from "molstar/lib/mol-util/param-definition";

export const CustomESM3AllostericColorThemeParams = {
  perturbationScores: PD.Value<number[]>([], { isEssential: true })
};

export function getCustomESM3AllostericColorThemeParams(ctx: any) {
  return CustomESM3AllostericColorThemeParams;
}

export const CustomESM3AllostericColorThemeProvider: ColorTheme.Provider<any, any> = {
  name: 'esm3-allosteric',
  label: 'ESM3 Allosteric Perturbation',
  category: ColorThemeCategory.Validation,
  factory: CustomESM3AllostericColorTheme,
  getParams: getCustomESM3AllostericColorThemeParams,
  defaultValues: PD.getDefaultValues(CustomESM3AllostericColorThemeParams),
  isApplicable: (ctx: any) => !!ctx.structure
};

export function isValidPdbUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("/") || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const allowedDomains = [
      "alphafold.ebi.ac.uk",
      "files.rcsb.org",
      "pdbe.org",
      "www.ebi.ac.uk"
    ];
    return allowedDomains.some(domain => 
      parsed.hostname === domain || parsed.hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

// Declare custom property to store selection status or custom controls if needed
export interface MolstarViewerProps {
  residueIndex: number | null;
  customPdbData?: string;
  customPdbUrl?: string;
  active3dModelTab?: "alphafold2" | "esm3";
  onModelTabChange?: (tab: "alphafold2" | "esm3") => void;
  uniprotId?: string;
  gene?: string;
  showPolarContacts?: boolean;
  theme?: "dark" | "light";
  onResidueHover?: (index: number | null) => void;
  onResidueClick?: (index: number | null) => void;
  comparePdbData?: string | null;
  compareResidueIndex?: number | null;
  compareVariant?: string | null;
  disruptionWarning?: {
    type: "both" | "clash" | "hbond";
    title: string;
    description: string;
  } | null;
  mutantStatus?: string | null;
  mutantDdG?: number | null;
  heightClass?: string;
  variant?: string;
  residueColorHex?: number;
  cameraDuration?: number;
  autoZoomOnSelect?: boolean;
  neonHighContrast?: boolean;
  energyUnit?: string;
  fetchNearestResidues?: any;
  onPdbTextLoaded?: (text: string) => void;
  computedPocket?: PocketResult | null;
  isPocketLoading?: boolean;
  pocketError?: string | null;
  pdbId?: string | null;
  pdbSource?: string | null;
  metrics?: any | null;
  viewMode?: "wildtype" | "mutant";
}

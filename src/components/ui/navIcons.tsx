import type { ComponentType } from "react";
/* Remix ships only a root entry (no per-icon subpaths). Measured: a cold dev prebundle of the whole
   barrel is ~180 ms and cached afterwards, and production tree-shakes to the glyphs named here. */
import {
  RiDnaLine, RiBarChartBoxLine, RiBox3Line, RiPulseLine, RiMap2Line,
  RiFlaskLine, RiBookOpenLine, RiFileTextLine, RiTerminalBoxLine, RiInformationLine,
  RiGroupLine, RiStethoscopeLine, RiSoundModuleLine, RiBearSmileLine,
  RiShapesLine, RiCpuLine, RiSparklingLine, RiScissorsLine, RiCrosshair2Line,
  RiWaterFlashLine, RiLinksLine, RiAtomLine, RiBrainLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import type { EvidenceTabId } from "../../shared/insightsEvidence";

/** Shared Remix outline glyphs keep each view recognisable in navigation, search and About. */
export type NavIcon = ComponentType<{ className?: string }>;

function navGlyph(Glyph: RemixiconComponentType, name: string): NavIcon {
  const Glyphed: NavIcon = ({ className }) => <Glyph className={className} aria-hidden="true" />;
  Glyphed.displayName = `${name}Nav`;
  return Glyphed;
}

/** Top-level views. */
export const NAV_ICONS = {
  /** The query page. A DNA strand, not a magnifier: the header's search bar owns the magnifier. */
  query: navGlyph(RiDnaLine, "Query"),
  evidence: navGlyph(RiBarChartBoxLine, "Evidence"),
  structure: navGlyph(RiBox3Line, "Structure"),
  energetics: navGlyph(RiPulseLine, "Energetics"),
  landscape: navGlyph(RiMap2Line, "Landscape"),
  insights: navGlyph(RiFlaskLine, "Insights"),
  literature: navGlyph(RiBookOpenLine, "Literature"),
  report: navGlyph(RiFileTextLine, "Report"),
  console: navGlyph(RiTerminalBoxLine, "Console"),
  about: navGlyph(RiInformationLine, "About"),
} as const;

/** The two 3D model pages — the only nested pages that are views rather than Evidence tabs. */
export type StructureModelId = "structure_alphafold" | "structure_esmfold";

/**
 * Nested pages, keyed by the page id the sidebar renders. A `Record` over the union of ids, not an
 * index signature: a tab added without a glyph is then a compile error instead of a row that renders
 * a blank 15px column (which is what the e2e had to catch before).
 *
 * Note `structure` here is the Evidence tab "Residue shifts & pockets", not the 3D structure view —
 * the sidebar's own `NAV_ICONS.structure` is the cube.
 */
export const SUB_NAV_ICONS: Record<EvidenceTabId | StructureModelId, NavIcon> = {
  clinical: navGlyph(RiGroupLine, "Population"),
  "gene-disease": navGlyph(RiStethoscopeLine, "GeneDisease"),
  "expression-models": navGlyph(RiSoundModuleLine, "Expression"),
  "species-models": navGlyph(RiBearSmileLine, "Species"),
  function: navGlyph(RiShapesLine, "Functional"),
  predictors: navGlyph(RiCpuLine, "Predictors"),
  alphagenome: navGlyph(RiSparklingLine, "AlphaGenome"),
  splicing: navGlyph(RiScissorsLine, "Splicing"),
  structure: navGlyph(RiCrosshair2Line, "Residue"),
  perturbation: navGlyph(RiWaterFlashLine, "Perturbation"),
  interfaces: navGlyph(RiLinksLine, "Interfaces"),
  structure_alphafold: navGlyph(RiAtomLine, "AlphaFold"),
  structure_esmfold: navGlyph(RiBrainLine, "Esmfold"),
};

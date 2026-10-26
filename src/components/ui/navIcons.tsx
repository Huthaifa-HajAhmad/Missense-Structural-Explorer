import type { ComponentType } from "react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
/* One import per icon: the package ships ~1,500 glyphs in six weights, and the root entry would
   make the dev server pre-bundle all of them. */
import { AtomIcon } from "@phosphor-icons/react/dist/csr/Atom";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { CpuIcon } from "@phosphor-icons/react/dist/csr/Cpu";
import { CrosshairIcon } from "@phosphor-icons/react/dist/csr/Crosshair";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { DnaIcon } from "@phosphor-icons/react/dist/csr/Dna";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FlaskIcon } from "@phosphor-icons/react/dist/csr/Flask";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { PawPrintIcon } from "@phosphor-icons/react/dist/csr/PawPrint";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { ScissorsIcon } from "@phosphor-icons/react/dist/csr/Scissors";
import { ShapesIcon } from "@phosphor-icons/react/dist/csr/Shapes";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { StethoscopeIcon } from "@phosphor-icons/react/dist/csr/Stethoscope";
import { TerminalIcon } from "@phosphor-icons/react/dist/csr/Terminal";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WaveformIcon } from "@phosphor-icons/react/dist/csr/Waveform";
import { WavesIcon } from "@phosphor-icons/react/dist/csr/Waves";
import type { EvidenceTabId } from "../../shared/insightsEvidence";

/**
 * NAVIGATION GLYPHS
 *
 * Wayfinding icons (sidebar rows, the About map, the palette's view results, the inspector header)
 * are Phosphor outlines. Everything else in the app is still lucide: those are action glyphs inside
 * a panel, and they are allowed to differ. The rule that matters is that a *view* has exactly one
 * glyph — read it from `NAV_ICONS` / `SUB_NAV_ICONS` rather than picking a lucide icon that looks
 * close, or the rail and the inspector will name the same page with two different shapes.
 */

/** A navigation glyph. `className` is the only prop: one weight and one optical size are chosen
 *  here, so a call site cannot reintroduce a second icon style into the rail by accident. */
export type NavIcon = ComponentType<{ className?: string }>;

/** One weight for the whole navigation, so every glyph in the rail matches. Outline: the solid
 *  weight turns several glyphs (links, waves, pulse) into blobs at 15px. */
const NAV_ICON_WEIGHT: IconWeight = "regular";

function navGlyph(Glyph: PhosphorIcon, name: string): NavIcon {
  const Glyphed: NavIcon = ({ className }) => <Glyph weight={NAV_ICON_WEIGHT} className={className} aria-hidden="true" />;
  Glyphed.displayName = `${name}Nav`;
  return Glyphed;
}

/** Top-level views. */
export const NAV_ICONS = {
  /** The query page. A DNA strand, not a magnifier: the header's search bar owns the magnifier. */
  query: navGlyph(DnaIcon, "Query"),
  evidence: navGlyph(ChartBarIcon, "Evidence"),
  structure: navGlyph(CubeIcon, "Structure"),
  energetics: navGlyph(PulseIcon, "Energetics"),
  landscape: navGlyph(MapTrifoldIcon, "Landscape"),
  insights: navGlyph(FlaskIcon, "Insights"),
  literature: navGlyph(BookOpenIcon, "Literature"),
  report: navGlyph(FileTextIcon, "Report"),
  console: navGlyph(TerminalIcon, "Console"),
  about: navGlyph(InfoIcon, "About"),
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
  clinical: navGlyph(UsersIcon, "Population"),
  "gene-disease": navGlyph(StethoscopeIcon, "GeneDisease"),
  "expression-models": navGlyph(WaveformIcon, "Expression"),
  "species-models": navGlyph(PawPrintIcon, "Species"),
  function: navGlyph(ShapesIcon, "Functional"),
  predictors: navGlyph(CpuIcon, "Predictors"),
  alphagenome: navGlyph(SparkleIcon, "AlphaGenome"),
  splicing: navGlyph(ScissorsIcon, "Splicing"),
  structure: navGlyph(CrosshairIcon, "Residue"),
  perturbation: navGlyph(WavesIcon, "Perturbation"),
  interfaces: navGlyph(LinkSimpleIcon, "Interfaces"),
  structure_alphafold: navGlyph(AtomIcon, "AlphaFold"),
  structure_esmfold: navGlyph(BrainIcon, "Esmfold"),
};

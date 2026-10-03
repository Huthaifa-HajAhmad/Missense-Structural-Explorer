import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "./harness.css";
import { FunctionTab } from "../../src/components/evidence/FunctionInteractionsTabs";
import type { AnalysisResult, AnalysisState } from "../../src/types";
import type { TabComponentProps } from "../../src/components/evidence/types";
import type { UniprotFeaturesData } from "../../src/shared/contracts";
import { NAE1_UNIPROT } from "../../src/shared/__tests__/fixtures/nae1FunctionalDomains";

/**
 * Geometry + behaviour assertions for the Functional domains tab's domain-architecture schematic.
 *
 * WHY A BROWSER: every promise the schematic makes is measured geometry — a mark at the residue it
 * names, labels that never overlap, a stem that starts on the backbone's edge, contrast of the marks
 * against the card, 24px hit targets, a visible focus ring. jsdom has no layout engine, no SVG bbox,
 * no computed colour and no `:focus-visible`, so vitest cannot see any of it.
 *
 * The expectations are written from the fixtures and from the drawing rules in
 * `architectureLayout.ts`'s header, never read back from the layout function: an expectation derived
 * from the implementation cannot notice the implementation being wrong. Each mark's residue comes from
 * its `data-residue` attribute and is mapped through the backbone's measured ends.
 *
 * Fixtures: NAE1 (Q13564, the reference variant p.Asp116Gly, with InterPro matches via UniParc and
 * PDB secondary structure), and the real CNNM2 (Q9H8M5) and GZF1 (Q9H116) feature tables the earlier
 * track harness used; plus one synthetic crowded cluster that exercises tier overflow and a met PM1.
 */

/* ── Fixtures ─────────────────────────────────────────────────────────────────── */

/** CNNM2 / Q9H8M5 (875 aa): UniProt Domain features, three TM helices, no InterPro in the payload. */
const CNNM2: UniprotFeaturesData = {
  geneName: "CNNM2",
  sequenceLength: 875,
  domainMatchesStatus: "error",
  features: [
    { type: "Transmembrane", description: "Helical", start: 251, end: 271 },
    { type: "Transmembrane", description: "Helical", start: 339, end: 359 },
    { type: "Transmembrane", description: "Helical", start: 369, end: 389 },
    { type: "Domain", description: "CNNM transmembrane", start: 251, end: 431, interproId: "IPR002550" },
    { type: "Domain", description: "CBS 1", start: 450, end: 511 },
    { type: "Domain", description: "CBS 2", start: 518, end: 584 },
    { type: "Region", description: "Disordered", start: 121, end: 151 },
    { type: "Region", description: "Disordered", start: 742, end: 763 },
    { type: "Modified residue", description: "Phosphoserine", start: 761, end: 761, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "24275569" }] },
  ],
} as UniprotFeaturesData;

/** GZF1 / Q9H116 (711 aa): ten C2H2 zinc fingers of 23–24 aa in a row, the label-collision case. */
const GZF1: UniprotFeaturesData = {
  geneName: "GZF1",
  sequenceLength: 711,
  domainMatchesStatus: "error",
  features: [
    { type: "Domain", description: "BTB", start: 31, end: 103, interproId: "IPR000210" },
    ...Array.from({ length: 10 }, (_, i) => {
      const starts = [317, 348, 377, 407, 435, 463, 491, 519, 547, 575];
      const ends = [340, 371, 400, 429, 457, 485, 513, 541, 569, 597];
      return { type: "Zinc finger", description: `C2H2-type ${i + 1}`, start: starts[i], end: ends[i] };
    }),
    { type: "Region", description: "Disordered", start: 153, end: 220 },
    { type: "Region", description: "Disordered", start: 243, end: 312 },
    { type: "Compositional bias", description: "Low complexity", start: 153, end: 168 },
    { type: "Modified residue", description: "Phosphoserine", start: 613, end: 613, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "23186163" }] },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 32, end: 32, change: { from: "C", to: ["A"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "16611996" }] },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 50, end: 50, change: { from: "L", to: ["A"] }, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "16611996" }] },
  ],
} as UniprotFeaturesData;

/**
 * SYNTHETIC crowded cluster — not a real protein. Six point sites in eleven residues, more than three
 * tiers can label; an experimentally evidenced active site AT the variant (so PM1 is met); and a
 * disulfide bond whose two cysteines straddle the variant, which must be drawn as two cysteines and
 * must not count as covering 204.
 */
const CROWDED: UniprotFeaturesData = {
  geneName: "CROWDED",
  sequenceLength: 500,
  domainMatchesStatus: "ok",
  domainMatches: [{ database: "Pfam", accession: "PF00001", interpro: { id: "IPR000001", name: "Test catalytic domain" }, locations: [{ start: 150, end: 300 }] }],
  features: [
    { type: "Binding site", description: "substrate", start: 200, end: 200, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "1" }] },
    { type: "Binding site", description: "substrate", start: 202, end: 202, evidence: [{ code: "ECO:0000250", source: "UniProtKB", id: "P00001" }] },
    { type: "Active site", description: "Proton acceptor", start: 204, end: 204, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "2" }] },
    { type: "Binding site", description: "substrate", start: 206, end: 206, evidence: [{ code: "ECO:0000255" }] },
    { type: "Binding site", description: "substrate", start: 208, end: 208 },
    { type: "Metal binding", description: "Zn", start: 210, end: 210, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "3" }] },
    { type: "Disulfide bond", start: 180, end: 230, evidence: [{ code: "ECO:0000269", source: "PubMed", id: "4" }] },
    { type: "Region", description: "Disordered", start: 420, end: 470 },
  ],
} as UniprotFeaturesData;

/**
 * SLC12A4 / Q9UP95 (1085 aa), p.Gln867His — a 12-helix membrane transporter. Topology and TM positions are
 * the UniProt feature table as shown on the tab; sites are a subset. The variant sits in the cytoplasmic
 * C-terminal domain, between helices 855–866 and 869–871 of PDB 6KKR.
 */
const E = (id: string): Array<{ code: string; source: string; id: string }> => [{ code: "ECO:0000269", source: "PubMed", id }];
const TM_SPANS: Array<[number, number]> = [[120, 141], [150, 172], [197, 225], [249, 271], [272, 297], [420, 440], [451, 473], [505, 531], [555, 575], [576, 598], [613, 635], [636, 651]];
const TOPO: Array<[string, number, number]> = [["Cytoplasmic", 1, 119], ["Extracellular", 142, 149], ["Cytoplasmic", 173, 196], ["Extracellular", 226, 248], ["Extracellular", 298, 419], ["Cytoplasmic", 441, 450], ["Extracellular", 474, 504], ["Cytoplasmic", 532, 554], ["Cytoplasmic", 599, 612], ["Cytoplasmic", 652, 1085]];
const SLC12A4: UniprotFeaturesData = {
  geneName: "SLC12A4",
  sequenceLength: 1085,
  reviewed: true,
  domainMatchesStatus: "ok",
  domainMatches: [
    { database: "Pfam", accession: "PF03522", interpro: { id: "IPR018491", name: "SLC12A transporter, C-terminal" }, locations: [{ start: 709, end: 824 }, { start: 840, end: 1085 }] },
    { database: "Pfam", accession: "PF00324", interpro: { id: "IPR004841", name: "Amino acid permease/SLC12A domain" }, locations: [{ start: 124, end: 300 }, { start: 418, end: 695 }] },
    { database: "Gene3D", accession: "G3DSA:1.20.1740.10", interpro: null, locations: [{ start: 118, end: 666 }] },
  ],
  secondaryStructure: [
    { kind: "helix", start: 855, end: 866, pdb: "6KKR" },
    { kind: "helix", start: 869, end: 871, pdb: "6KKR" },
  ],
  features: [
    ...TOPO.map(([d, a, b]) => ({ type: "Topological domain", description: d, start: a, end: b, evidence: E("31649201") })),
    ...TM_SPANS.map(([a, b], i) => ({ type: "Transmembrane", description: i === 0 ? "Discontinuously helical; Name=1" : `Helical; Name=${i + 1}`, start: a, end: b, evidence: E("31649201") })),
    ...[131, 132, 216].map((r) => ({ type: "Binding site", description: "Ligand: K(+)", start: r, end: r, evidence: E("31649201") })),
    { type: "Binding site", description: "Ligand: chloride", start: 433, end: 433, evidence: [{ code: "ECO:0000305", source: "PubMed", id: "31649201" }] },
    { type: "Mutagenesis", description: "V135A: Decrease in Cl(-) efflux", start: 135, end: 135, change: { from: "V", to: ["A"] }, evidence: E("35759661") },
    { type: "Mutagenesis", description: "I136A: Decrease in Cl(-) efflux", start: 136, end: 136, change: { from: "I", to: ["A"] }, evidence: E("35759661") },
    { type: "Modified residue", description: "Phosphoserine", start: 24, end: 24, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "23186163" }] },
    { type: "Modified residue", description: "Phosphoserine", start: 834, end: 834, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "23186163" }] },
    { type: "Modified residue", description: "Phosphoserine", start: 916, end: 916, evidence: [{ code: "ECO:0007744", source: "PubMed", id: "23186163" }] },
  ],
} as UniprotFeaturesData;

interface Case {
  id: string;
  label: string;
  data: UniprotFeaturesData;
  uniprotId: string;
  residue: number;
  wt: string;
  mut: string;
  width: number;
  dark?: boolean;
  zoom?: boolean;
  /** Press "Whole protein" before measuring, for the cases written against the whole-protein drawing. */
  whole?: boolean;
  /** Membrane-topology lane: transmembrane bars and topological-domain rails the drawing must carry. */
  membrane?: { tm: number; rails: number };
  engine: string[];
  /** Hand-written from the fixture and the PM1 rule. */
  expect: { verdict: string; pins: number; domains: number; hiddenLabels: "none" | "some" };
}

const CASES: Case[] = [
  // NAE1: 4 disease variants above; A2ac, K6ac, UBA3 site 211, D331A, K341ac below = 9 pins. Pfam ThiF = 1 domain box.
  { id: "nae1", label: "NAE1 p.Asp116Gly — the reference variant", data: NAE1_UNIPROT, uniprotId: "Q13564", residue: 116, wt: "D", mut: "G", width: 1010, engine: ["PM2", "PP3"], expect: { verdict: "PM1 not met", pins: 9, domains: 1, hiddenLabels: "none" } },
  // Zoomed to 66–166: R85Q only (L49F at 49 is outside) = 1 pin; the Pfam box is clipped to the window.
  { id: "nae1-zoom", label: "NAE1 p.Asp116Gly — 116 ± 50", data: NAE1_UNIPROT, uniprotId: "Q13564", residue: 116, wt: "D", mut: "G", width: 1010, zoom: true, engine: ["PM2", "PP3"], expect: { verdict: "PM1 not met", pins: 1, domains: 1, hiddenLabels: "none" } },
  { id: "nae1-narrow", label: "NAE1 p.Asp116Gly — phone width", data: NAE1_UNIPROT, uniprotId: "Q13564", residue: 116, wt: "D", mut: "G", width: 380, engine: ["PM2", "PP3"], expect: { verdict: "PM1 not met", pins: 9, domains: 1, hiddenLabels: "some" } },
  { id: "nae1-dark", label: "NAE1 p.Asp116Gly — dark theme", data: NAE1_UNIPROT, uniprotId: "Q13564", residue: 116, wt: "D", mut: "G", width: 1010, dark: true, engine: ["PM2", "PP3"], expect: { verdict: "PM1 not met", pins: 9, domains: 1, hiddenLabels: "none" } },
  // CNNM2: 3 UniProt domains; the phosphoserine is the one pin; TM helices are regions.
  { id: "cnnm2", label: "CNNM2 p.Ser489Cys — inside CBS 1", whole: true, membrane: { tm: 3, rails: 0 }, data: CNNM2, uniprotId: "Q9H8M5", residue: 489, wt: "S", mut: "C", width: 1010, engine: ["PP3"], expect: { verdict: "PM1 not met", pins: 1, domains: 3, hiddenLabels: "none" } },
  // GZF1: 1 domain; 2 mutagenesis + 1 phospho = 3 pins; ten adjacent zinc-finger labels cannot all fit.
  { id: "gzf1", label: "GZF1 p.Arg591Trp — ten adjacent zinc fingers", whole: true, data: GZF1, uniprotId: "Q9H116", residue: 591, wt: "R", mut: "W", width: 1010, engine: [], expect: { verdict: "PM1 not met", pins: 3, domains: 1, hiddenLabels: "some" } },
  // SLC12A4 opened as the tab opens it (1085 aa > 600, so 817–917): sites S834p and S916p = 2 pins; Pfam segments 709–824 and 840–1085 = 2 boxes; helices 855–871 in the window so the strip is drawn; the cytoplasmic rail only.
  { id: "slc12a4", label: "SLC12A4 p.Gln867His — opens on 867 ± 50", data: SLC12A4, uniprotId: "Q9UP95", residue: 867, wt: "Q", mut: "H", width: 1010, membrane: { tm: 0, rails: 1 }, engine: ["PM2"], expect: { verdict: "PM1 not met", pins: 2, domains: 2, hiddenLabels: "none" } },
  // The same protein across its whole length: 12 helices and 10 topological spans; 9 point sites (K+ x3, Cl-, V135A, I136A, S24p, S834p, S916p); 4 Pfam segments; no helix/strand strip.
  { id: "slc12a4-whole", label: "SLC12A4 p.Gln867His — whole protein", whole: true, data: SLC12A4, uniprotId: "Q9UP95", residue: 867, wt: "Q", mut: "H", width: 1010, membrane: { tm: 12, rails: 10 }, engine: ["PM2"], expect: { verdict: "PM1 not met", pins: 9, domains: 4, hiddenLabels: "some" } },
  // CROWDED: 6 point sites + the disulfide drawn as its two cysteines, 180 and 230 = 8 marks.
  { id: "crowded", label: "synthetic crowded cluster, PM1 met", data: CROWDED, uniprotId: "P00000", residue: 204, wt: "H", mut: "A", width: 1010, engine: ["PM1", "PP3"], expect: { verdict: "PM1 met", pins: 8, domains: 1, hiddenLabels: "some" } },
];

function resultFor(c: Case): AnalysisResult {
  return {
    metadata: { gene: c.data.geneName, variant: `p.${c.wt}${c.residue}${c.mut}`, residueIndex: c.residue, wildType: c.wt, mutant: c.mut, uniprotId: c.uniprotId },
    uniprotFeatures: c.data,
    serviceStatus: { uniprotFeatures: "ok" },
    ruleBasedInsights: { acmgCriteria: c.engine.map((code) => ({ code })) },
  } as unknown as AnalysisResult;
}

/* ── Report plumbing ──────────────────────────────────────────────────────────── */
interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const px = (n: number) => Math.round(n * 100) / 100;
const nextFrame = () => new Promise<void>((r) => setTimeout(() => setTimeout(() => r(), 0), 0));

function freezeMotion(): void {
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(style);
}
freezeMotion();

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
function bbox(el: SVGGraphicsElement): Box {
  const b = el.getBBox();
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height };
}
const overlaps = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/* ── Colour ───────────────────────────────────────────────────────────────────── */
/** Chrome serialises color-mix() results as `color(srgb r g b)` in 0–1 units, plain colours as rgb(). */
function parseColor(value: string): [number, number, number] | null {
  const rgb = value.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255];
  return null;
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Reading the schematic ────────────────────────────────────────────────────── */
interface Schematic {
  svg: SVGSVGElement;
  width: number;
  x0: number;
  x1: number;
  bbTop: number;
  bbBottom: number;
  window: { start: number; end: number };
  pins: SVGGElement[];
  query: SVGGElement | null;
  domains: SVGGElement[];
}

function readSchematic(host: HTMLElement): Schematic | string {
  const svg = host.querySelector<SVGSVGElement>('[data-testid="domain-architecture"] svg');
  if (!svg) return "no schematic SVG rendered";
  const backbone = svg.querySelector<SVGRectElement>('[data-testid="arch-backbone"]');
  if (!backbone) return "no backbone";
  const b = bbox(backbone);
  const [start, end] = (svg.getAttribute("data-window") || "").split("-").map(Number);
  return {
    svg,
    width: Number(svg.getAttribute("width")),
    x0: b.left,
    x1: b.right,
    bbTop: b.top,
    bbBottom: b.bottom,
    window: { start, end },
    pins: Array.from(svg.querySelectorAll<SVGGElement>('[data-testid="arch-pin"]')),
    query: svg.querySelector<SVGGElement>('[data-testid="arch-query"]'),
    domains: Array.from(svg.querySelectorAll<SVGGElement>('[data-testid="arch-domain"]')),
  };
}

/** Where residue r must be drawn: the backbone's measured ends are residues `start` and `end`. */
const expectedX = (s: Schematic, r: number) => s.x0 + ((r - s.window.start) / Math.max(1, s.window.end - s.window.start)) * (s.x1 - s.x0);
const headOf = (g: SVGGElement) => g.querySelector<SVGGraphicsElement>("circle, rect:not(.fnd-arch__hit)")!;
const centreX = (el: SVGGraphicsElement) => {
  const b = bbox(el);
  return (b.left + b.right) / 2;
};

/* ── Families ─────────────────────────────────────────────────────────────────── */

const FAMILY_SIZE = { opens: 1, marks: 4, labels: 3, stems: 1, contrast: 2, targets: 1, focus: 1, selection: 2, verdict: 1, zoom: 1, view: 2, membrane: 3, selfCheck: 1 } as const;
type Family = keyof typeof FAMILY_SIZE;
type PerCase = Exclude<Family, "selfCheck" | "opens">;

function family(name: Family, produced: Check[]): Check[] {
  if (produced.length === FAMILY_SIZE[name]) return produced;
  return [...produced, { name: `harness: ${name} produced ${produced.length} assertions, expected ${FAMILY_SIZE[name]}`, pass: false, detail: "update FAMILY_SIZE if deliberate" }];
}

const planFamilies = (c: Case): PerCase[] => ["marks", "labels", "stems", "contrast", "targets", "focus", "selection", "verdict", "view", ...(c.zoom ? (["zoom"] as PerCase[]) : []), ...(c.membrane ? (["membrane"] as PerCase[]) : [])];
// "opens" runs once per case, before any button is pressed, so it is outside planFamilies.
const expectedCheckCount = () => CASES.reduce((n, c) => n + FAMILY_SIZE.opens + planFamilies(c).reduce((m, f) => m + FAMILY_SIZE[f], 0), 0) + FAMILY_SIZE.selfCheck;

function checkMarks(c: Case, s: Schematic): Check[] {
  const off: string[] = [];
  for (const p of s.pins) {
    const r = Number(p.getAttribute("data-residue"));
    const x = centreX(headOf(p));
    if (Math.abs(x - expectedX(s, r)) > 0.5) off.push(`${r}: drawn at ${px(x)}, expected ${px(expectedX(s, r))}`);
    if (x < s.x0 - 0.5 || x > s.x1 + 0.5) off.push(`${r}: outside the backbone`);
  }
  const qx = s.query ? centreX(s.query.querySelector("circle")!) : NaN;
  const domOff: string[] = [];
  for (const d of s.domains) {
    const rect = bbox(d.querySelector("rect")!);
    const a = Math.max(Number(d.getAttribute("data-start")), s.window.start);
    const e = Math.min(Number(d.getAttribute("data-end")), s.window.end);
    if (Math.abs(rect.left - expectedX(s, a)) > 0.75 || Math.abs(rect.right - expectedX(s, e)) > 0.75)
      domOff.push(`${a}–${e}: ${px(rect.left)}–${px(rect.right)}, expected ${px(expectedX(s, a))}–${px(expectedX(s, e))}`);
  }
  return [
    { name: `${c.id}: every mark sits at its residue`, pass: s.pins.length > 0 && off.length === 0, detail: off.length ? off.join("; ") : `${s.pins.length} marks within 0.5px` },
    { name: `${c.id}: the variant is drawn at residue ${c.residue}`, pass: !!s.query && Math.abs(qx - expectedX(s, c.residue)) <= 0.5, detail: s.query ? `x ${px(qx)}, expected ${px(expectedX(s, c.residue))}` : "no query mark" },
    { name: `${c.id}: domain boxes span their residues`, pass: s.domains.length === c.expect.domains && domOff.length === 0, detail: domOff.length ? domOff.join("; ") : `${s.domains.length} boxes (expected ${c.expect.domains})` },
    { name: `${c.id}: the schematic draws the expected marks`, pass: s.pins.length === c.expect.pins, detail: `${s.pins.length} marks, expected ${c.expect.pins}` },
  ];
}

function checkLabels(c: Case, s: Schematic, host: HTMLElement): Check[] {
  const texts = Array.from(s.svg.querySelectorAll<SVGTextElement>("text")).filter((t) => (t.textContent || "").trim());
  const boxes = texts.map((t) => ({ t: t.textContent!, b: bbox(t) }));
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i].b, boxes[j].b)) clashes.push(`"${boxes[i].t}" × "${boxes[j].t}"`);
  const outside = boxes.filter((x) => x.b.left < -0.5 || x.b.right > s.width + 0.5).map((x) => `"${x.t}" ${px(x.b.left)}–${px(x.b.right)}`);
  const hiddenNote = host.querySelector('[data-testid="arch-hidden-labels"]');
  const hiddenOk = c.expect.hiddenLabels === "some" ? true : !hiddenNote;
  // A stem or a mark drawn through a label is as unreadable as two labels on top of each other.
  const lines = Array.from(s.svg.querySelectorAll<SVGLineElement>(".fnd-arch__stem, .fnd-arch__query line"));
  const heads = [...s.pins.map(headOf), ...(s.query ? [s.query.querySelector("circle")!] : [])];
  const crossed: string[] = [];
  for (const t of texts) {
    const b = bbox(t);
    const own = t.closest("g");
    for (const ln of lines) {
      const lx = Number(ln.getAttribute("x1"));
      const [ya, yb] = [Number(ln.getAttribute("y1")), Number(ln.getAttribute("y2"))].sort((m, n) => m - n);
      if (lx > b.left + 0.5 && lx < b.right - 0.5 && yb > b.top + 0.5 && ya < b.bottom - 0.5 && ln.closest("g") !== own) crossed.push(`stem at ${px(lx)} through "${t.textContent}"`);
    }
    for (const h of heads) if (h.closest("g") !== own && overlaps(bbox(h), b)) crossed.push(`mark on "${t.textContent}"`);
  }
  return [
    { name: `${c.id}: no stem or mark crosses a label`, pass: crossed.length === 0, detail: crossed.length ? crossed.slice(0, 5).join("; ") : `${lines.length} stems, ${heads.length} marks clear of every label` },
    { name: `${c.id}: no two labels overlap`, pass: clashes.length === 0, detail: clashes.length ? clashes.slice(0, 6).join("; ") : `${boxes.length} labels, none overlapping${hiddenNote ? `; ${hiddenNote.textContent}` : ""}` },
    { name: `${c.id}: every label is inside the drawing`, pass: outside.length === 0 && hiddenOk, detail: outside.length ? outside.join("; ") : hiddenOk ? `all within 0–${s.width}px` : `labels were dropped where none should be: ${hiddenNote?.textContent}` },
  ];
}

function checkStems(c: Case, s: Schematic): Check[] {
  const bad: string[] = [];
  const stems = Array.from(s.svg.querySelectorAll<SVGLineElement>(".fnd-arch__stem"));
  s.pins.forEach((p, i) => {
    const stem = stems[i];
    const head = bbox(headOf(p));
    const x = centreX(headOf(p));
    if (!stem) return bad.push(`${p.getAttribute("data-residue")}: no stem`);
    const x1 = Number(stem.getAttribute("x1"));
    const y1 = Number(stem.getAttribute("y1"));
    const y2 = Number(stem.getAttribute("y2"));
    if (Math.abs(x1 - x) > 0.5) bad.push(`${p.getAttribute("data-residue")}: stem at ${px(x1)}, head at ${px(x)}`);
    if (p.getAttribute("data-shape") === "dot") {
      // It starts on the top edge of what it stands on: a domain box when there is one, else the backbone.
      const box = s.domains.map((d) => bbox(d.querySelector("rect")!)).find((r) => x >= r.left && x <= r.right);
      const base = box ? box.top : s.bbTop;
      if (Math.abs(y1 - base) > 0.5) bad.push(`${p.getAttribute("data-residue")}: stem starts at ${px(y1)}, ${box ? "domain" : "backbone"} top ${px(base)}`);
      if (y2 < head.bottom - 1.5 || y2 > head.bottom + 0.5) bad.push(`${p.getAttribute("data-residue")}: stem ends at ${px(y2)}, head bottom ${px(head.bottom)}`);
    } else if (y1 < s.bbBottom - 0.5 || y2 > head.top + 1.5) bad.push(`${p.getAttribute("data-residue")}: diamond stem ${px(y1)}–${px(y2)} does not join backbone to head`);
  });
  if (s.query) {
    const line = s.query.querySelector("line")!;
    if (Number(line.getAttribute("y2")) <= s.bbBottom) bad.push("the variant stem stops above the backbone");
    const qTop = bbox(s.query.querySelector("circle")!).top;
    const higher = s.pins.filter((p) => bbox(headOf(p)).top < qTop);
    if (higher.length) bad.push(`${higher.length} marks drawn above the variant`);
  }
  return [{ name: `${c.id}: stems join the backbone to their heads`, pass: bad.length === 0, detail: bad.length ? bad.join("; ") : `${s.pins.length} stems; the variant is highest and crosses the backbone` }];
}

function checkContrast(c: Case, s: Schematic, host: HTMLElement): Check[] {
  const card = host.querySelector(".fnd-card");
  const surface = parseColor(getComputedStyle(card!).backgroundColor);
  if (!surface) return [
    { name: `${c.id}: marks reach 3:1 against the card`, pass: false, detail: "card background unreadable" },
    { name: `${c.id}: labels reach 4.5:1 against the card`, pass: false, detail: "card background unreadable" },
  ];
  const marks: Array<[string, Element | null, "fill" | "stroke"]> = [
    ["variant", s.query?.querySelector("circle") ?? null, "fill"],
    ...s.pins.map((p) => [`${p.getAttribute("data-tone")} ${p.getAttribute("data-residue")}`, headOf(p), p.getAttribute("data-tone") === "inferred" ? "stroke" : "fill"] as [string, Element, "fill" | "stroke"]),
    ...Array.from(s.svg.querySelectorAll(".fnd-arch__structural, .fnd-arch__helix, .fnd-arch__strand")).slice(0, 6).map((el) => [el.getAttribute("class") || "", el, "fill"] as [string, Element, "fill"]),
    // A region is a tinted inset; its outline carries the shape.
    ...Array.from(s.svg.querySelectorAll(".fnd-arch__region rect")).slice(0, 3).map((el) => ["region outline", el, "stroke"] as [string, Element, "stroke"]),
    ...s.domains.map((d) => ["domain outline", d.querySelector("rect"), "stroke"] as [string, Element | null, "stroke"]),
  ];
  const lowMarks: string[] = [];
  for (const [name, el, prop] of marks) {
    if (!el) continue;
    const col = parseColor(getComputedStyle(el)[prop]);
    const ratio = col ? contrast(col, surface) : 0;
    if (ratio < 3) lowMarks.push(`${name} ${px(ratio)}:1`);
  }
  // A domain outline is a boundary drawn with a label inside it; 3:1 applies to the fill-or-outline
  // pair, and the fill is a tint, so the outline is what carries the shape.
  const lowText: string[] = [];
  for (const t of Array.from(s.svg.querySelectorAll<SVGTextElement>("text"))) {
    const col = parseColor(getComputedStyle(t).fill);
    const ratio = col ? contrast(col, surface) : 0;
    if (ratio < 4.5) lowText.push(`"${t.textContent}" ${px(ratio)}:1`);
  }
  return [
    { name: `${c.id}: marks reach 3:1 against the card`, pass: lowMarks.length === 0, detail: lowMarks.length ? lowMarks.join("; ") : `${marks.filter((m) => m[1]).length} marks` },
    { name: `${c.id}: labels reach 4.5:1 against the card`, pass: lowText.length === 0, detail: lowText.length ? lowText.slice(0, 5).join("; ") : "all labels" },
  ];
}

function checkTargets(c: Case, s: Schematic, host: HTMLElement): Check[] {
  const small: string[] = [];
  for (const p of s.pins) {
    const hit = p.querySelector<SVGGraphicsElement>(".fnd-arch__hit");
    const b = hit ? bbox(hit) : null;
    if (!b || b.right - b.left < 24 || b.bottom - b.top < 24) small.push(`mark ${p.getAttribute("data-residue")}`);
  }
  for (const btn of Array.from(host.querySelectorAll<HTMLButtonElement>(".fnd-subject__btn, .fnd-seg > button"))) {
    const r = btn.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) small.push(`button "${(btn.textContent || "").slice(0, 24)}" ${px(r.width)}×${px(r.height)}`);
  }
  return [{ name: `${c.id}: every target is at least 24×24px`, pass: small.length === 0, detail: small.length ? small.slice(0, 6).join("; ") : "marks, row buttons and zoom buttons" }];
}

function checkFocus(c: Case, host: HTMLElement): Check[] {
  const targets = [host.querySelector<HTMLButtonElement>(".fnd-subject__btn"), host.querySelector<HTMLButtonElement>(".fnd-seg > button")].filter(Boolean) as HTMLButtonElement[];
  const blind: string[] = [];
  for (const el of targets) {
    (document.activeElement as HTMLElement | null)?.blur();
    el.focus();
    const cs = getComputedStyle(el);
    if (!el.matches(":focus-visible")) blind.push(`${el.className}: :focus-visible did not match`);
    else if (cs.outlineStyle === "none" || parseFloat(cs.outlineWidth) < 2) blind.push(`${el.className}: outline ${cs.outlineStyle} ${cs.outlineWidth}`);
  }
  (document.activeElement as HTMLElement | null)?.blur();
  return [{ name: `${c.id}: keyboard focus shows a 2px ring`, pass: targets.length === 2 && blind.length === 0, detail: blind.length ? blind.join("; ") : `${targets.length} controls` }];
}

async function checkSelection(c: Case, host: HTMLElement): Promise<Check[]> {
  const s = readSchematic(host);
  if (typeof s === "string" || !s.pins.length) return [
    { name: `${c.id}: clicking a mark opens its row`, pass: false, detail: typeof s === "string" ? s : "no marks" },
    { name: `${c.id}: the row button closes it again`, pass: false, detail: "not reached" },
  ];
  const pin = s.pins[0];
  pin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextFrame();
  const selectedRow = host.querySelector<HTMLTableRowElement>('tr[data-testid="annotation-row"][data-selected]');
  const detail = host.querySelector('[data-testid="annotation-detail"]');
  const pinNow = readSchematic(host);
  const pinSelected = typeof pinNow !== "string" && pinNow.pins[0].hasAttribute("data-selected");
  const first: Check = {
    name: `${c.id}: clicking a mark opens its row`,
    pass: !!selectedRow && !!detail && pinSelected,
    detail: selectedRow ? `opened "${selectedRow.querySelector(".fnd-subject__name")?.textContent}"` : "no row selected",
  };
  selectedRow?.querySelector<HTMLButtonElement>(".fnd-subject__btn")?.click();
  await nextFrame();
  const closed = !host.querySelector('[data-testid="annotation-detail"]');
  return [first, { name: `${c.id}: the row button closes it again`, pass: closed, detail: closed ? "detail closed" : "detail still open" }];
}

function checkVerdict(c: Case, host: HTMLElement): Check[] {
  const chip = host.querySelector('[data-testid="pm1-verdict"]');
  const text = (chip?.textContent || "").trim();
  return [{ name: `${c.id}: the PM1 chip reads "${c.expect.verdict}"`, pass: text === c.expect.verdict, detail: `reads "${text}"` }];
}

async function checkZoom(c: Case, host: HTMLElement): Promise<Check[]> {
  const s = readSchematic(host);
  const want = { start: Math.max(1, c.residue - 50), end: Math.min(c.data.sequenceLength ?? c.residue + 50, c.residue + 50) };
  const ok = typeof s !== "string" && s.window.start === want.start && s.window.end === want.end;
  const outside = typeof s === "string" ? [] : s.pins.map((p) => Number(p.getAttribute("data-residue"))).filter((r) => r < want.start || r > want.end);
  return [{ name: `${c.id}: the zoom shows ${want.start}–${want.end} and only marks inside it`, pass: ok && outside.length === 0, detail: typeof s === "string" ? s : `window ${s.window.start}–${s.window.end}${outside.length ? `; outside: ${outside.join(", ")}` : ""}` }];
}

/** The window a case must be showing, from the fixture and the rule written in the tab, not read back from the layout. */
function windowOf(c: Case, near: boolean): { start: number; end: number } {
  const len = c.data.sequenceLength ?? 0;
  return near ? { start: Math.max(1, c.residue - 50), end: Math.min(len, c.residue + 50) } : { start: 1, end: len };
}

/** The tab opens on the variant's neighbourhood above 600 residues and on the whole protein at or below it. */
function checkOpens(c: Case, host: HTMLElement): Check[] {
  const s = readSchematic(host);
  const want = windowOf(c, (c.data.sequenceLength ?? 0) > 600);
  const ok = typeof s !== "string" && s.window.start === want.start && s.window.end === want.end;
  return [{ name: `${c.id}: opens on ${want.start}–${want.end}`, pass: ok, detail: typeof s === "string" ? s : `opened on ${s.window.start}–${s.window.end}` }];
}

function checkView(c: Case, s: Schematic, host: HTMLElement): Check[] {
  const len = c.data.sequenceLength ?? 0;
  const w = s.window;
  const span = w.end - w.start;
  const ssIn = (c.data.secondaryStructure ?? []).some((e) => e.kind !== "turn" && e.end >= w.start && e.start <= w.end);
  const wantStrip = ssIn && span <= 300;
  const strips = s.svg.querySelectorAll(".fnd-arch__helix, .fnd-arch__strand").length;
  const stripCheck: Check = {
    name: `${c.id}: the helix / strand strip is drawn only in a window of 300 residues or fewer`,
    pass: wantStrip ? strips > 0 : strips === 0,
    detail: `window ${span + 1} residues, ${ssIn ? "structure in window" : "no structure in window"}, ${strips} strip shapes (expected ${wantStrip ? "some" : "none"})`,
  };
  const wantOverview = !(w.start === 1 && w.end === len);
  const ov = host.querySelector<SVGSVGElement>('[data-testid="arch-overview"]');
  let detail = wantOverview ? "no overview strip" : "none (whole protein)";
  let pass = wantOverview ? false : !ov;
  if (wantOverview && ov) {
    const track = ov.querySelector<SVGLineElement>(".fnd-arch__ov-track")!;
    const tx0 = Number(track.getAttribute("x1"));
    const tx1 = Number(track.getAttribute("x2"));
    const at = (r: number) => tx0 + ((r - 1) / (len - 1)) * (tx1 - tx0);
    const win = bbox(ov.querySelector<SVGGraphicsElement>('[data-testid="arch-overview-window"]')!);
    const dot = ov.querySelector<SVGCircleElement>(".fnd-arch__ov-query");
    const dotOk = !!dot && Math.abs(Number(dot.getAttribute("cx")) - at(c.residue)) <= 0.5;
    pass = Math.abs(win.left - at(w.start)) <= 0.75 && Math.abs(win.right - at(w.end)) <= 0.75 && dotOk;
    detail = `bracket ${px(win.left)}–${px(win.right)}, expected ${px(at(w.start))}–${px(at(w.end))}${dotOk ? "" : "; variant dot off its residue"}`;
  }
  return [stripCheck, { name: `${c.id}: the overview strip ${wantOverview ? "brackets the window" : "is absent for the whole protein"}`, pass, detail }];
}

function checkMembrane(c: Case, s: Schematic): Check[] {
  const lane = s.svg.querySelector<SVGGElement>('[data-testid="arch-membrane"]');
  if (!lane) return [0, 1, 2].map((i) => ({ name: `${c.id}: membrane lane (${i + 1})`, pass: false, detail: "no membrane lane drawn" }));
  const clip = (r: number) => Math.min(Math.max(r, s.window.start), s.window.end);
  const bars = Array.from(lane.querySelectorAll<SVGGElement>('[data-testid="arch-tm"]')).filter((g) => g.getAttribute("data-kind") === "tm");
  const rails = Array.from(lane.querySelectorAll<SVGLineElement>(".fnd-arch__rail"));
  const off: string[] = [];
  for (const g of bars) {
    const a = Number(g.getAttribute("data-start"));
    const e = Number(g.getAttribute("data-end"));
    const b = bbox(g.querySelector<SVGGraphicsElement>("rect")!);
    if (Math.abs(b.left - expectedX(s, clip(a))) > 0.75 || Math.abs(b.right - expectedX(s, clip(e))) > 0.75) off.push(`${a}–${e}`);
  }
  for (const r of rails) {
    const a = Number(r.getAttribute("data-start"));
    const e = Number(r.getAttribute("data-end"));
    if (Math.abs(Number(r.getAttribute("x1")) - expectedX(s, clip(a))) > 0.75 || Math.abs(Number(r.getAttribute("x2")) - expectedX(s, clip(e))) > 0.75) off.push(`rail ${a}–${e}`);
  }
  const want = c.membrane!;
  const geometry: Check = {
    name: `${c.id}: transmembrane bars and topology rails sit at their residues`,
    pass: bars.length === want.tm && rails.length === want.rails && off.length === 0,
    detail: off.length ? `off: ${off.join(", ")}` : `${bars.length} bars (expected ${want.tm}), ${rails.length} rails (expected ${want.rails})`,
  };

  // The lane sits under every site mark and its label, and above the axis.
  const laneBox = bbox(lane);
  const pinBottom = Math.max(0, ...s.pins.map((p) => bbox(p).bottom));
  const axisY = Number(s.svg.querySelector<SVGLineElement>(".fnd-arch__axis line")?.getAttribute("y1") ?? 0);
  const placement: Check = {
    name: `${c.id}: the topology lane sits between the site marks and the axis`,
    pass: laneBox.top >= pinBottom - 0.5 && laneBox.bottom <= axisY + 0.5,
    detail: `lane ${px(laneBox.top)}–${px(laneBox.bottom)}, lowest mark ${px(pinBottom)}, axis ${px(axisY)}`,
  };

  const tick = lane.querySelector<SVGLineElement>(".fnd-arch__membrane-query");
  const railYs = rails.map((r) => Number(r.getAttribute("y1")));
  const tickOk =
    !!tick &&
    Math.abs(Number(tick.getAttribute("x1")) - expectedX(s, c.residue)) <= 0.5 &&
    (railYs.length === 0 || (Number(tick.getAttribute("y1")) <= Math.min(...railYs) && Number(tick.getAttribute("y2")) >= Math.max(...railYs)));
  const tickCheck: Check = {
    name: `${c.id}: the variant's tick runs through the topology lane at its residue`,
    pass: tickOk,
    detail: tick ? `x ${px(Number(tick.getAttribute("x1")))}, expected ${px(expectedX(s, c.residue))}` : "no tick",
  };
  return [geometry, placement, tickCheck];
}

async function runFamily(name: PerCase, c: Case, host: HTMLElement): Promise<Check[]> {
  const s = readSchematic(host);
  if (typeof s === "string") return family(name, Array.from({ length: FAMILY_SIZE[name] }, () => ({ name: `${c.id}: ${name}`, pass: false, detail: s })));
  switch (name) {
    case "marks": return family(name, checkMarks(c, s));
    case "labels": return family(name, checkLabels(c, s, host));
    case "stems": return family(name, checkStems(c, s));
    case "contrast": return family(name, checkContrast(c, s, host));
    case "targets": return family(name, checkTargets(c, s, host));
    case "focus": return family(name, checkFocus(c, host));
    case "selection": return family(name, await checkSelection(c, host));
    case "verdict": return family(name, checkVerdict(c, host));
    case "zoom": return family(name, await checkZoom(c, host));
    case "view": return family(name, checkView(c, s, host));
    case "membrane": return family(name, checkMembrane(c, s));
    default: {
      const unhandled: never = name;
      return [{ name: `harness: ${String(unhandled)} has no runner`, pass: false, detail: "declared but not wired" }];
    }
  }
}

/* ── Runner ───────────────────────────────────────────────────────────────────── */

function propsFor(c: Case): TabComponentProps {
  const state: AnalysisState = { isLoading: false, error: null, result: resultFor(c) } as AnalysisState;
  return {
    analysisState: state,
    energyUnit: "kcal/mol",
    formatDdGValue: (v: number | null) => String(v ?? "—"),
    setSelectedMetric: () => {},
    onSelectResidue: () => {},
    onNavigateToView: () => {},
    isDark: !!c.dark,
    classCard: "",
    classCardHeader: "",
    classCardTitle: "",
    classBorderSec: "",
    classTextBody: "",
    classTextMute: "",
    foldingDdG: null,
    foldingStatus: null,
  };
}

function App(): React.ReactElement {
  const [report, setReport] = React.useState<{ ok: boolean; checks: Check[] } | null>(null);

  React.useEffect(() => {
    const publish = (checks: Check[]) => {
      const result = { ok: checks.every((x) => x.pass), checks: [...checks] };
      setReport(result);
      const sink = document.getElementById("geometry-result");
      if (sink) sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    };
    void (async () => {
      const checks: Check[] = [];
      try {
        // Fonts change every text box; measure only once they are in.
        await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
        await nextFrame();
        for (const c of CASES) {
          const host = document.getElementById(`host-${c.id}`);
          if (!host) {
            checks.push({ name: `${c.id}: harness host`, pass: false, detail: "case never rendered" });
            continue;
          }
          checks.push(...family("opens", checkOpens(c, host)));
          if (c.whole) {
            const btn = Array.from(host.querySelectorAll<HTMLButtonElement>(".fnd-seg > button")).find((b) => /Whole/.test(b.textContent || ""));
            btn?.click();
            await nextFrame();
            await nextFrame();
          }
          if (c.zoom) {
            const btn = Array.from(host.querySelectorAll<HTMLButtonElement>(".fnd-seg > button")).find((b) => /±/.test(b.textContent || ""));
            btn?.click();
            await nextFrame();
            await nextFrame();
          }
          for (const f of planFamilies(c)) checks.push(...(await runFamily(f, c, host)));
          publish(checks);
        }
        const expected = expectedCheckCount();
        checks.push(...family("selfCheck", [{ name: "harness: every case produced its full assertion set", pass: checks.length + 1 === expected, detail: `${checks.length + 1} assertions from ${CASES.length} cases (expected ${expected})` }]));
      } catch (error) {
        checks.push({ name: "harness", pass: false, detail: `threw: ${(error as Error)?.stack || String(error)}` });
      }
      publish(checks);
    })();
  }, []);

  return (
    <div style={{ background: "var(--cs-bg)", padding: 12 }}>
      <div id="geometry-report" style={{ maxHeight: 220, overflow: "auto", borderBottom: "1px solid var(--cs-border)", marginBottom: 8 }}>
        {report?.checks.map((x, i) => (
          <div key={i} style={{ font: "11px monospace", color: x.pass ? "var(--cs-text-success)" : "var(--cs-text-danger)", whiteSpace: "pre-wrap" }}>
            {x.pass ? "PASS" : "FAIL"} {x.name} — {x.detail}
          </div>
        ))}
      </div>
      {CASES.map((c) => (
        <div key={c.id} id={`wrap-${c.id}`} className={c.dark ? "dark" : undefined} style={{ width: c.width, marginBottom: 16, padding: 8, background: "var(--cs-bg)" }}>
          <div style={{ font: "11px monospace", color: "var(--cs-text-muted)" }}>{c.label}</div>
          <div id={`host-${c.id}`}>
            <FunctionTab {...propsFor(c)} />
          </div>
        </div>
      ))}
    </div>
  );
}

function reportCrash(detail: string): void {
  const sink = document.getElementById("geometry-result");
  if (!sink) return;
  sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify({ ok: false, checks: [{ name: "harness: rendered", pass: false, detail }] }))));
}
window.addEventListener("error", (event) => reportCrash(`uncaught: ${event.message}`));
window.addEventListener("unhandledrejection", (event) => reportCrash(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`));

createRoot(document.getElementById("root")!).render(<App />);


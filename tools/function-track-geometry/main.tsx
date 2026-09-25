import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "./harness.css";
import { FunctionTab } from "../../src/components/evidence/FunctionInteractionsTabs";
import { FeaturePaletteLegend } from "../../src/components/inspector/FeaturePaletteLegend";
import type { AnalysisState, AnalysisResult } from "../../src/types";
import type { TabComponentProps } from "../../src/components/evidence/types";

/**
 * Geometry + behaviour assertions for the Functional Domains sequence track.
 *
 * WHY A BROWSER: the reported defects are all *measured* geometry — a lollipop stem that
 * starts inside the backbone rail instead of on its edge, a variant marker painted over
 * the domain label it sits in, a UA focus outline on an SVG `<g tabindex=0>`, and filter
 * pills whose rendered effect contradicts the counts printed on them. jsdom has no layout
 * engine, no SVG bbox, no computed outline and no `:focus-visible`, so vitest cannot see
 * any of it.
 *
 * The fixture is the *real* UniProtKB feature set for CNNM2 (Q9H8M5, 875 aa), fetched from
 * https://rest.uniprot.org/uniprotkb/Q9H8M5 — the same accession and variant as the report
 * that prompted this work, so the numbers here are the numbers a user sees.
 */

/*
 * The real CNNM2 / Q9H8M5 annotation payload, transcribed field by field from
 * https://rest.uniprot.org/uniprotkb/Q9H8M5 (features + sequence length) and
 * https://rest.uniprot.org/uniprotkb/Q9H8M5?fields=xref_interpro (the one InterPro id the
 * domain-name join can match: IPR002550, EntryName "CNNM"). An earlier revision of this fixture
 * carried IPR082550, which is not in the record at all.
 *
 * `EXPECTED_CNNM2_COUNTS` is written out by hand from the same fetch rather than recomputed from
 * this object: an expectation derived from the fixture cannot notice the fixture being wrong.
 */
const CNNM2_FEATURES = {
  geneName: "CNNM2",
  sequenceLength: 875,
  isMultimer: false,
  features: [
    { type: "Transmembrane", description: "Helical", start: 251, end: 271 },
    { type: "Transmembrane", description: "Helical", start: 339, end: 359 },
    { type: "Transmembrane", description: "Helical", start: 369, end: 389 },
    { type: "Domain", description: "CNNM transmembrane", start: 251, end: 431, interproId: "IPR002550" },
    { type: "Domain", description: "CBS 1", start: 450, end: 511 },
    { type: "Domain", description: "CBS 2", start: 518, end: 584 },
    { type: "Region", description: "Disordered", start: 121, end: 151 },
    { type: "Region", description: "Disordered", start: 742, end: 763 },
    { type: "Modified residue", description: "Phosphoserine", start: 761, end: 761 },
  ],
};

/** Hand-counted from the live record: 3 domains, 3 TM helices, 1 phosphoserine, 2 regions, no
 *  active/binding/disulfide/other annotation. Points are the features annotated at one residue;
 *  spans are those annotated over a run. */
const EXPECTED_CNNM2_COUNTS = {
  domain: 3,
  active: 0,
  binding: 0,
  ptm: 1,
  disulfide: 0,
  transmembrane: 3,
  other: 0,
  spans: 5, // 3 transmembrane helices + 2 disordered regions
  plottedSites: 1, // the phosphoserine; the TM helices are spans
} as const;

/**
 * The real GZF1 / Q9H116 payload (711 aa), transcribed from
 * `https://rest.uniprot.org/uniprotkb/Q9H116` with every feature type the server keeps.
 *
 * It is the case that exposed the geometry problem: ten C2H2 zinc fingers of 23–24 aa, five
 * low-complexity segments, two disordered regions and two 1-aa mutagenesis points. Drawn by type
 * name, all seventeen became lollipops — fifteen near-black dots claiming a 24-residue finger sits
 * at one residue. Five of the low-complexity spans are nested inside the disordered regions, which
 * is what the span lane's tiering exists for.
 */
const GZF1_FEATURES = {
  geneName: "GZF1",
  sequenceLength: 711,
  isMultimer: false,
  features: [
    { type: "Domain", description: "BTB", start: 31, end: 103, interproId: "IPR000210" },
    { type: "Zinc finger", description: "C2H2-type 1", start: 317, end: 340 },
    { type: "Zinc finger", description: "C2H2-type 2", start: 348, end: 371 },
    { type: "Zinc finger", description: "C2H2-type 3", start: 377, end: 400 },
    { type: "Zinc finger", description: "C2H2-type 4", start: 407, end: 429 },
    { type: "Zinc finger", description: "C2H2-type 5", start: 435, end: 457 },
    { type: "Zinc finger", description: "C2H2-type 6", start: 463, end: 485 },
    { type: "Zinc finger", description: "C2H2-type 7", start: 491, end: 513 },
    { type: "Zinc finger", description: "C2H2-type 8", start: 519, end: 541 },
    { type: "Zinc finger", description: "C2H2-type 9", start: 547, end: 569 },
    { type: "Zinc finger", description: "C2H2-type 10", start: 575, end: 597 },
    { type: "Region", description: "Disordered", start: 153, end: 220 },
    { type: "Region", description: "Disordered", start: 243, end: 312 },
    { type: "Compositional bias", description: "Low complexity", start: 153, end: 168 },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 197, end: 212 },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 243, end: 252 },
    { type: "Compositional bias", description: "Basic and acidic residues", start: 265, end: 277 },
    { type: "Compositional bias", description: "Acidic residues", start: 298, end: 309 },
    { type: "Modified residue", description: "Phosphoserine", start: 613, end: 613 },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 32, end: 32 },
    { type: "Mutagenesis", description: "Decreased repression activity.", start: 50, end: 50 },
  ],
};

/** Hand-counted from the record: 1 domain, 17 spans (10 zinc finger + 5 low-complexity + 2
 *  disordered regions), 3 point sites (2 mutagenesis + 1 phosphoserine), 0 active/binding/disulfide
 *  and no transmembrane helix. */
const EXPECTED_GZF1_COUNTS = {
  domain: 1,
  active: 0,
  binding: 0,
  ptm: 1,
  disulfide: 0,
  transmembrane: 0,
  other: 17, // 10 zinc fingers + 5 low-complexity segments + 2 mutagenesis points
  spans: 17, // 10 zinc fingers + 5 low-complexity segments + 2 disordered regions
  plottedSites: 3, // points only: 2 mutagenesis + 1 phosphoserine
} as const;

/**
 * SYNTHETIC category-coverage payload — not a real protein.
 *
 * The CNNM2 payload only exercises three of the seven chips (the rest are 0-vs-0), so nothing
 * verified that a chip's filter matches the pin colour it counts for `active`/`binding`/
 * `disulfide`/`other`. The feature *types* here are drawn from the server's kept vocabulary
 * (`server/services/external-api/uniprot.ts` RELEVANT_FEATURE_TYPES); the positions are invented
 * to be well separated so each pin lands in its own tier.
 */
const COVERAGE_FEATURES = {
  geneName: "COVERAGE",
  sequenceLength: 300,
  isMultimer: false,
  features: [
    { type: "Domain", description: "Test domain", start: 10, end: 150 },
    { type: "Active site", description: "Proton acceptor", start: 40, end: 40 },
    { type: "Binding site", description: "Substrate", start: 60, end: 60 },
    { type: "Metal binding", description: "Zinc", start: 70, end: 70 },
    { type: "Disulfide bond", description: "Interchain", start: 100, end: 100 },
    { type: "Modified residue", description: "Phosphothreonine", start: 130, end: 130 },
    { type: "Transmembrane", description: "Helical", start: 200, end: 220 },
    { type: "Zinc finger", description: "RING-type", start: 240, end: 262 },
    { type: "Motif", description: "Nuclear localisation", start: 270, end: 276 },
    { type: "Region", description: "Disordered", start: 285, end: 299 },
  ],
};

const EXPECTED_COVERAGE_COUNTS = {
  domain: 1,
  active: 1,
  binding: 2, // "Binding site" + "Metal binding"
  ptm: 1,
  disulfide: 1,
  transmembrane: 1,
  other: 2, // "Zinc finger" + "Motif"
  spans: 4, // transmembrane + zinc finger + motif + region
  plottedSites: 5, // points only: active, binding, metal, disulfide, modified residue
} as const;

/**
 * SYNTHETIC crowded-cluster payload — not a real protein.
 *
 * Every other fixture keeps its point sites far apart (the coverage payload says so explicitly: "the
 * positions are invented to be well separated so each pin lands in its own tier"), so nothing
 * exercised the tier assignment at all, let alone its overflow branch. Six point sites sit within
 * eleven residues here — close enough that three tiers cannot hold them all — which is the state the
 * packing rule exists to resolve and the state the accessible control list exists to make clickable.
 */
const CROWDED_FEATURES = {
  geneName: "CROWDED",
  sequenceLength: 500,
  isMultimer: false,
  features: [
    { type: "Domain", description: "Test domain", start: 100, end: 160 },
    { type: "Binding site", description: "Substrate", start: 200, end: 200 },
    { type: "Binding site", description: "Substrate", start: 202, end: 202 },
    { type: "Active site", description: "Proton acceptor", start: 204, end: 204 },
    { type: "Binding site", description: "Substrate", start: 206, end: 206 },
    { type: "Binding site", description: "Substrate", start: 208, end: 208 },
    { type: "Disulfide bond", description: "Interchain", start: 210, end: 210 },
    { type: "Region", description: "Disordered", start: 250, end: 280 },
  ],
};

const EXPECTED_CROWDED_COUNTS = {
  domain: 1,
  active: 1,
  binding: 4,
  ptm: 0,
  disulfide: 1,
  transmembrane: 0,
  other: 0,
  spans: 1, // the disordered region; the bar keeps the span-lane checks meaningful here
  plottedSites: 6, // the six clustered points
} as const;

/**
 * The harness's own category oracle, independent of the component's predicates: it decides which
 * pins a chip must keep lit, from the *type strings in the fixture*. Spelled out here on purpose —
 * expecting the rendered result from the implementation's own function would make the filter check
 * agree with whatever the implementation does.
 */
function categoryMatchesType(type: string, category: string): boolean {
  const t = type.toLowerCase();
  switch (category) {
    case "domain": return t === "domain";
    case "active": return t.includes("active") || t.includes("catalytic");
    case "binding": return t.includes("binding") || t.includes("metal");
    case "ptm": return t.includes("modified") || t.includes("phospho") || t.includes("methyl") || t.includes("acetyl");
    case "disulfide": return t.includes("disulfide") || t.includes("cysteine");
    case "transmembrane": return t.includes("transmembrane") || t.includes("membrane");
    case "other":
      return (
        t !== "domain" &&
        t !== "chain" &&
        t !== "region" &&
        !categoryMatchesType(type, "active") &&
        !categoryMatchesType(type, "binding") &&
        !categoryMatchesType(type, "ptm") &&
        !categoryMatchesType(type, "disulfide") &&
        !categoryMatchesType(type, "transmembrane")
      );
    default: return false;
  }
}

/**
 * Which fixture features are annotated over a run of residues, so the harness knows how many bars a
 * case must draw — and how many of them *should* claim the variant — from the fixture rather than
 * from the render. Reading that off the rendered aria-labels instead made the underline check
 * vacuous: when the render stopped marking the enclosing span, the expected count fell to zero and
 * the check passed on an empty set.
 */
function isSpanType(type: string): boolean {
  return [
    "transmembrane",
    "region",
    "zinc finger",
    "repeat",
    "coiled coil",
    "compositional bias",
    "motif",
    "dna binding",
  ].includes(type.toLowerCase());
}

/** Which fixture features the track plots as lollipops (not domains, not regions, not chains). */
function isPlottedSite(type: string): boolean {
  const t = type.toLowerCase();
  return t !== "domain" && t !== "chain" && t !== "region";
}

function resultFor(
  features: typeof CNNM2_FEATURES | typeof COVERAGE_FEATURES,
  residueIndex: number,
  wildType: string,
  mutant: string
): AnalysisResult {
  return {
    metadata: {
      gene: features.geneName,
      variant: `p.${wildType}${residueIndex}${mutant}`,
      residueIndex,
      wildType,
      mutant,
      uniprotId: "Q9H8M5",
    },
    uniprotFeatures: features,
    // The server's vocabulary is "ok" | "not_found" | "timeout" | "error" | "unsupported-build"
    // (see src/services/pipeline/payload-assembler.ts), not "success".
    serviceStatus: { uniprotFeatures: "ok" },
  } as unknown as AnalysisResult;
}

function stateFor(result: AnalysisResult): AnalysisState {
  return { isLoading: false, error: null, result };
}

/*
 * Freeze transitions and animations before anything renders.
 *
 * The app animates opacity and `transition-all` over 150–200ms, and SVG geometry properties
 * (`cx`, `x`, `r`) are animatable — so a measurement taken two macrotasks after a click reads a
 * *mid-transition* value. That is not a defect in the app (a user sees the settled state) but it
 * makes every geometry assertion timing-dependent and produced a false "pinhead is 544 units from
 * its stem" failure the first time the zoomed case ran. Freezing them makes the harness measure the
 * settled target, which is the state the assertions are about. `settledOpacity` still neutralises
 * the transition per element as a belt-and-braces measure.
 */
function freezeMotion(): void {
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(style);
}
freezeMotion();

/** Variant inside CBS 1 (the reported case), inside the CNNM transmembrane domain, in the
 *  inter-domain gap, a zoomed window, the real zinc-finger protein GZF1, plus the synthetic
 *  category-coverage case. */
const CASES = [
  { id: "cbs1", label: "p.Ser489Cys — inside CBS 1", residue: 489, width: 1010, kind: "cnnm2" },
  { id: "tm", label: "p.Ala300Val — inside CNNM transmembrane", residue: 300, width: 1010, wt: "Ala", mut: "Val", kind: "cnnm2" },
  { id: "gap", label: "p.Gly440Arg — inter-domain", residue: 440, width: 1010, wt: "Gly", mut: "Arg", kind: "cnnm2" },
  { id: "zoomed", label: "p.Ser489Cys at 3.5× — clipped bands", residue: 489, width: 1010, kind: "cnnm2", zoomClicks: 5 },
  // `focusVariant: false` on purpose. "Focus Variant" sets the zoom from the protein length
  // (`min(5, max(2.5, seqLength / 250))`, i.e. 3.5× for these 875 residues) and discards the clicks, so
  // an earlier revision of this case clicked it and silently measured the *same* window as `zoomed` —
  // 364–613 for both. Leaving it out is what makes this a genuinely different window (1–437 at 2×).
  { id: "zoomed2", label: "p.Ala300Val at 2× from the N-terminus — a second window width", residue: 300, width: 1010, wt: "Ala", mut: "Val", kind: "cnnm2", zoomClicks: 2, focusVariant: false },
  { id: "gzf1", label: "GZF1 p.Arg591Trp — 17 nested spans, 3 point sites", residue: 591, width: 1010, wt: "Arg", mut: "Trp", kind: "gzf1" },
  { id: "coverage", label: "synthetic category coverage (all seven chips)", residue: 60, width: 1010, wt: "Asp", mut: "Asn", kind: "coverage" },
  { id: "crowded", label: "synthetic crowded cluster (six points in 11 residues)", residue: 204, width: 1010, wt: "Pro", mut: "Leu", kind: "crowded" },
] as const;

/** Every fixture has the shape the component reads; only the contents differ. */
interface Fixture {
  geneName: string;
  sequenceLength: number;
  isMultimer: boolean;
  features: Array<{ type: string; description: string; start: number; end: number }>;
}

/**
 * One place that maps a case to its payload and its hand-counted expectations. The two used to be
 * selected by separate ternary chains in three different places, so a fourth fixture would have had to
 * be added in all three or (worse) silently fall through to CNNM2.
 */
function payloadFor(kind: string): { features: Fixture; want: ExpectedCounts } {
  switch (kind) {
    case "coverage": return { features: COVERAGE_FEATURES, want: EXPECTED_COVERAGE_COUNTS };
    case "gzf1": return { features: GZF1_FEATURES, want: EXPECTED_GZF1_COUNTS };
    case "crowded": return { features: CROWDED_FEATURES, want: EXPECTED_CROWDED_COUNTS };
    default: return { features: CNNM2_FEATURES, want: EXPECTED_CNNM2_COUNTS };
  }
}


/* ── Report plumbing (identical shape to tools/header-geometry) ─────────────────── */
interface Check {
  name: string;
  pass: boolean;  detail: string;
}

const px = (n: number) => Math.round(n * 100) / 100;
/** Flush React state updates with macrotasks: rAF can stall under --virtual-time-budget. */
const nextFrame = () => new Promise<void>((r) => setTimeout(() => setTimeout(() => r(), 0), 0));

/**
 * The opacity the app applied, read from the inline style rather than from
 * `getComputedStyle`: the track transitions opacity over 200ms, so a computed read taken
 * immediately after a click returns the *old* value and every filter assertion silently
 * passes. The inline value is what React wrote and is exact.
 */
/**
 * The opacity the user actually sees, through the whole cascade.
 *
 * Two traps this avoids. (1) The track transitions opacity over 200ms, so a computed read taken
 * right after a click returns the *old* value and every filter assertion silently passes — the
 * transition is neutralised here instead of reading React's inline value, so dimming that moved
 * into a class still counts. (2) A parent can dim a whole group, which a per-element read misses
 * entirely, so the chain up to the SVG is multiplied together.
 */
function settledOpacity(el: Element): number {
  const own = el as HTMLElement;
  const previous = own.style.transition;
  own.style.transition = "none";
  void own.getBoundingClientRect(); // force style recalc with the transition disabled
  let value = 1;
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== "svg") {
    const computed = parseFloat(getComputedStyle(node).opacity);
    value *= Number.isFinite(computed) ? computed : 1;
    node = node.parentElement;
  }
  own.style.transition = previous;
  return px(value);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  right: number;
  bottom: number;
}

function box(el: SVGGraphicsElement, strokePad = 0): Box {
  const b = el.getBBox();
  return {
    x: px(b.x - strokePad),
    y: px(b.y - strokePad),
    w: px(b.width + strokePad * 2),
    h: px(b.height + strokePad * 2),
    right: px(b.x + b.width + strokePad),
    bottom: px(b.y + b.height + strokePad),
  };
}

/**
 * `getBBox` ignores stroke and returns a zero-width box for a vertical line, so every painted
 * shape is inflated by half its stroke: without this the connector line was dropped from the
 * collision set entirely (it measured 0 wide) and up to half a stroke-width of overlap escaped.
 */
function paintedBox(el: SVGGraphicsElement): Box {
  const strokeWidth = parseFloat(getComputedStyle(el).strokeWidth || "0");
  const pad = Number.isFinite(strokeWidth) ? strokeWidth / 2 : 0;
  return box(el, pad);
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

interface Track {
  svg: SVGSVGElement;
  rail: Box;
  domains: Array<{ g: SVGGElement; block: SVGRectElement; blockBox: Box; label: Box | null; labelEl: SVGTextElement | null; name: string }>;
  sites: Array<{ g: SVGGElement; stem: SVGLineElement; stemBox: Box; pinEl: SVGCircleElement; pin: Box; hit: Box; hitRadius: number; name: string }>;
  spans: Array<{ g: SVGGElement; bar: SVGRectElement; barBox: Box; underline: boolean; name: string }>;
  markerLabel: string | null;
  rulerStart: number | null;
  rulerEnd: number | null;
  callout: { g: SVGGElement; pill: Box; text: Box | null; marker: Box | null; connector: Box | null; shapes: Array<[string, Box]> } | null;
}

function readTrack(host: HTMLElement): { track: Track } | { error: string } {
  // Anchor on a track shape first: the host also contains lucide icon <svg>s, so
  // `querySelector("svg")` would measure a 14px glyph.
  const anchor = host.querySelector('g[aria-label^="Domain:"], g[aria-label^="Functional site:"], g[aria-label^="Curated span:"]');
  const svg = (anchor?.closest("svg") ?? null) as SVGSVGElement | null;
  if (!svg) return { error: `no sequence-track <svg> in host (icons found: ${host.querySelectorAll("svg").length})` };

  // The backbone rail is the only direct <rect> child of the SVG (domains live in the
  // clipped group), so this reads the rendered rail, not a memorised constant.
  const railEl = Array.from(svg.children).find((c) => c.tagName.toLowerCase() === "rect") as SVGRectElement | undefined;
  if (!railEl) return { error: `no direct <rect> rail; svg children = ${Array.from(svg.children).map((c) => c.tagName).join(",")}` };

  const domains = Array.from(svg.querySelectorAll('g[aria-label^="Domain:"]')).map((g) => {
    const rects = Array.from(g.querySelectorAll("rect")) as SVGRectElement[];
    const text = g.querySelector("text") as SVGTextElement | null;
    const block = rects[rects.length - 1];
    return {
      g: g as SVGGElement,
      block,
      blockBox: box(block),
      label: text ? box(text) : null,
      labelEl: text,
      name: g.getAttribute("aria-label") || "",
    };
  });

  const sites = Array.from(svg.querySelectorAll('g[aria-label^="Functional site:"]')).map((g) => {
    const circles = Array.from(g.querySelectorAll("circle")) as SVGCircleElement[];
    const line = g.querySelector("line") as SVGLineElement;
    // The pinhead is the last circle with a real paint (the transparent r=11 circle is the hit
    // area); identifying it by paint rather than by index keeps this correct if a decoration is
    // ever added after it.
    const painted = circles.filter((c) => {
      const fill = getComputedStyle(c).fill;
      return fill !== "none" && fill !== "transparent" && !fill.startsWith("rgba(0, 0, 0, 0)");
    });
    const pin = painted[painted.length - 1] ?? circles[circles.length - 1];
    return {
      g: g as SVGGElement,
      stem: line,
      stemBox: paintedBox(line),
      pinEl: pin,
      pin: box(pin),
      hit: box(circles[0]),
      hitRadius: circles[0]?.r.baseVal.value ?? 0,
      name: g.getAttribute("aria-label") || "",
    };
  });

  // Curated spans are bars, not pins. A second rect inside the group is the amber underline that
  // marks a span containing the variant residue.
  const spans = Array.from(svg.querySelectorAll('g[aria-label^="Curated span:"]')).map((g) => {
    const rects = Array.from(g.querySelectorAll("rect")) as SVGRectElement[];
    return {
      g: g as SVGGElement,
      bar: rects[0],
      barBox: box(rects[0]),
      underline: rects.length > 1,
      name: g.getAttribute("aria-label") || "",
    };
  });

  const calloutG = svg.querySelector('[data-track="variant-marker"]') as SVGGElement | null;
  let callout: Track["callout"] = null;
  if (calloutG) {
    const rect = calloutG.querySelector("rect") as SVGRectElement;
    const text = calloutG.querySelector("text") as SVGTextElement;
    const marker = calloutG.querySelector("polygon") as SVGPolygonElement | null;
    const connector = calloutG.querySelector("line") as SVGLineElement | null;
    // EVERY shape the callout paints, except the pill itself: a guard that only measured the
    // caret would miss a beacon circle reintroduced on the rail (it did, on the first pass),
    // and `paintedBox` keeps the zero-width connector in the set.
    const shapes: Array<[string, Box]> = Array.from(calloutG.children)
      .filter((child) => child !== rect)
      .map((child) => [child.tagName.toLowerCase(), paintedBox(child as SVGGraphicsElement)] as [string, Box]);
    callout = {
      g: calloutG,
      pill: box(rect),
      text: text ? box(text) : null,
      marker: marker ? box(marker) : null,
      connector: connector ? box(connector) : null,
      shapes,
    };
  }

  // The ruler's own printed endpoints are the mapping's ground truth, so residue→x can be checked
  // against what the track *says* rather than against the implementation's formula.
  const rulerTexts = Array.from(svg.querySelectorAll("text"))
    .map((t) => (t.textContent || "").trim())
    .filter((s) => /^\d+$/.test(s) || /^\d+ aa$/.test(s));
  const rulerStart = rulerTexts.length ? Number(rulerTexts[0].replace(" aa", "")) : null;
  const rulerEnd = rulerTexts.length ? Number(rulerTexts[rulerTexts.length - 1].replace(" aa", "")) : null;

  return {
    track: {
      svg,
      rail: box(railEl),
      domains,
      sites,
      spans,
      markerLabel: calloutG?.getAttribute("aria-label") ?? null,
      rulerStart: Number.isFinite(rulerStart) ? rulerStart : null,
      rulerEnd: Number.isFinite(rulerEnd) ? rulerEnd : null,
      callout,
    },
  };
}

/* ── Checks ────────────────────────────────────────────────────────────────────── */

function checkTrackGeometry(id: string, t: Track): Check[] {
  const checks: Check[] = [];

  // 1. Every lollipop stem starts on the bottom edge of the surface that covers its residue:
  //    the domain band where a block is painted over that x, otherwise the backbone rail.
  //    The "lollipops offset from backbone" report: the stems used to start at a hand-written
  //    y=48 while the rail's bottom edge is y=50, i.e. inside the band, attached to nothing.
  const expectedAnchor = (stemX: number) => {
    const covering = t.domains.find((d) => stemX >= d.blockBox.x && stemX <= d.blockBox.right);
    return covering ? covering.blockBox.bottom : t.rail.bottom;
  };
  const anchorErrors = t.sites
    .map((s) => {
      const stemX = s.stemBox.x + s.stemBox.w / 2;
      const want = expectedAnchor(stemX);
      return { name: s.name.slice(0, 22), got: s.stemBox.y, want: px(want), delta: px(s.stemBox.y - want) };
    })
    .filter((e) => Math.abs(e.delta) > 0.5);
  checks.push({
    name: `${id}: every lollipop stem starts on the edge it hangs from`,
    pass: t.sites.length > 0 && anchorErrors.length === 0,
    detail: anchorErrors.length
      ? anchorErrors.map((e) => `${e.name}: top ${e.got} vs edge ${e.want} (Δ${e.delta})`).join("; ")
      : `${t.sites.length} stems anchored (rail bottom ${t.rail.bottom}, band bottom ${t.domains[0]?.blockBox.bottom ?? "n/a"})`,
  });

  // 2. No stem is painted across a domain label's ink — the visible symptom of the old anchor.
  //    Vacuity guard: this is only a measurement if labels are actually rendered.
  const labelled = t.domains.filter((d) => d.label);
  const inkCrossings: string[] = [];
  for (const s of t.sites) {
    for (const d of t.domains) {
      if (d.label && intersects(s.stemBox, d.label)) inkCrossings.push(`${s.name.slice(0, 18)} × ${d.name.slice(0, 18)}`);
    }
  }
  checks.push({
    name: `${id}: no stem crosses a domain label`,
    pass: labelled.length === t.domains.length && labelled.length > 0 && inkCrossings.length === 0,
    detail:
      labelled.length !== t.domains.length
        ? `only ${labelled.length}/${t.domains.length} domains have a rendered label — the comparison would be vacuous`
        : inkCrossings.length
          ? inkCrossings.join("; ")
          : `${t.sites.length} stems clear of ${labelled.length} labels`,
  });

  // 3. The pinhead is centred on its own stem, and hangs clear of the rail.
  const offsets = t.sites.map((s) => ({
    name: s.name.slice(0, 22),
    delta: px(s.pin.x + s.pin.w / 2 - (s.stemBox.x + s.stemBox.w / 2)),
    pinX: px(s.pin.x + s.pin.w / 2),
    stemX: px(s.stemBox.x + s.stemBox.w / 2),
  }));
  const worst = offsets.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), { name: "-", delta: 0, pinX: 0, stemX: 0 });
  checks.push({
    name: `${id}: pinheads are centred on their stems`,
    pass: offsets.length > 0 && Math.abs(worst.delta) <= 0.5,
    detail: Math.abs(worst.delta) <= 0.5
      ? `pin−stem centre offsets [${offsets.map((o) => o.delta).join(", ")}] (want 0)`
      : `worst ${worst.name}: pin centre ${worst.pinX} vs stem centre ${worst.stemX} (Δ${worst.delta})`,
  });

  const overlapsRail = t.sites.filter((s) => intersects(s.pin, t.rail));
  checks.push({
    name: `${id}: pinheads clear the backbone rail`,
    pass: t.sites.length > 0 && overlapsRail.length === 0,
    detail: overlapsRail.length ? `${overlapsRail.length} pin(s) overlap the rail: ${overlapsRail.map((s) => s.name).join("; ")}` : `${t.sites.length} pins clear`,
  });

  const kinkedStems = t.sites.filter((s) => px(s.pin.y - s.stemBox.y) < 0);
  checks.push({
    name: `${id}: stems run from their edge down to the pin`,
    pass: t.sites.length > 0 && kinkedStems.length === 0,
    detail: kinkedStems.length ? `${kinkedStems.length} stem(s) end above their pin` : "all stems downward",
  });

  // 3b. Lollipop targets must be big enough to hit (WCAG 2.5.8 wants 24px; this is the SVG's
  //     own hit radius, and the pins are ~10px apart at 1× so the spacing exception does not
  //     cover them). Also proves the hit area is centred on the pin it belongs to.
  const badTargets = t.sites.filter((s) => {
    const centred = Math.abs(s.hit.x + s.hit.w / 2 - (s.pin.x + s.pin.w / 2)) <= 0.5 && Math.abs(s.hit.y + s.hit.h / 2 - (s.pin.y + s.pin.h / 2)) <= 0.5;
    return !centred || s.hitRadius * 2 < 22;
  });
  checks.push({
    name: `${id}: pin hit areas are centred and at least 22 units across`,
    pass: t.sites.length > 0 && badTargets.length === 0,
    detail: badTargets.length
      ? badTargets.map((s) => `${s.name.slice(0, 22)} r=${s.hitRadius}`).join("; ")
      : `${t.sites.length} hit areas at r=${t.sites[0].hitRadius}`,
  });

  return checks;
}

/**
 * 3c. The residue→x mapping. Every other geometry check is *relative* (stem vs the band it hangs
 * from), so an off-by-one or a shifted span moves the bands, the stems and the labels together and
 * passes all of them. This binds them to the ruler's own printed endpoints: residue 1 sits at the
 * rail's left edge and the final residue at its right edge, and every band edge and stem must land
 * where that mapping says. It also counts the rendered bands, so dropping one from the render is
 * visible.
 */
/**
 * Tolerance in SVG units. An off-by-one residue error is `(rail span) / (seqLength - 1)` units —
 * 0.84 for CNNM2's 875 residues — so this catches one for proteins up to ~3,600 residues and
 * degrades gracefully beyond that. A self-consistent span change (every shape following the rail)
 * is not a defect and is deliberately not detected here.
 */
const MAPPING_TOLERANCE = 0.25;

/** The track's span-lane lanes, mirrored from TRACK so the harness states its own expectations. */
const SPAN_LANE = { top: 62, siteRailY: 74 } as const;

/**
 * 3f. The span lane. Curated features annotated over a run of residues must be drawn as bars, and
 * point-annotated features as pins — the split is what removed fifteen near-black pins from GZF1,
 * where ten 23-24 aa zinc fingers and five low-complexity segments had been plotted as if each sat
 * at a single residue. Also checks the lane's own packing: nested spans (low-complexity inside
 * disordered regions) must land on separate tiers, and a span containing the variant must carry the
 * amber underline that says so.
 */
function checkSpanLane(
  id: string,
  t: Track,
  expected: { spans: number; points: number; spanLaneTop: number; siteRailY: number; enclosing: number }
): Check[] {
  const checks: Check[] = [];

  checks.push({
    name: `${id}: spans are bars and point sites are pins`,
    pass: t.spans.length === expected.spans && t.sites.length === expected.points,
    detail:
      t.spans.length === expected.spans && t.sites.length === expected.points
        ? `${t.spans.length} span bars, ${t.sites.length} pins (fixture)`
        : `rendered ${t.spans.length} span bars / ${t.sites.length} pins; fixture expects ${expected.spans} / ${expected.points}`,
  });

  // Every bar must sit inside the lane the layout reserves for it.
  const outsideLane = t.spans.filter(
    (s) => s.barBox.y < expected.spanLaneTop - 0.5 || s.barBox.bottom > expected.siteRailY + 0.5
  );
  checks.push({
    name: `${id}: span bars stay inside the span lane`,
    pass: t.spans.length > 0 && outsideLane.length === 0,
    detail: outsideLane.length
      ? outsideLane.map((s) => `${s.name.slice(0, 24)} y=${s.barBox.y}..${s.barBox.bottom}`).join("; ")
      : `${t.spans.length} bars within y ${expected.spanLaneTop}..${expected.siteRailY}`,
  });

  // Nested spans must not share a tier: any two bars at the same y may not overlap in x.
  const collisions: string[] = [];
  for (let i = 0; i < t.spans.length; i += 1) {
    for (let j = i + 1; j < t.spans.length; j += 1) {
      const a = t.spans[i];
      const b = t.spans[j];
      if (Math.abs(a.barBox.y - b.barBox.y) > 0.5) continue;
      if (intersects(a.barBox, b.barBox)) collisions.push(`${a.name.slice(0, 18)} overlaps ${b.name.slice(0, 18)} on one tier`);
    }
  }
  const tiers = new Set(t.spans.map((s) => px(s.barBox.y)));
  checks.push({
    name: `${id}: overlapping spans are packed onto separate tiers`,
    pass: collisions.length === 0,
    detail: collisions.length ? collisions.join("; ") : `${t.spans.length} bars across ${tiers.size} tier(s)`,
  });

  // The variant must be inside something, and that something must say so. How many spans *should*
  // contain it comes from the fixture, so an implementation that simply stops claiming containment
  // fails here instead of quietly agreeing with itself.
  const enclosing = t.spans.filter((s) => /contains the variant residue/.test(s.name));
  const underlined = enclosing.filter((s) => s.underline);
  checks.push({
    name: `${id}: a span containing the variant is underlined`,
    pass: enclosing.length === expected.enclosing && underlined.length === enclosing.length,
    detail:
      enclosing.length === expected.enclosing
        ? `${underlined.length}/${enclosing.length} enclosing bars underlined`
        : `${enclosing.length} bar(s) claim to contain the variant, the fixture has ${expected.enclosing} that do; ${underlined.length} underlined`,
  });

  return checks;
}


function checkResidueMapping(id: string, t: Track, expected: { seqLength: number; domains: number; sites: number }): Check[] {
  if (t.rulerStart === null || t.rulerEnd === null) {
    return [{ name: `${id}: residue→x mapping matches the printed ruler`, pass: false, detail: "could not read the ruler's endpoint labels" }];
  }
  const wantX = (residue: number) =>
    t.rail.x + ((residue - t.rulerStart!) / Math.max(t.rulerEnd! - t.rulerStart!, 1)) * (t.rail.right - t.rail.x);

  const errors: string[] = [];
  for (const s of t.sites) {
    const stemX = px(s.stemBox.x + s.stemBox.w / 2);
    const residue = Number((s.name.match(/residue (\d+)/) || [])[1]);
    if (!Number.isFinite(residue)) {
      errors.push(`${s.name.slice(0, 24)}: no residue in the aria-label`);
      continue;
    }
    if (Math.abs(stemX - wantX(residue)) > MAPPING_TOLERANCE) errors.push(`site ${residue} at x=${stemX}, ruler says ${px(wantX(residue))}`);
  }
  for (const d of t.domains) {
    const m = d.name.match(/residues (\d+) to (\d+)/);
    if (!m) {
      errors.push(`${d.name.slice(0, 24)}: no residue range in the aria-label`);
      continue;
    }
    const [start, end] = [Number(m[1]), Number(m[2])];
    if (Math.abs(d.blockBox.x - wantX(start)) > MAPPING_TOLERANCE) errors.push(`${d.name.slice(7, 20)} start at x=${d.blockBox.x}, ruler says ${px(wantX(start))}`);
    if (Math.abs(d.blockBox.right - wantX(end)) > MAPPING_TOLERANCE) errors.push(`${d.name.slice(7, 20)} end at x=${d.blockBox.right}, ruler says ${px(wantX(end))}`);
  }
  if (t.domains.length !== expected.domains) errors.push(`rendered ${t.domains.length} domain bands, fixture has ${expected.domains}`);
  if (t.sites.length !== expected.sites) errors.push(`rendered ${t.sites.length} lollipops, fixture has ${expected.sites}`);

  return [
    {
      name: `${id}: residue→x mapping matches the printed ruler`,
      pass: errors.length === 0,
      detail: errors.length
        ? errors.join("; ")
        : `ruler ${t.rulerStart}–${t.rulerEnd}; ${t.domains.length} bands and ${t.sites.length} stems all within ${MAPPING_TOLERANCE} units`,
    },
  ];
}

/**
 * 3d. Non-text contrast. The pins carry the category (colour is the only encoding of "which kind of
 * site is this"), so WCAG 1.4.11 wants 3:1 against what they sit on. The light track surface is the
 * domain-band underlay / card surface, `#FAF9F6` — a constant here, because the harness cannot
 * sample a rendered screenshot.
 */
const LIGHT_TRACK_SURFACE: [number, number, number] = [250, 249, 246];

/**
 * Normalise any CSS colour to sRGB by painting one pixel and reading it back. Tailwind v4 emits
 * `oklch(...)`, and the canvas `fillStyle` getter hands that syntax straight back — but the canvas
 * *backing store* is sRGB, so `getImageData` converts any colour space for us (oklch, lab,
 * color-mix, named colours).
 */
function parseRgb(value: string): [number, number, number] | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const probe = canvas.getContext("2d", { willReadFrequently: true });
  if (!probe) return null;
  // White underlay so a translucent colour composites the way it renders on the track.
  probe.fillStyle = "#ffffff";
  probe.fillRect(0, 0, 1, 1);
  const sentinel = "#010203";
  probe.fillStyle = sentinel;
  probe.fillStyle = value;
  if (probe.fillStyle === sentinel && value.trim().toLowerCase() !== sentinel) return null; // unparseable
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = Array.from(probe.getImageData(0, 0, 1, 1).data);
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function checkNonTextContrast(id: string, t: Track): Check[] {
  // Every distinct pin colour plus the variant caret; the caret is the only thing marking the
  // residue on the track, so it is a meaningful non-text element too.
  const samples: Array<[string, string]> = t.sites.map((s) => [s.name.slice(0, 26), getComputedStyle(s.pinEl).fill]);
  /*
   * Span bars belong in this set, not only in the legend's colour-equality check: on CNNM2 a
   * transmembrane helix is a bar and NOTHING else, so if its colour is too faint to read the
   * annotation is simply not there for a low-vision reader. Equality with the legend says the legend
   * and the track agree; it says nothing about either against the surface they are painted on.
   */
  samples.push(...t.spans.map((s): [string, string] => [`span ${s.name.slice(0, 24)}`, getComputedStyle(s.bar).fill]));
  const caret = t.callout?.marker ? t.callout.g.querySelector("polygon") : null;
  if (caret) samples.push(["variant caret", getComputedStyle(caret).fill]);

  const measured: string[] = [];
  const failing: string[] = [];
  const seen = new Set<string>();
  for (const [name, fill] of samples) {
    if (seen.has(fill)) continue;
    seen.add(fill);
    const rgb = parseRgb(fill);
    if (!rgb) {
      failing.push(`${name}: unparseable fill "${fill}"`);
      continue;
    }
    const ratio = contrastRatio(rgb, LIGHT_TRACK_SURFACE);
    measured.push(`${name} ${ratio.toFixed(2)}:1`);
    if (ratio < 3) failing.push(`${name} ${ratio.toFixed(2)}:1 (< 3:1)`);
  }
  return [
    {
      name: `${id}: pin, span bar and caret colours clear 3:1 on the light track`,
      pass: failing.length === 0 && measured.length > 0,
      detail: failing.length ? failing.join("; ") : measured.join(", "),
    },
  ];
}

/**
 * 3g. The pin tiers.
 *
 * Pins that would collide are stacked in tiers, and the tier assignment is interval packing: each pin
 * takes the lowest tier whose rightmost pin is far enough away. Pins sharing a tier must therefore not
 * be drawn on top of each other — the one thing a reader cannot undo.
 *
 * Honest scope: this is a regression guard, not a reproducer. It was written against the previous rule
 * (compare with the immediate predecessor only, cycle the tier modulo three), and the crowded-cluster
 * fixture shows that rule passing it too — a cluster dense enough to break the cyclic rule is also
 * dense enough to exhaust three tiers, where *any* assignment overlaps. What fails it is a mutation
 * that ignores tiers altogether ("every pin on tier 0"), which is in `mutations.mjs`.
 */
function checkPinTiers(id: string, t: Track): Check[] {
  const collisions: string[] = [];
  for (let i = 0; i < t.sites.length; i += 1) {
    for (let j = i + 1; j < t.sites.length; j += 1) {
      const a = t.sites[i];
      const b = t.sites[j];
      if (Math.abs(a.pin.y - b.pin.y) > 0.5) continue;
      if (intersects(a.pin, b.pin)) collisions.push(`${a.name.slice(0, 22)} overlaps ${b.name.slice(0, 22)} on one tier`);
    }
  }
  const tiers = new Set(t.sites.map((s) => px(s.pin.y)));
  return [
    {
      name: `${id}: pins sharing a tier are not drawn on top of each other`,
      pass: collisions.length === 0,
      detail: collisions.length ? collisions.join("; ") : `${t.sites.length} pins across ${tiers.size} tier(s)`,
    },
  ];
}

/**
 * 3i. The annotation control list: target size, and whether a row actually drives the track.
 *
 * The list exists for WCAG 2.5.8 — at this container's 500px floor an r=11 SVG pin is about 14 CSS px,
 * below the 24px minimum, and enlarging the radius is not available (at 875 aa neighbouring pins are
 * ~25 units apart, so r>12 makes the targets overlap and steal each other's clicks) — and for the
 * clusters three tiers cannot separate. So it has to be a real control rather than decoration:
 * measured in CSS pixels, and measured to move the picture.
 */
async function checkAnnotationControls(id: string, host: HTMLElement, t: Track): Promise<Check[]> {
  const sizeName = `${id}: every drawn annotation is also a large-target control`;
  const wiredName = `${id}: activating an annotation row selects the same feature in the track`;
  const details = host.querySelector("[data-annotation-list]") as HTMLDetailsElement | null;
  if (!details) {
    return [
      { name: sizeName, pass: false, detail: "no [data-annotation-list] disclosure in the tab" },
      { name: wiredName, pass: false, detail: "no [data-annotation-list] disclosure in the tab" },
    ];
  }
  // A closed <details> has no layout. Opening it the way a keyboard user would also proves the
  // disclosure has content rather than being an empty affordance.
  details.open = true;
  await nextFrame();
  const rows = Array.from(details.querySelectorAll("[data-annotation-row]")) as HTMLButtonElement[];
  const expectedRows = t.domains.length + t.spans.length + t.sites.length;
  const boxes = rows.map((row) => row.getBoundingClientRect());
  const tooSmall = rows
    .map((row, i) => ({ row, box: boxes[i] }))
    .filter(({ box }) => box.height < 24 || box.width < 24)
    .map(({ row, box }) => `"${(row.textContent || "").trim().slice(0, 22)}" ${Math.round(box.width)}x${Math.round(box.height)}px`);
  const sizeCheck: Check = {
    name: sizeName,
    pass: rows.length === expectedRows && tooSmall.length === 0,
    detail:
      rows.length !== expectedRows
        ? `${rows.length} row(s) for the ${expectedRows} annotation(s) the track drew`
        : tooSmall.length
          ? `under 24px: ${tooSmall.join("; ")}`
          : `${rows.length} rows, shortest ${Math.round(Math.min(...boxes.map((b) => b.height)))}px tall`,
  };

  const sitesByResidue = new Map<number, Track["sites"][number]>();
  for (const site of t.sites) {
    const residue = Number((site.name.match(/residue (\d+)/) || [])[1]);
    if (Number.isFinite(residue)) sitesByResidue.set(residue, site);
  }
  const row = rows.find(
    (r) =>
      r.getAttribute("data-annotation-kind") === "site" &&
      sitesByResidue.has(Number(r.getAttribute("data-annotation-start")))
  );
  const site = row ? sitesByResidue.get(Number(row.getAttribute("data-annotation-start"))) : undefined;
  if (!row || !site) {
    return [sizeCheck, { name: wiredName, pass: false, detail: "no annotation row maps to a drawn pin" }];
  }
  // An earlier check clicks a pin directly, so this feature may already be selected; clear it first or
  // the transition below would be a deselection and the check would fail for the wrong reason.
  if (row.getAttribute("aria-pressed") === "true") {
    row.click();
    await nextFrame();
  }
  const pinRadius = () => (site.g.querySelectorAll("circle")[1] as SVGCircleElement)?.r.baseVal.value ?? 0;
  const before = { r: pinRadius(), fill: getComputedStyle(site.pinEl).fill };
  row.click();
  await nextFrame();
  const pressed = row.getAttribute("aria-pressed");
  const after = { r: pinRadius(), fill: getComputedStyle(site.pinEl).fill };
  row.click(); // the selection toggles, so this leaves the track as it was found
  await nextFrame();
  const cleared = row.getAttribute("aria-pressed") === "false" && pinRadius() === before.r;
  return [
    sizeCheck,
    {
      name: wiredName,
      pass: pressed === "true" && after.r > before.r && after.fill !== before.fill && cleared,
      detail: `pressed=${pressed}, pin r ${before.r}→${after.r}, fill ${before.fill}→${after.fill}, clears again=${cleared}`,
    },
  ];
}

/**
 * 3j. Panning moves the window without resizing it.
 *
 * The scrubber renders only above 1×, so this belongs to the zoomed cases. Zoom had coverage — the
 * window narrows, clipping is applied — but nothing asserted that panning does anything, or that it
 * does not also change the scale, which is the one thing a pan control must not do.
 */
async function checkPan(id: string, host: HTMLElement): Promise<Check[]> {
  const name = `${id}: panning moves the window without resizing it`;
  const pan = Array.from(host.querySelectorAll("input[type=range]")).find((input) =>
    /Pan horizontally/.test(input.getAttribute("title") || "")
  ) as HTMLInputElement | undefined;
  if (!pan) return [{ name, pass: false, detail: "no pan scrubber in the toolbar (it renders only above 1×)" }];

  const readWindow = () => {
    const read = readTrack(host);
    if ("error" in read) return null;
    const { rulerStart, rulerEnd } = read.track;
    return rulerStart === null || rulerEnd === null ? null : { start: rulerStart, end: rulerEnd };
  };
  const before = readWindow();
  if (!before) return [{ name, pass: false, detail: "could not read the ruler's window before panning" }];

  // A controlled range input ignores a plain `value = …`: React reads its own tracker, so the write has
  // to go through the native setter and be announced with the event React listens for.
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!nativeSetter) return [{ name, pass: false, detail: "no native value setter on HTMLInputElement" }];
  const original = pan.value;
  nativeSetter.call(pan, "0.9");
  pan.dispatchEvent(new Event("input", { bubbles: true }));
  await nextFrame();
  const after = readWindow();
  // Put the scrubber back where it was, so the case's screenshot and any later check see the window the
  // assertions above were about.
  nativeSetter.call(pan, original);
  pan.dispatchEvent(new Event("input", { bubbles: true }));
  await nextFrame();
  const restored = readWindow();
  if (!after || !restored) return [{ name, pass: false, detail: "could not read the ruler's window after panning" }];

  const widthBefore = before.end - before.start;
  const widthAfter = after.end - after.start;
  const moved = after.start > before.start;
  // The ruler labels are rounded integers, so a resize shows up as a width change of a residue or more.
  const sameWidth = Math.abs(widthAfter - widthBefore) <= 1;
  const putBack = Math.abs(restored.start - before.start) <= 1 && Math.abs(restored.end - before.end) <= 1;
  return [
    {
      name,
      pass: moved && sameWidth && putBack,
      detail: `window ${before.start}–${before.end} → ${after.start}–${after.end} (width ${widthBefore} → ${widthAfter}); returned to ${restored.start}–${restored.end}`,
    },
  ];
}

/**
 * 3h. The metric chip and the provenance chip must be the same box.
 *
 * "Length: 711 aa" sits immediately beside "UniProtKB & InterPro" and was reported as discrepant. The
 * value was right; the chip was a hand-rolled `text-[9.5px] px-2 py-0.5 rounded` with muted text while
 * its neighbour used `.badge-data-source` with its own padding, radius and type size — two chips in one
 * row with different heights and type. They now share one box, and this measures that rather than
 * trusting the class names, because class names are exactly what drifted.
 */
const BADGE_BOX_PROPERTIES = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopLeftRadius",
  "borderTopWidth",
  "fontSize",
  "fontWeight",
] as const;

function checkBadgeGrammar(id: string, host: HTMLElement): Check[] {
  const metric = host.querySelector(".badge-metric") as HTMLElement | null;
  const source = host.querySelector(".badge-data-source") as HTMLElement | null;
  const name = `${id}: the metric chip and the provenance chip share one box`;
  if (!metric || !source) {
    return [
      {
        name,
        pass: false,
        detail: `metric chip ${metric ? "found" : "MISSING"}, provenance chip ${source ? "found" : "MISSING"} in the same row`,
      },
    ];
  }
  const differences: string[] = [];
  const metricBox = metric.getBoundingClientRect();
  const sourceBox = source.getBoundingClientRect();
  if (Math.abs(metricBox.height - sourceBox.height) > 0.5) {
    differences.push(`height ${metricBox.height}px vs ${sourceBox.height}px`);
  }
  for (const property of BADGE_BOX_PROPERTIES) {
    const a = getComputedStyle(metric)[property];
    const b = getComputedStyle(source)[property];
    if (a !== b) differences.push(`${property} ${a} vs ${b}`);
  }
  return [
    {
      name,
      pass: differences.length === 0,
      detail: differences.length
        ? differences.join("; ")
        : `identical box: ${Math.round(metricBox.height)}px tall, padding ${getComputedStyle(metric).padding}, radius ${getComputedStyle(metric).borderTopLeftRadius}, font ${getComputedStyle(metric).fontSize}`,
    },
  ];
}

/**
 * 3e. The zoomed window. Every other case renders at 1×, so band clipping under zoom was entirely
 * unverified. The mapping check cannot run here — a band clipped to the visible window legitimately
 * has a different extent than its full residue range — so this replaces it for the zoomed case and
 * asserts what zoom must actually do: narrow the window, keep the residues in order, and keep the
 * rendered subset inside the visible span.
 */
function checkZoomWindow(id: string, t: Track, expectedResidues: number[]): Check[] {
  const errors: string[] = [];
  const windowText = Array.from(t.svg.querySelectorAll("text")).map((x) => (x.textContent || "").trim());
  const start = t.rulerStart;
  const end = t.rulerEnd;
  if (start === null || end === null) errors.push("could not read the ruler labels after zooming");
  else {
    if (end - start >= 875) errors.push(`the window did not narrow (${start}–${end})`);
    if (start > end) errors.push(`window is inverted (${start} > ${end})`);
    for (const residue of expectedResidues) {
      if (residue < start || residue > end) errors.push(`residue ${residue} is outside the reported window ${start}–${end}`);
    }
  }
  // Off-window lollipops legitimately keep geometry outside the rail: they are clipped by the
  // track's clipPath, and `getBBox` ignores clipping. What must hold is that they ARE inside a
  // clipped group (so nothing paints outside the track) and that the window still shows something.
  const unclipped = t.sites.filter((s) => !s.g.closest("[clip-path]"));
  if (unclipped.length) errors.push(`${unclipped.length} pin(s) are not inside a clipped group — off-window sites would paint outside the track`);
  const visibleBands = t.domains.filter((d) => d.blockBox.right > t.rail.x && d.blockBox.x < t.rail.right);
  const visibleSpans = t.spans.filter((s) => s.barBox.right > t.rail.x && s.barBox.x < t.rail.right);
  const visiblePins = t.sites.filter((s) => s.pin.x + s.pin.w > t.rail.x && s.pin.x < t.rail.right);
  // "Something is visible" is the real requirement — the phosphoserine may be the only point site
  // and it may sit outside the window, in which case bands or spans carry the view.
  if (!visibleBands.length && !visibleSpans.length && !visiblePins.length) {
    errors.push("nothing is visible in the zoomed window (no band, span or pin)");
  }

  return [
    {
      name: `${id}: zooming narrows the window and keeps the track consistent`,
      pass: errors.length === 0,
      detail: errors.length
        ? errors.join("; ")
        : `window ${start}–${end}, ${visibleBands.length}/${t.domains.length} bands, ${visibleSpans.length}/${t.spans.length} spans and ${visiblePins.length}/${t.sites.length} pins visible, all shapes clipped`,
    },
  ];
}

function checkVariantCallout(id: string, t: Track): Check[] {
  const checks: Check[] = [];
  if (!t.callout) {
    return [{ name: `${id}: variant callout rendered`, pass: false, detail: 'no [data-track="variant-marker"] group in the track' }];
  }

  // 4. The callout pill must not sit on top of a domain block, and must stay inside the rail it
  //    annotates (a clamp that stopped working would put it off the end of the track).
  const pillHits = t.domains.filter((d) => intersects(t.callout!.pill, d.blockBox));
  checks.push({
    name: `${id}: variant callout pill clears every domain block`,
    pass: pillHits.length === 0 && t.callout.pill.x >= t.rail.x - 0.5 && t.callout.pill.right <= t.rail.right + 0.5,
    detail: pillHits.length
      ? `pill overlaps ${pillHits.map((d) => d.name).join("; ")}`
      : `pill [${t.callout.pill.x}..${t.callout.pill.right}] inside rail [${t.rail.x}..${t.rail.right}]`,
  });

  // 5. The callout's own text must fit inside its pill.
  const tt = t.callout.text;
  const textInside = !!tt && tt.x >= t.callout.pill.x - 0.5 && tt.right <= t.callout.pill.right + 0.5;
  checks.push({
    name: `${id}: variant callout text fits inside its pill`,
    pass: textInside,
    detail: tt
      ? `text [${tt.x}..${tt.right}] vs pill [${t.callout.pill.x}..${t.callout.pill.right}]`
      : "no callout text",
  });

  // 6. Nothing the variant marker paints may overlap a domain label at all, and nothing may reach
  //    into the band beyond the caret's own tip: the marker's job is to *touch* the band's top edge
  //    at the variant's x, so a sub-unit graze from its stroke is the pointer working, while the
  //    11-unit penetration of the old rail beacon is the reported overlap.
  const BAND_GRAZE_TOLERANCE = 1;
  const collisions: string[] = [];
  for (const [shape, b] of t.callout.shapes) {
    for (const d of t.domains) {
      if (d.label && intersects(b, d.label)) collisions.push(`${shape} × ${d.name.slice(0, 18)} label`);
      if (intersects(b, d.blockBox)) {
        const depth = px(Math.min(b.bottom, d.blockBox.bottom) - Math.max(b.y, d.blockBox.y));
        if (depth > BAND_GRAZE_TOLERANCE) collisions.push(`${shape} reaches ${depth} units into ${d.name.slice(0, 18)}`);
      }
    }
  }
  const labelledCount = t.domains.filter((d) => d.label).length;
  checks.push({
    name: `${id}: variant marker clears domain labels and blocks`,
    pass: collisions.length === 0 && labelledCount === t.domains.length,
    detail: collisions.length
      ? collisions.join("; ")
      : labelledCount !== t.domains.length
        ? `${labelledCount}/${t.domains.length} labels rendered — comparison would be vacuous`
        : `${t.callout.shapes.length} marker shape(s) clear of ${labelledCount} labels`,
  });

  return checks;
}

/**
 * 7/8. Click-produced rings. Both checks were DEAD in the first revision of this harness: they
 * dispatched a synthetic click and read the DOM in the same task, so React had not re-rendered and
 * they measured the *unselected* track — the recorded mutation run shows "no hollow ring shapes"
 * passing while the ring was reintroduced. They now await a flush first, positively assert the
 * state they think they created, and only then look for the decoration.
 */
async function checkNoFocusRings(id: string, t: Track): Promise<Check[]> {
  const checks: Check[] = [];

  const ptm = t.sites.find((s) => /761/.test(s.name)) ?? t.sites.find((s) => /residue \d+/.test(s.name));
  if (!ptm) {
    checks.push({ name: `${id}: selecting a site paints no ring around the pinhead`, pass: false, detail: "no point site to click" });
    return checks;
  }
  const pinRadius = (s: typeof ptm) => (s.g.querySelectorAll("circle")[1] as SVGCircleElement)?.r.baseVal.value ?? 0;
  const before = pinRadius(ptm);
  ptm.g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextFrame();
  const after = pinRadius(ptm);
  const stemStroke = getComputedStyle(ptm.g.querySelector("line") as SVGLineElement).stroke;
  const selected = after > before || ptm.g.getAttribute("aria-pressed") === "true";

  const hollowAfterSiteClick = Array.from(t.svg.querySelectorAll("circle"))
    .filter((c) => {
      const cs = getComputedStyle(c);
      const fill = cs.fill;
      const unfilled = fill === "none" || fill === "transparent" || fill.startsWith("rgba(0, 0, 0, 0)");
      return unfilled && cs.stroke !== "none" && parseFloat(cs.strokeWidth || "0") > 0;
    })
    .map((c) => `${(c.parentElement?.getAttribute("aria-label") || "circle").slice(0, 24)} r=${c.r.baseVal.value}`);
  checks.push({
    name: `${id}: selecting a site paints no ring around the pinhead`,
    pass: selected && hollowAfterSiteClick.length === 0,
    detail: selected
      ? hollowAfterSiteClick.length
        ? hollowAfterSiteClick.join("; ")
        : `pin head grew r=${before}→${after} (stem ${stemStroke}) and no hollow ring shape exists`
      : `could not confirm the selection took effect (r ${before}→${after}) — the ring check would be vacuous`,
  });

  // 8. Clicking a domain must not restyle its block border. A thicker/brighter stroke on the
  //    selected block (or on the block holding the variant) is the "focus ring on domains"
  //    report; selection and containment are carried by the fill and the inspector instead.
  const target = t.domains.find((d) => /CBS 2/i.test(d.name)) ?? t.domains[0];
  if (!target) {
    checks.push({ name: `${id}: selecting a domain does not give its block a ring`, pass: false, detail: "no domain block to click" });
    return checks;
  }
  target.g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await nextFrame();
  (document.activeElement as HTMLElement | null)?.blur();
  const clickedSelected = target.g.getAttribute("aria-pressed") === "true";
  const strokes = t.domains.map((d) => {
    const cs = getComputedStyle(d.block);
    return `${d.name.slice(7, 22)}=${cs.stroke}/${cs.strokeWidth}`;
  });
  const unique = new Set(strokes.map((s) => s.split("=")[1]));
  checks.push({
    name: `${id}: selecting a domain does not give its block a ring`,
    pass: clickedSelected && unique.size === 1,
    detail: !clickedSelected
      ? "the clicked domain did not report itself selected — the check would be vacuous"
      : unique.size === 1
        ? `uniform stroke ${[...unique][0]}`
        : `non-uniform: ${strokes.join(" | ")}`,
  });

  return checks;
}

/**
 * 7b. Keyboard focus must be visible on the track's shapes.
 *
 * `focus-visible:outline-none` was on all three SVG groups with nothing replacing it, so a sighted
 * keyboard user could tab through every domain and every pin with no indication of where they were
 * — and no assertion in this harness could see it (reported by review, not by the harness). This
 * focuses each shape and requires the indicator to actually change something painted.
 */
function checkKeyboardFocusIndicator(id: string, t: Track): Check[] {
  const checks: Check[] = [];
  const targets: Array<[string, Element, SVGGraphicsElement]> = [
    ...t.domains.map((d) => [`domain ${d.name.slice(7, 22)}`, d.g as Element, d.block as SVGGraphicsElement] as [string, Element, SVGGraphicsElement]),
    ...t.sites.map((s) => [`site ${s.name.slice(16, 34)}`, s.g as Element, s.pinEl as unknown as SVGGraphicsElement] as [string, Element, SVGGraphicsElement]),
  ];
  if (!targets.length) return [{ name: `${id}: keyboard focus is visible on track shapes`, pass: false, detail: "no focusable track shapes" }];

  const paint = (el: SVGGraphicsElement) => {
    const cs = getComputedStyle(el);
    return `${cs.stroke}|${cs.strokeWidth}|${cs.outlineStyle}|${cs.outlineWidth}`;
  };

  const blind: string[] = [];
  for (const [name, group, shape] of targets) {
    (document.activeElement as HTMLElement | null)?.blur();
    const unfocused = paint(shape);
    (group as SVGGElement).focus();
    const focusedVisible = (group as Element).matches(":focus-visible");
    const focused = paint(shape);
    if (!focusedVisible) blind.push(`${name}: :focus-visible did not match after focus()`);
    else if (focused === unfocused) blind.push(`${name}: focused paint unchanged (${focused})`);
  }
  (document.activeElement as HTMLElement | null)?.blur();

  checks.push({
    name: `${id}: keyboard focus is visible on track shapes`,
    pass: blind.length === 0,
    detail: blind.length ? blind.join("; ") : `${targets.length} shapes change their painted stroke when focused`,
  });
  return checks;
}

/* ── Inventory checks ──────────────────────────────────────────────────────────── */

function pillByText(host: HTMLElement, re: RegExp): HTMLButtonElement | null {
  return (Array.from(host.querySelectorAll("button")) as HTMLButtonElement[]).find((b) => re.test(b.textContent || "")) ?? null;
}

/** A chip is either a selectable button or a non-interactive informational span. */
function chipByText(host: HTMLElement, re: RegExp): { el: Element; button: HTMLButtonElement | null; printed: number } | null {
  const els = Array.from(host.querySelectorAll("button, span")).filter((el) => re.test(el.textContent || ""));
  if (!els.length) return null;
  const el = els[0];
  return {
    el,
    button: el.tagName.toLowerCase() === "button" ? (el as HTMLButtonElement) : null,
    printed: Number((el.textContent || "").match(/\d+/)?.[0] ?? NaN),
  };
}

type ExpectedCounts =
  | typeof EXPECTED_CNNM2_COUNTS
  | typeof EXPECTED_COVERAGE_COUNTS
  | typeof EXPECTED_GZF1_COUNTS
  | typeof EXPECTED_CROWDED_COUNTS;

const CHIP_SPEC: Array<[keyof ExpectedCounts, RegExp]> = [
  ["domain", /Domain/i],
  ["active", /Active Site/i],
  ["binding", /Binding Site/i],
  ["ptm", /\bPTMs?\b/i],
  ["disulfide", /Disulfide/i],
  ["transmembrane", /Transmembrane/i],
  ["other", /Other Sites?/i],
];

async function checkInventory(host: HTMLElement, id: string, want: ExpectedCounts, features: ReadonlyArray<{ type: string; start: number; end: number }>): Promise<Check[]> {
  const checks: Check[] = [];

  // 9. Every inventory category is rendered with its count, and the count is the hand-written
  //    expectation from the live payload — not recomputed from the fixture handed to the
  //    component, which would silently agree with a wrong fixture.
  const missing: string[] = [];
  const wrongCount: string[] = [];
  for (const [key, re] of CHIP_SPEC) {
    const chip = chipByText(host, re);
    if (!chip) {
      missing.push(key);
      continue;
    }
    if (chip.printed !== want[key]) wrongCount.push(`${key}: printed ${chip.printed}, expected ${want[key]}`);
  }
  checks.push({
    name: `${id}: inventory lists every category with the right count`,
    pass: missing.length === 0 && wrongCount.length === 0,
    detail: missing.length
      ? `missing chips: ${missing.join(", ")}`
      : wrongCount.length
        ? wrongCount.join("; ")
        : CHIP_SPEC.map(([k]) => `${k}=${want[k]}`).join(" "),
  });

  // 9b. Curated spans are drawn on the span lane, so the chip discloses how many there are and what
  //     the lane means — previously these were withheld from the track and disclosed as "Regions
  //     (not plotted)". The chip must render even at zero, like every other category.
  const spanEl = Array.from(host.querySelectorAll("span")).find((n) => /^\d+ Spans?( \(span lane\))?$/.test((n.textContent || "").trim()));
  const spanCount = Number((spanEl?.textContent || "").match(/\d+/)?.[0] ?? NaN);
  checks.push({
    name: `${id}: the plotted span count is disclosed`,
    pass: !!spanEl && spanCount === want.spans,
    detail: spanEl ? `"${(spanEl.textContent || "").trim()}" (expected ${want.spans})` : `no span chip (expected ${want.spans})`,
  });

  // 10. A category with nothing to show must not behave like a filter that empties the track.
  //     It is rendered as information, so there is nothing to click and nothing to dim.
  const emptyChip = chipByText(host, /Active Site/i);
  const domainBlock = host.querySelector('g[aria-label^="Domain:"]') as SVGGElement | null;
  if (want.active === 0 && emptyChip && domainBlock) {
    const before = settledOpacity(domainBlock);
    emptyChip.button?.click();
    await nextFrame();
    const after = settledOpacity(domainBlock);
    checks.push({
      name: `${id}: a zero-count category is not offered as a filter`,
      pass: emptyChip.button === null && Math.abs(after - before) < 0.01,
      detail: `${emptyChip.button === null ? "rendered as information" : "STILL A BUTTON"}; domain opacity ${before}→${after} (must not change)`,
    });
  } else if (want.active > 0 && emptyChip) {
    checks.push({
      name: `${id}: a zero-count category is not offered as a filter`,
      pass: true,
      detail: `not applicable here — this fixture has ${want.active} active site(s), so the chip is a filter`,
    });
  } else {
    checks.push({ name: `${id}: a zero-count category is not offered as a filter`, pass: false, detail: "no Active Site chip or domain group" });
  }

  // 11. Every filterable chip must (a) mark itself pressed, (b) dim exactly the annotations it
  //     excludes, and (c) clear when clicked again. Checked for EVERY filterable category, not just
  //     PTM, and over BOTH rendered geometries — a chip counts features, and a feature is drawn as
  //     a pin or as a span bar depending on how it is annotated, so a filter that only dims pins
  //     would leave the transmembrane helices lit under every chip.
  const shapes: Array<{ el: SVGGElement; type: string }> = [
    ...Array.from(host.querySelectorAll('g[aria-label^="Functional site:"]')).map((g) => ({
      el: g as SVGGElement,
      type: (g.getAttribute("aria-label") || "").replace(/^Functional site:\s*/, "").split(" at residue")[0].trim(),
    })),
    ...Array.from(host.querySelectorAll('g[aria-label^="Curated span:"]')).map((g) => ({
      el: g as SVGGElement,
      // "Curated span: Zinc finger C2H2-type 1 at residues 317 to 340" — the type is the first two
      // words only when the description is multi-word, so the type comes from the fixture instead.
      type: (g.getAttribute("aria-label") || "").replace(/^Curated span:\s*/, "").split(" at residues")[0].trim(),
    })),
  ];
  const typeOfSpanShape = (label: string): string => {
    const description = label.replace(/^Curated span:\s*/, "").split(" at residues")[0].trim();
    // Match the fixture's longest type that prefixes the description, so "Zinc finger C2H2-type 1"
    // resolves to "Zinc finger" and "Compositional bias Low complexity" to "Compositional bias".
    const known = Array.from(new Set(features.map((f) => f.type))).sort((a, b) => b.length - a.length);
    return known.find((t) => description.toLowerCase().startsWith(t.toLowerCase())) ?? description;
  };
  for (const shape of shapes) {
    if (shape.type.includes(" ") && !features.some((f) => f.type === shape.type)) shape.type = typeOfSpanShape(shape.type);
  }
  const filterable = CHIP_SPEC.filter(([key]) => want[key] > 0);
  const failures: string[] = [];
  const transcripts: string[] = [];
  for (const [key, re] of filterable) {
    const chip = chipByText(host, re);
    if (!chip?.button) {
      failures.push(`${key}: not a selectable button although its count is ${want[key]}`);
      continue;
    }
    // The chip counts every feature in the category, so the rendered shapes it must keep lit are
    // those whose type matches the harness's own oracle for that category.
    const matching = features.filter((f) => categoryMatchesType(f.type, key));
    if (matching.length !== want[key]) {
      failures.push(`${key}: the fixture has ${matching.length} matching features but the expected count is ${want[key]} — the oracle is wrong`);
      continue;
    }
    const expectedKept = shapes.filter((s) => categoryMatchesType(s.type, key)).length;
    const opacityOf = () => shapes.map((s) => settledOpacity(s.el));
    const before = opacityOf();
    chip.button.click();
    await nextFrame();
    const pressed = chip.button.getAttribute("aria-pressed");
    const during = opacityOf();
    const kept = during.filter((o) => o >= 0.99).length;
    const dimmed = during.filter((o) => o < 0.5).length;
    const fullyDimmed = dimmed === during.length - expectedKept;
    const keepsTheRightNumber = kept === expectedKept;
    const opacitiesValid = during.every((o) => o >= 0.99 || o <= 0.5);
    chip.button.click();
    await nextFrame();
    const restored = opacityOf().every((o, i) => Math.abs(o - before[i]) < 0.01);
    const ok = pressed === "true" && fullyDimmed && keepsTheRightNumber && opacitiesValid && restored;
    if (!ok) {
      failures.push(`${key}: pressed=${pressed} dimmed=${dimmed}/${during.length - expectedKept} kept=${kept}/${expectedKept} halftones=${!opacitiesValid} restored=${restored}`);
    }
    transcripts.push(`${key}: kept ${kept}/${expectedKept}`);
  }
  const renderedShapes = shapes.length;
  const expectedShapes = want.plottedSites + want.spans;
  checks.push({
    name: `${id}: every filterable chip dims exactly what it excludes`,
    pass: failures.length === 0 && filterable.length > 0 && renderedShapes === expectedShapes,
    detail: failures.length
      ? failures.join("; ")
      : renderedShapes !== expectedShapes
        ? `rendered ${renderedShapes} annotation shapes (${want.plottedSites} pins + ${want.spans} spans expected) — filter comparison would be incomplete`
        : `${filterable.length} filter(s) exercised over ${renderedShapes} shapes — ${transcripts.join(", ")}`,
  });

  // 12. The default (unfiltered) residue read-out must agree with the Domain filter: the
  //     variant is inside CBS 1, so the Domain pill finds it — but it used to report "no direct
  //     annotations" by default because the default set excluded domains.
  const annotationHeading = () => {
    const heads = Array.from(host.querySelectorAll("span, p")).map((n) => n.textContent || "");
    return heads.find((s) => /Direct Curated Annotations/i.test(s)) ?? "";
  };
  const domainChip = pillByText(host, /Domain/i);
  if (domainChip && id === "cbs1") {
    const unfilteredHeading = annotationHeading();
    const emptyStateUnfiltered = (host.textContent || "").includes("No domain, catalytic active site");
    const listsCbs1 = (host.textContent || "").includes("CBS 1");
    domainChip.click();
    await nextFrame();
    const filteredHeading = annotationHeading();
    const domainMatch = /1 match/i.test(host.textContent || "");
    domainChip.click();
    await nextFrame();
    checks.push({
      name: `${id}: default read-out and the Domain filter agree on CBS 1`,
      pass: unfilteredHeading !== "" && listsCbs1 && domainMatch && !emptyStateUnfiltered,
      detail: `unfiltered heading "${unfilteredHeading}" (filtered: "${filteredHeading}"); domain filter finds=${domainMatch}; unfiltered empty-state=${emptyStateUnfiltered}`,
    });
  }

  return checks;
}

/* ── Legend ────────────────────────────────────────────────────────────────────── */

/**
 * The inspector's "Feature Types & Palette" legend, measured against the track it claims to
 * describe.
 *
 * The legend is a second surface that makes a claim about every other surface, and it was wrong:
 * four of its five swatches named colours no shape in the track was painted with (indigo domains,
 * amber binding sites, emerald PTMs, cyan disulfides) and transmembrane regions and the remaining
 * curated sites had no entry at all. Reading the markup cannot catch a wrong hex — that is how those
 * swatches survived — so the legend is rendered here and every swatch is compared with the colour
 * the track actually painted for that category, read off the rendered shapes.
 *
 * The category list is written out rather than imported from the palette: an oracle that reads the
 * module it is checking agrees with it by construction.
 */
const LEGEND_KINDS = ["domain", "active", "binding", "ptm", "disulfide", "transmembrane", "other"] as const;
const LEGEND_SHAPES = ["point", "span"] as const;

/** "Functional site: … at residue 761" / "Curated span: … at residues 317 to 340". */
function residueSpanFromLabel(label: string): { start: number; end: number } | null {
  const span = label.match(/at residues (\d+) to (\d+)/);
  if (span) return { start: Number(span[1]), end: Number(span[2]) };
  const point = label.match(/at residue (\d+)/);
  if (point) return { start: Number(point[1]), end: Number(point[1]) };
  return null;
}

/** A domain band is filled with a gradient, so its colour lives in the gradient's stops. */
function gradientStopColors(svg: SVGSVGElement, fill: string): string[] {
  const id = fill.match(/url\(["']?#([^)"']+)/)?.[1];
  if (!id) return [];
  const gradient = svg.querySelector(`#${CSS.escape(id)}`);
  if (!gradient) return [];
  return Array.from(gradient.querySelectorAll("stop")).map((stop) => getComputedStyle(stop).stopColor);
}

function checkLegend(
  root: ParentNode,
  t: Track | null,
  features: Array<{ type: string; start: number }>
): Check[] {
  const checks: Check[] = [];
  const swatches = Array.from(root.querySelectorAll("[data-legend-kind]"));
  const keys = swatches.map((s) => s.getAttribute("data-legend-kind") || "");
  const missing = LEGEND_KINDS.filter((k) => !keys.includes(k));
  const unexpected = keys.filter((k) => !(LEGEND_KINDS as readonly string[]).includes(k));
  checks.push({
    name: "legend: lists every category the track can paint, and nothing else",
    pass: missing.length === 0 && unexpected.length === 0 && keys.length === LEGEND_KINDS.length,
    detail:
      missing.length || unexpected.length || keys.length !== LEGEND_KINDS.length
        ? `${keys.length} swatch(es) [${keys.join(", ")}]; missing ${missing.join(", ") || "none"}; unexpected ${unexpected.join(", ") || "none"}`
        : `${keys.length} swatches, one per category`,
  });

  // What the track painted, per category, from the rendered shapes of the coverage case (the one
  // fixture with a feature in every category). Pins and bars have a flat fill that must equal the
  // swatch exactly; a domain band is filled with a gradient, so the swatch has to be one of its
  // stops rather than all of them.
  const painted = new Map<string, Array<{ fill: string; source: string; flat: boolean }>>();
  const record = (key: string, fill: string, source: string, flat: boolean) => {
    painted.set(key, [...(painted.get(key) ?? []), { fill, source, flat }]);
  };
  if (t) {
    const featureAt = (start: number) => features.find((f) => f.start === start);
    const shapes: Array<{ label: string; fill: string; what: string }> = [
      ...t.sites.map((s) => ({ label: s.name, fill: getComputedStyle(s.pinEl).fill, what: "pin" })),
      ...t.spans.map((s) => ({ label: s.name, fill: getComputedStyle(s.bar).fill, what: "bar" })),
    ];
    for (const shape of shapes) {
      const loc = residueSpanFromLabel(shape.label);
      const feature = loc ? featureAt(loc.start) : undefined;
      if (!feature) continue;
      const where = shape.what === "pin" ? `pin @${loc!.start}` : `bar ${loc!.start}–${loc!.end}`;
      for (const key of LEGEND_KINDS) if (categoryMatchesType(feature.type, key)) record(key, shape.fill, where, true);
    }
    const domainBlock = t.domains[0]?.block;
    if (domainBlock) {
      for (const stop of gradientStopColors(t.svg, getComputedStyle(domainBlock).fill)) {
        record("domain", stop, "band gradient stop", false);
      }
    }
  }

  const sameColor = (a: string, b: string) => {
    const rgbA = parseRgb(a);
    const rgbB = parseRgb(b);
    return !!rgbA && !!rgbB && rgbA.join(",") === rgbB.join(",");
  };

  const mismatches: string[] = [];
  const agreed: string[] = [];
  const nothingPainted: string[] = [];
  for (const key of LEGEND_KINDS) {
    const swatch = swatches.find((s) => s.getAttribute("data-legend-kind") === key) as HTMLElement | undefined;
    if (!swatch) continue; // the coverage check above already reports a missing swatch
    const legendCss = getComputedStyle(swatch).backgroundColor;
    const sources = painted.get(key) ?? [];
    const flat = sources.filter((s) => s.flat);
    const stops = sources.filter((s) => !s.flat);
    if (!sources.length) {
      nothingPainted.push(key);
      continue;
    }
    const wrongFill = flat.find((s) => !sameColor(s.fill, legendCss));
    if (wrongFill) {
      mismatches.push(`${key}: track painted ${wrongFill.fill} (${wrongFill.source}) but the legend says ${legendCss}`);
    } else if (stops.length && !stops.some((s) => sameColor(s.fill, legendCss))) {
      mismatches.push(
        `${key}: the legend says ${legendCss}, which is not one of the band's gradient stops (${stops.map((s) => s.fill).join(", ")})`
      );
    } else {
      agreed.push(`${key} ${legendCss} across ${sources.length} source(s)`);
    }
  }
  checks.push({
    name: "legend: every swatch matches the colour the track paints for that category",
    pass: mismatches.length === 0 && nothingPainted.length === 0 && agreed.length === LEGEND_KINDS.length,
    detail: mismatches.length || nothingPainted.length
      ? [...mismatches, `nothing painted: ${nothingPainted.join(", ")}`].join("; ")
      : agreed.join(", "),
  });

  const shapeRows = Array.from(root.querySelectorAll("[data-legend-shape]")).map(
    (s) => s.getAttribute("data-legend-shape") || ""
  );
  const missingShapes = LEGEND_SHAPES.filter((s) => !shapeRows.includes(s));
  checks.push({
    name: "legend: the shape rows cover the geometries a site can have",
    pass: missingShapes.length === 0 && shapeRows.length === LEGEND_SHAPES.length,
    detail:
      missingShapes.length || shapeRows.length !== LEGEND_SHAPES.length
        ? `rows [${shapeRows.join(", ")}]; missing ${missingShapes.join(", ") || "none"}`
        : `rows [${shapeRows.join(", ")}] — a legend that only names kinds cannot explain why some annotations are bars`,
  });

  return checks;
}

/* ── Page ──────────────────────────────────────────────────────────────────────── */

/**
 * The number of assertions a complete run must produce, written out rather than counted at
 * runtime: the point of the self-check is to fail when a case silently stops contributing.
 * Per case: 6 geometry + 4 span lane + 1 residue mapping (or 1 zoom window) + 1 contrast + 3 callout
 * + 2 ring + 1 keyboard focus + 4 inventory + 1 pin tiers + 1 badge box + 2 annotation controls = 26;
 * a zoomed case adds the pan check, because the scrubber only renders above 1×; the reported case adds
 * the default-read-out check, the run adds the three legend checks (the legend is one component,
 * measured once), and the self-check. Update this deliberately when assertions are added.
 */
function expectedCheckCount(): number {
  const perCase = 26;
  const perZoomedCase = 1;
  const zoomedCases = CASES.filter((c) => (c as { zoomClicks?: number }).zoomClicks).length;
  const cbs1Extra = 1;
  const legend = 3;
  return CASES.length * perCase + zoomedCases * perZoomedCase + cbs1Extra + legend + 1;
}

function App(): React.ReactElement {
  const [report, setReport] = React.useState<{ ok: boolean; checks: Check[] } | null>(null);

  React.useEffect(() => {
    // Published after every case so a hang or throw in a later stage still yields evidence
    // (check.mjs reads #geometry-result out of --dump-dom, which is all-or-nothing).
    const publish = (checks: Check[]) => {
      const result = { ok: checks.every((c) => c.pass), checks: [...checks] };
      setReport(result);
      const sink = document.getElementById("geometry-result");
      // base64 so --dump-dom cannot mangle the JSON through HTML escaping
      if (sink) sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    };

    void (async () => {
      const checks: Check[] = [];
      const expectedCount = expectedCheckCount();
      try {
      // One macrotask so the child's layout effects (which measure the callout) have settled.
      await nextFrame();
      for (const c of CASES) {
        const host = document.getElementById(`host-${c.id}`);
        if (!host) {
          checks.push({ name: `${c.id}: harness host`, pass: false, detail: `no #host-${c.id} element — the case was never rendered` });
          continue;
        }
        const read = readTrack(host);
        if ("error" in read) {
          checks.push({ name: `${c.id}: renders a sequence track`, pass: false, detail: read.error });
          continue;
        }
        const track = read.track;
        const { features: fixture, want } = payloadFor(c.kind);
        const isCoverage = c.kind === "coverage";
        const zoomClicks = (c as { zoomClicks?: number }).zoomClicks ?? 0;
        const isZoomed = zoomClicks > 0;
        const spanExpectation = {
          spans: want.spans,
          points: want.plottedSites,
          spanLaneTop: SPAN_LANE.top,
          siteRailY: SPAN_LANE.siteRailY,
          // How many spans *should* claim the variant, from the fixture: the render's own claim
          // cannot be the expectation, or an implementation that stops claiming containment passes.
          enclosing: fixture.features.filter(
            (f) => isSpanType(f.type) && c.residue >= f.start && c.residue <= (f.end ?? f.start)
          ).length,
        };
        /** The four checks added with the control list, the badge row and the pin tiers. */
        const perCaseExtras = async (t: Track): Promise<Check[]> => [
          ...checkPinTiers(c.id, t),
          ...checkBadgeGrammar(c.id, host),
          ...(await checkAnnotationControls(c.id, host, t)),
        ];
        if (isZoomed) {
          // Zoom the way a user does, then re-read: clipping, label suppression and stem anchoring
          // all differ once the window is narrower than the protein. Zooming alone starts at
          // residue 1, so the variant is centred with the track's own "Focus Variant" control —
          // which exercises that path too.
          for (let i = 0; i < zoomClicks; i += 1) {
            const zoomIn = Array.from(host.querySelectorAll("button")).find((b) => /Zoom in/.test(b.getAttribute("title") || ""));
            if (!zoomIn) {
              checks.push({ name: `${c.id}: zoom control found`, pass: false, detail: 'no button titled "Zoom in (+0.5x)"' });
              break;
            }
            (zoomIn as HTMLButtonElement).click();
            await nextFrame();
          }
          if ((c as { focusVariant?: boolean }).focusVariant !== false) {
            const focusVariant = Array.from(host.querySelectorAll("button")).find((b) => /Focus Variant/.test(b.textContent || ""));
            if (!focusVariant) {
              checks.push({ name: `${c.id}: focus-variant control found`, pass: false, detail: 'no button labelled "Focus Variant"' });
            } else {
              (focusVariant as HTMLButtonElement).click();
              await nextFrame();
              await nextFrame();
            }
          }
          const reRead = readTrack(host);
          if ("error" in reRead) {
            checks.push({ name: `${c.id}: renders after zooming`, pass: false, detail: reRead.error });
            continue;
          }
          const zoomedTrack = reRead.track;
          checks.push(...checkTrackGeometry(c.id, zoomedTrack));
          checks.push(...checkSpanLane(c.id, zoomedTrack, spanExpectation));
          checks.push(...checkZoomWindow(c.id, zoomedTrack, [c.residue]));
          checks.push(...checkNonTextContrast(c.id, zoomedTrack));
          checks.push(...checkVariantCallout(c.id, zoomedTrack));
          checks.push(...(await checkNoFocusRings(c.id, zoomedTrack)));
          checks.push(...checkKeyboardFocusIndicator(c.id, zoomedTrack));
          checks.push(...(await checkInventory(host, c.id, want, fixture.features)));
          checks.push(...(await perCaseExtras(zoomedTrack)));
          // Last, because it moves the window and then puts it back.
          checks.push(...(await checkPan(c.id, host)));
          publish(checks);
          continue;
        }
        checks.push(...checkTrackGeometry(c.id, track));
        checks.push(...checkSpanLane(c.id, track, spanExpectation));
        checks.push(
          ...checkResidueMapping(c.id, track, {
            seqLength: fixture.sequenceLength,
            domains: want.domain,
            sites: want.plottedSites,
          })
        );
        checks.push(...checkNonTextContrast(c.id, track));
        checks.push(...checkVariantCallout(c.id, track));
        checks.push(...(await checkNoFocusRings(c.id, track)));
        checks.push(...checkKeyboardFocusIndicator(c.id, track));
        checks.push(...(await checkInventory(host, c.id, want, fixture.features)));
        checks.push(...(await perCaseExtras(track)));
        publish(checks);
      }

      // The legend describes every shape above, so it is measured against them — once, over the
      // coverage case, which is the only fixture with a feature in every category.
      const legendProbe = document.getElementById("legend-probe");
      const coverageHost = document.getElementById("host-coverage");
      const coverageRead = coverageHost ? readTrack(coverageHost) : null;
      checks.push(
        ...checkLegend(
          legendProbe ?? document,
          coverageRead && !("error" in coverageRead) ? coverageRead.track : null,
          COVERAGE_FEATURES.features
        )
      );
      publish(checks);

      // The runner must not be able to report success for a run that measured nothing: a missing
      // host, a renamed selector or a truncated virtual-time budget all shrink this number.
      // `+ 1` is this check itself, which is counted in `expectedCheckCount()`.
      checks.push({
        name: "harness: every case produced its full assertion set",
        pass: checks.length + 1 === expectedCount,
        detail: `${checks.length + 1} assertions from ${CASES.length} cases (expected ${expectedCount})`,
      });
      } catch (error) {
        // A throwing assertion must be a reported failure, never a silent exit-2.
        checks.push({ name: "harness", pass: false, detail: `threw: ${(error as Error)?.stack || String(error)}` });
      }

      publish(checks);

      // Leave the reported case focused so the screenshot shows the focus treatment: the
      // keyboard-focus check ends blurred, so this is a deliberately focused state for the PNG.
      const host = document.getElementById("host-cbs1");
      const domainG = host?.querySelectorAll('g[aria-label^="Domain:"]')[1] as SVGGElement | undefined;
      const siteG = host?.querySelector('g[aria-label^="Functional site:"]') as SVGGElement | undefined;
      domainG?.focus();
      siteG?.focus();
    })();
  }, []);

  return (
    <div style={{ background: "var(--cs-bg)", padding: 12 }}>
      <div id="geometry-report" style={{ maxHeight: 220, overflow: "auto", borderBottom: "1px solid #ddd", marginBottom: 8 }}>
        {report?.checks.map((c, i) => (
          <div key={i} style={{ font: "11px monospace", color: c.pass ? "#166534" : "#B91C1C", whiteSpace: "pre-wrap" }}>
            {c.pass ? "PASS" : "FAIL"} {c.name} — {c.detail}
          </div>
        ))}
      </div>
      {/* The inspector's legend, rendered once and measured against every case's track below. */}
      <div id="legend-probe" style={{ width: 380, marginBottom: 16 }}>
        <FeaturePaletteLegend />
      </div>
      {CASES.map((c) => {
        const features = payloadFor(c.kind).features;
        const wildType = (c as { wt?: string }).wt ?? "Ser";
        const mutant = (c as { mut?: string }).mut ?? "Cys";
        const result = resultFor(features, c.residue, wildType, mutant);
        const state = stateFor(result);
        const props: TabComponentProps = {
          analysisState: state,
          energyUnit: "kcal/mol",
          formatDdGValue: (v: number | null) => String(v ?? "—"),
          setSelectedMetric: () => {},
          onSelectResidue: () => {},
          onNavigateToView: () => {},
          isDark: false,
          classCard: "",
          classCardHeader: "",
          classCardTitle: "",
          classBorderSec: "",
          classTextBody: "",
          classTextMute: "",
          foldingDdG: null,
          foldingStatus: null,
        };
        return (
          <div key={c.id} id={`wrap-${c.id}`} style={{ width: c.width, marginBottom: 16 }}>
            <div style={{ font: "11px monospace", color: "#666" }}>{c.label}</div>
            <div id={`host-${c.id}`}>
              <FunctionTab {...props} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/*
 * A render-time crash leaves #geometry-result empty, which the runner can only report as "no report"
 * — no message and no stack. These handlers publish the exception into the same sink the checks use,
 * so a crash arrives as an assertion carrying the real error instead of as silence.
 */
function reportCrash(detail: string): void {
  const sink = document.getElementById("geometry-result");
  if (!sink) return;
  const report = { ok: false, checks: [{ name: "harness: rendered", pass: false, detail }] };
  sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
  const visible = document.getElementById("geometry-report");
  if (visible && !visible.textContent) visible.textContent = `FAIL harness: rendered — ${detail}`;
}
window.addEventListener("error", (event) => reportCrash(`uncaught: ${event.message}`));
window.addEventListener("unhandledrejection", (event) =>
  reportCrash(`unhandled rejection: ${String((event as PromiseRejectionEvent).reason)}`)
);

createRoot(document.getElementById("root")!).render(<App />);

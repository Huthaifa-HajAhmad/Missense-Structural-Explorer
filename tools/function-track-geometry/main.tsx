import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "./harness.css";
import { FunctionTab } from "../../src/components/evidence/FunctionInteractionsTabs";
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
 *  active/binding/disulfide/other annotation. */
const EXPECTED_CNNM2_COUNTS = {
  domain: 3,
  active: 0,
  binding: 0,
  ptm: 1,
  disulfide: 0,
  transmembrane: 3,
  other: 0,
  region: 2,
  plottedSites: 4,
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
    { type: "Domain", description: "Test domain", start: 10, end: 90 },
    { type: "Active site", description: "Proton acceptor", start: 40, end: 40 },
    { type: "Binding site", description: "Substrate", start: 60, end: 60 },
    { type: "Metal binding", description: "Zinc", start: 70, end: 70 },
    { type: "Disulfide bond", description: "Interchain", start: 100, end: 100 },
    { type: "Modified residue", description: "Phosphothreonine", start: 130, end: 130 },
    { type: "Transmembrane", description: "Helical", start: 160, end: 180 },
    { type: "Zinc finger", description: "RING-type", start: 200, end: 200 },
    { type: "Motif", description: "Nuclear localisation", start: 220, end: 220 },
    { type: "Region", description: "Disordered", start: 250, end: 280 },
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
  region: 1,
  plottedSites: 8, // every non-domain, non-region feature
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
 *  inter-domain gap, a zoomed window, plus the synthetic category-coverage case. */
const CASES = [
  { id: "cbs1", label: "p.Ser489Cys — inside CBS 1", residue: 489, width: 1010, kind: "cnnm2" },
  { id: "tm", label: "p.Ala300Val — inside CNNM transmembrane", residue: 300, width: 1010, wt: "Ala", mut: "Val", kind: "cnnm2" },
  { id: "gap", label: "p.Gly440Arg — inter-domain", residue: 440, width: 1010, wt: "Gly", mut: "Arg", kind: "cnnm2" },
  { id: "zoomed", label: "p.Ser489Cys at 3.5× — clipped bands", residue: 489, width: 1010, kind: "zoomed" },
  { id: "coverage", label: "synthetic category coverage (all seven chips)", residue: 60, width: 1010, wt: "Asp", mut: "Asn", kind: "coverage" },
] as const;

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
  markerLabel: string | null;
  rulerStart: number | null;
  rulerEnd: number | null;
  callout: { g: SVGGElement; pill: Box; text: Box | null; marker: Box | null; connector: Box | null; shapes: Array<[string, Box]> } | null;
}

function readTrack(host: HTMLElement): { track: Track } | { error: string } {
  // Anchor on a track shape first: the host also contains lucide icon <svg>s, so
  // `querySelector("svg")` would measure a 14px glyph.
  const anchor = host.querySelector('g[aria-label^="Domain:"], g[aria-label^="Functional site:"]');
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
      name: `${id}: pin and caret colours clear 3:1 on the light track`,
      pass: failing.length === 0 && measured.length > 0,
      detail: failing.length ? failing.join("; ") : measured.join(", "),
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
  if (!visibleBands.length) errors.push("no domain band is visible in the zoomed window");
  const visiblePins = t.sites.filter((s) => s.pin.x + s.pin.w > t.rail.x && s.pin.x < t.rail.right);
  if (!visiblePins.length) errors.push("no lollipop pin is visible in the zoomed window");

  return [
    {
      name: `${id}: zooming narrows the window and keeps the track consistent`,
      pass: errors.length === 0,
      detail: errors.length
        ? errors.join("; ")
        : `window ${start}–${end}, ${visibleBands.length}/${t.domains.length} bands and ${visiblePins.length}/${t.sites.length} pins visible, all shapes clipped`, 
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
  if (!ptm || t.sites.length < 2) {
    checks.push({ name: `${id}: selecting a site paints no ring around the pinhead`, pass: false, detail: "no selectable site to click" });
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

type ExpectedCounts = typeof EXPECTED_CNNM2_COUNTS | typeof EXPECTED_COVERAGE_COUNTS;

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

  // 9b. Curated regions are spans, not point sites, so they are counted but never plotted. They
  //     must still be disclosed — silently dropping fetched annotations is the failure mode this
  //     project keeps writing down — and the disclosure must render even when the count is zero,
  //     like every other category.
  const regionEl = Array.from(host.querySelectorAll("span")).find((n) => /Regions?/.test(n.textContent || "") && !/^\d+ (Domain|Active|Binding|PTM|Disulfide|Transmembrane|Other)/.test((n.textContent || "").trim()));
  const regionCount = Number((regionEl?.textContent || "").match(/\d+/)?.[0] ?? NaN);
  checks.push({
    name: `${id}: unplotted region annotations are disclosed`,
    pass: !!regionEl && regionCount === want.region,
    detail: regionEl ? `"${(regionEl.textContent || "").trim()}" (expected ${want.region})` : `no region chip (expected ${want.region})`,
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

  // 11. Every filterable chip must (a) mark itself pressed, (b) dim exactly the pins it excludes,
  //     and (c) clear when clicked again. Checked for EVERY filterable category, not just PTM:
  //     with the CNNM2 payload alone, four of the seven chips were never exercised at all.
  //     Which pins a chip must keep lit is decided by the harness's own oracle over the fixture
  //     types, not by reading the pins' labels back out of the DOM.
  const siteGroups = Array.from(host.querySelectorAll('g[aria-label^="Functional site:"]')) as SVGGElement[];
  const filterable = CHIP_SPEC.filter(([key]) => want[key] > 0);
  const failures: string[] = [];
  const transcripts: string[] = [];
  for (const [key, re] of filterable) {
    const chip = chipByText(host, re);
    if (!chip?.button) {
      failures.push(`${key}: not a selectable button although its count is ${want[key]}`);
      continue;
    }
    // The chip counts every feature in the category (bands included); the opacity expectation
    // only covers the ones the track draws as pins — the Domain filter legitimately keeps none.
    const matching = features.filter((f) => categoryMatchesType(f.type, key));
    const expectedKept = matching.filter((f) => isPlottedSite(f.type)).length;
    if (matching.length !== want[key]) {
      failures.push(`${key}: the fixture has ${matching.length} matching features but the expected count is ${want[key]} — the oracle is wrong`);
      continue;
    }
    const opacityOf = () => siteGroups.map((g) => settledOpacity(g));
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
  checks.push({
    name: `${id}: every filterable chip dims exactly what it excludes`,
    pass: failures.length === 0 && filterable.length > 0 && siteGroups.length === want.plottedSites,
    detail: failures.length
      ? failures.join("; ")
      : siteGroups.length !== want.plottedSites
        ? `rendered ${siteGroups.length} pins, fixture plots ${want.plottedSites} — filter comparison would be incomplete`
        : `${filterable.length} filter(s) exercised over ${siteGroups.length} pins — ${transcripts.join(", ")}`,
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

/* ── Page ──────────────────────────────────────────────────────────────────────── */

/**
 * The number of assertions a complete run must produce, written out rather than counted at
 * runtime: the point of the self-check is to fail when a case silently stops contributing.
 * Per 1× case: 6 geometry + 1 residue mapping + 1 contrast + 3 callout + 2 ring + 1 keyboard focus
 * + 4 inventory = 18; the zoomed case swaps the mapping check for the zoom-window check (18); the
 * reported case adds the default-read-out check, and the run adds this self-check.
 * Update this deliberately when assertions are added.
 */
function expectedCheckCount(): number {
  const perCase = 18;
  const cbs1Extra = 1;
  return CASES.length * perCase + cbs1Extra + 1;
}

/** How many times the harness clicks "Zoom in (+0.5x)" for the zoomed case (→ 3.5×, a 250 aa window). */
const ZOOM_IN_CLICKS = 5;

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
        const want = c.kind === "coverage" ? EXPECTED_COVERAGE_COUNTS : EXPECTED_CNNM2_COUNTS;
        const isCoverage = c.kind === "coverage";
        const isZoomed = c.kind === "zoomed";
        if (isZoomed) {
          // Zoom the way a user does, then re-read: clipping, label suppression and stem anchoring
          // all differ once the window is narrower than the protein. Zooming alone starts at
          // residue 1, so the variant is centred with the track's own "Focus Variant" control —
          // which exercises that path too.
          for (let i = 0; i < ZOOM_IN_CLICKS; i += 1) {
            const zoomIn = Array.from(host.querySelectorAll("button")).find((b) => /Zoom in/.test(b.getAttribute("title") || ""));
            if (!zoomIn) {
              checks.push({ name: `${c.id}: zoom control found`, pass: false, detail: 'no button titled "Zoom in (+0.5x)"' });
              break;
            }
            (zoomIn as HTMLButtonElement).click();
            await nextFrame();
          }
          const focusVariant = Array.from(host.querySelectorAll("button")).find((b) => /Focus Variant/.test(b.textContent || ""));
          if (!focusVariant) {
            checks.push({ name: `${c.id}: focus-variant control found`, pass: false, detail: 'no button labelled "Focus Variant"' });
          } else {
            (focusVariant as HTMLButtonElement).click();
            await nextFrame();
            await nextFrame();
          }
          const reRead = readTrack(host);
          if ("error" in reRead) {
            checks.push({ name: `${c.id}: renders after zooming`, pass: false, detail: reRead.error });
            continue;
          }
          const zoomedTrack = reRead.track;
          checks.push(...checkTrackGeometry(c.id, zoomedTrack));
          checks.push(...checkZoomWindow(c.id, zoomedTrack, [c.residue]));
          checks.push(...checkNonTextContrast(c.id, zoomedTrack));
          checks.push(...checkVariantCallout(c.id, zoomedTrack));
          checks.push(...(await checkNoFocusRings(c.id, zoomedTrack)));
          checks.push(...checkKeyboardFocusIndicator(c.id, zoomedTrack));
          checks.push(...(await checkInventory(host, c.id, want, CNNM2_FEATURES.features)));
          publish(checks);
          continue;
        }
        checks.push(...checkTrackGeometry(c.id, track));
        checks.push(
          ...checkResidueMapping(c.id, track, {
            // The coverage fixture has one region that is never plotted and two "other" sites.
            seqLength: isCoverage ? COVERAGE_FEATURES.sequenceLength : CNNM2_FEATURES.sequenceLength,
            domains: want.domain,
            sites: want.plottedSites,
          })
        );
        checks.push(...checkNonTextContrast(c.id, track));
        checks.push(...checkVariantCallout(c.id, track));
        checks.push(...(await checkNoFocusRings(c.id, track)));
        checks.push(...checkKeyboardFocusIndicator(c.id, track));
        checks.push(...(await checkInventory(host, c.id, want, (isCoverage ? COVERAGE_FEATURES : CNNM2_FEATURES).features)));
        publish(checks);
      }

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
      <div id="geometry-report">
        {report?.checks.map((c, i) => (
          <div key={i} style={{ font: "11px monospace", color: c.pass ? "#166534" : "#B91C1C", whiteSpace: "pre-wrap" }}>
            {c.pass ? "PASS" : "FAIL"} {c.name} — {c.detail}
          </div>
        ))}
      </div>
      {CASES.map((c) => {
        const features = c.kind === "coverage" ? COVERAGE_FEATURES : CNNM2_FEATURES;
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

createRoot(document.getElementById("root")!).render(<App />);

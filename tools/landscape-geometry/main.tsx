import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "./harness.css";
import { LandscapeInspector } from "../../src/components/inspector/LandscapeInspector";
import { LandscapeFocus } from "../../src/components/sequence/LandscapeFocus";
import { LandscapeOverview } from "../../src/components/sequence/LandscapeOverview";
import { useVariantAnalysisStore } from "../../src/stores/useVariantAnalysisStore";
import { landscapeKey } from "../../src/shared/landscapeEvidence";
import { SOD1_LANDSCAPE_ROWS, SOD1_LANDSCAPE_CONTEXT, SOD1_VARIANT_SCORES } from "../../src/shared/__tests__/fixtures/sod1Landscape";
import type { AlphaGenomeSaturationPosition, LandscapeResidueItem } from "../../src/shared/contracts";

/**
 * Geometry + behaviour assertions for the Landscape tab and its inspector rail.
 *
 * WHY A BROWSER: every promise made here is live-layout fact — letter chips that must not
 * overlap (they did: S/V drew on top of each other on SOD1 residue 5), the 'Reads as' lead box
 * that must precede the evidence, pill tabs and their hit targets, focus-grid cells at ≥24px,
 * contrast of chip text, one tab stop per grid. jsdom has none of it.
 *
 * Fixture: SOD1 P00441 p.Ala5Val, residues 1–31 (see
 * `src/shared/__tests__/fixtures/sod1Landscape.ts` for what is real and what stands in).
 *
 * The page reports PASS/FAIL as base64 JSON in #geometry-result, which check.mjs reads back
 * through the browser's --dump-dom; it exits non-zero on any failure.
 */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(() => setTimeout(() => r(), 0), 0));

function freezeMotion(): void {
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.appendChild(style);
}
freezeMotion();

/* Console errors from the React tree must be visible in the report, not only in the console. */
const ERR_LOG: string[] = [];
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  ERR_LOG.push(args.map((a) => String((a as any)?.message ?? a)).join(" ").slice(0, 300));
  origConsoleError(...args);
};

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
function computedVar(host: HTMLElement, name: string): [number, number, number] | null {
  const v = getComputedStyle(host).getPropertyValue(name).trim();
  if (!v) return null;
  const probe = document.createElement("span");
  probe.style.color = v;
  host.appendChild(probe);
  const c = parseColor(getComputedStyle(probe).color);
  probe.remove();
  return c;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlaps = (a: Rect, b: Rect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/* ── Fixture ──────────────────────────────────────────────────────────────────── */

const UNIPROT = "P00441";
const KEY = landscapeKey("SOD1", "p.Ala5Val", UNIPROT);
// SOD1 is on + strand; the queried C>T at 31659783 is codon position 2 of residue 5 (GCT → GTT).
const CODON5: AlphaGenomeSaturationPosition[] = [
  { pos: 31659782, ref: "G", isExonic: true, codonIndex: 5, codonPosition: 1, variants: { A: { phred: 14 }, C: { phred: 9 }, T: { phred: 6 } }, meanPhred: 9.7, maxPhred: 14 },
  { pos: 31659783, ref: "C", isExonic: true, codonIndex: 5, codonPosition: 2, variants: { A: { phred: 8 }, G: { phred: 11 }, T: { phred: 22 } }, meanPhred: 13.7, maxPhred: 22 },
  { pos: 31659784, ref: "T", isExonic: true, codonIndex: 5, codonPosition: 3, variants: { A: { phred: 2 }, C: { phred: 3 }, G: { phred: 1 } }, meanPhred: 2, maxPhred: 3 }
] as any;

const result = {
  metadata: { gene: "SOD1", variant: "p.Ala5Val", residueIndex: 5, wildType: "A", mutant: "V", uniprotId: UNIPROT },
  conservationData: { revel: SOD1_VARIANT_SCORES.revel },
  predictorData: { amPathogenicity: SOD1_VARIANT_SCORES.am },
  landscapeData: SOD1_LANDSCAPE_ROWS,
  landscapeMeta: {
    source: "myvariant",
    sourceVersion: "dbNSFP 4.8a",
    transcript: "ENST00000270142",
    transcriptBasis: "ensembl-canonical",
    window: { start: 1, end: 30 },
    referenceSequence: UNIPROT,
    qualityFlags: [],
    cached: true,
    retrievedAt: "2026-10-04T13:51:07Z"
  },
  uniprotFeatures: {
    geneName: "SOD1",
    sequenceLength: 154,
    domainMatchesStatus: "error",
    features: [{ type: "Domain", description: "Cu/Zn superoxide dismutase", start: 1, end: 153 }]
  },
} as any;

function setStoreState(): void {
  useVariantAnalysisStore.setState({
    gene: "SOD1",
    variant: "p.Ala5Val",
    uniprotId: UNIPROT,
    selectedResidueIndex: 5,
    hoveredResidueIndex: null,
    selectedGenomicVariant: null,
    landscapeSelection: { key: KEY, kind: "substitution", pos: 5, alt: "V" },
    landscapeOverview: { key: KEY, status: "ready", error: null, data: { positions: [], meta: {} as any, context: SOD1_LANDSCAPE_CONTEXT } as any }
  });
}

function mountRail(host: HTMLElement): void {
  setStoreState();
  const root = React.createElement("div", { style: { width: 360, padding: 16, borderLeft: "1px solid var(--cs-border)", background: "var(--cs-surface-2)" } }, React.createElement(LandscapeInspector, { analysisResult: result, onSelectResidueIndex: () => {} }));
  createRoot(host).render(root);
}

function mountTab(host: HTMLElement): void {
  setStoreState();
  const rows = new Map<number, LandscapeResidueItem>(SOD1_LANDSCAPE_ROWS.map((r) => [r.residx, r]));
  const codons = new Map<number, any>([[5, CODON5.map((p) => ({ position: p, codingRef: p.ref }))]]);
  const focus = React.createElement(LandscapeFocus, {
    residues: "MATKAVCVLKGDGPVQGIINFEQKESNGPVK".split(""),
    start: 1,
    target: { pos: 5, wt: "A", mut: "V" },
    width: 31,
    rows,
    mode: "mean",
    colorBy: "alphaMissense",
    variantScores: { revel: SOD1_VARIANT_SCORES.revel, am: SOD1_VARIANT_SCORES.am, gerp: 3.21, phylop: 6.73 },
    domains: [{ name: "Cu/Zn superoxide dismutase", start: 1, end: 153 }],
    selected: { key: KEY, kind: "substitution", pos: 5, alt: "V" },
    hoveredPos: null,
    loadingWindow: false,
    codons,
    onPickResidue: () => {},
    onPickSubstitution: () => {},
    onHover: () => {}
  } as any);
  const overview = React.createElement(LandscapeOverview, {
    length: 154,
    status: "ready",
    error: null,
    positions: [],
    context: SOD1_LANDSCAPE_CONTEXT,
    domains: [{ name: "Cu/Zn superoxide dismutase", start: 1, end: 153 }],
    window: { start: 1, end: 31 },
    targetPos: 5,
    mode: "mean",
    lanes: { clinvar: true, gnomad: true, regions: true },
    onMove: () => {},
    onPick: () => {},
    pageStep: 31
  } as any);
  const root = React.createElement(
    "div",
    { style: { width: 1010, padding: 24, background: "var(--cs-bg)" } },
    overview,
    React.createElement("div", { style: { height: 12 } }),
    focus
  );
  createRoot(host).render(root);
}

/* ── Cases ────────────────────────────────────────────────────────────────────── */

interface Case {
  id: string;
  label: string;
  width: number;
  dark?: boolean;
  kind: "rail" | "tab";
  /** Hand-declared: the run fails short of it, so a case that never rendered cannot pass vacuously. */
  expectAssertions: number;
}

const CASES: Case[] = [
  { id: "rail-wide", label: "SOD1 p.Ala5Val rail — 360px, tabs walked", width: 360, kind: "rail", expectAssertions: 13 },
  { id: "rail-dark", label: "SOD1 p.Ala5Val rail — dark", width: 360, dark: true, kind: "rail", expectAssertions: 13 },
  { id: "tab", label: "SOD1 p.Ala5Val focus grid — 1010px", width: 1010, kind: "tab", expectAssertions: 7 }
];

/* ── Rail families, walked tab by tab ─────────────────────────────────────────── */

async function railChecks(host: HTMLElement): Promise<Check[]> {
  const out: Check[] = [];
  // Let the initial render flush before measuring anything.
  await nextFrame();
  await nextFrame();
  const tabs = host.querySelectorAll('[role="tab"]');
  out.push({ name: "inspector: workspace navigation is outside the rail", pass: tabs.length === 0, detail: `${tabs.length} rail tabs` });
  const summary = host.querySelector('[aria-label="Selected residue summary"]');
  const substitutions = host.querySelector('[aria-label="Substitution scores"]');
  out.push({ name: "inspector: selection and substitutions remain visible together", pass: Boolean(summary && substitutions), detail: "both sections present" });
  const sources = host.querySelector<HTMLDetailsElement>('.lsr-sources');
  out.push({ name: "inspector: sources use a closed disclosure", pass: Boolean(sources && !sources.open), detail: "sources available without replacing selection" });

  /* Summary tab: the lead box, then the verdict */
  const readsAs = host.querySelector(".lsr-readsas");
  const verdict = host.querySelector(".lsr-verdict");
  out.push({ name: "summary: the 'Reads as' lead box precedes the per-tool verdict", pass: Boolean(readsAs && verdict && readsAs.compareDocumentPosition(verdict as Node) & Node.DOCUMENT_POSITION_FOLLOWING), detail: readsAs && verdict ? "ordered" : "missing box or verdict" });
  const verdictText = verdict?.textContent ?? "";
  out.push({ name: "summary: the verdict carries both tools' score and band", pass: verdictText.includes("REVEL 0.853") && verdictText.includes("PP3 Moderate") && verdictText.includes("AlphaMissense 0.840") && verdictText.includes("The queried variant"), detail: verdictText.slice(0, 90) });
  const kv = host.querySelector(".lsr-kv");
  const kvText = kv?.textContent ?? "";
  out.push({ name: "summary: context reads as key/value rows, query marked apart", pass: Boolean(kv && kvText.includes("p.Ala5Ser Pathogenic") && kvText.includes("(queried)")), detail: kvText.slice(0, 90) });

  /* Substitutions tab: the strips and their chips */
  await nextFrame();
  await nextFrame();
  const chips = Array.from(host.querySelectorAll<HTMLElement>(".lsr-strip__chip"));
  const rects = chips.map((c) => c.getBoundingClientRect());
  const labels = chips.map((c) => `${c.textContent}${c.dataset.query ? "*" : ""}${c.dataset.on ? "+" : ""}`).join("");
  const bad: string[] = [];
  for (let i = 0; i < chips.length; i++) {
    for (let j = i + 1; j < chips.length; j++) {
      if (overlaps(rects[i], rects[j])) bad.push(`${chips[i].textContent}/${chips[j].textContent}`);
    }
  }
  out.push({ name: "chips: substitution letters do not overlap", pass: bad.length === 0, detail: bad.length ? `overlapping: ${bad.join(", ")}` : `${chips.length} chips clear (${labels}; *=queried, +=selected)` });
  const strips = Array.from(host.querySelectorAll<HTMLElement>(".lsr-strip"));
  const clipped = chips.filter((c, i) => {
    const strip = strips.find((s) => s.contains(c));
    if (!strip) return true;
    const s = strip.getBoundingClientRect();
    const r = rects[i];
    return r.left < s.left - 0.5 || r.right > s.right + 0.5;
  });
  out.push({ name: "chips: every letter sits inside its strip", pass: clipped.length === 0, detail: clipped.length ? `${clipped.length} clipped` : "all inside" });
  const smallChips = chips.filter((c) => rects[chips.indexOf(c)].width < 23.5 || rects[chips.indexOf(c)].height < 23.5);
  out.push({ name: "targets: letter chips are at least 24×24px", pass: smallChips.length === 0 && chips.length > 0, detail: smallChips.length ? `${smallChips.length} under 24px` : `${chips.length} chips ≥ 24px` });
  let worst = Infinity;
  for (const c of chips) {
    const fg = parseColor(getComputedStyle(c).color);
    const bg = parseColor(getComputedStyle(c).backgroundColor);
    if (fg && bg) worst = Math.min(worst, contrast(fg, bg));
  }
  out.push({ name: "contrast: chip letters ≥ 4.5:1 on their chip", pass: Number.isFinite(worst) && worst >= 4.5, detail: `worst ${worst.toFixed(2)}:1` });

  const queryButton = host.querySelector<HTMLElement>('.lsr-return');
  const queryRect = queryButton?.getBoundingClientRect();
  out.push({ name: "inspector: return-to-query target is at least 24px", pass: Boolean(queryRect && queryRect.height >= 24 && queryRect.width >= 24), detail: `${queryRect?.width} ? ${queryRect?.height}` });
  queryButton?.focus();
  out.push({ name: "inspector: query action supports keyboard focus", pass: Boolean(queryButton && document.activeElement === queryButton), detail: "query action focused" });

  /* The rail never scrolls sideways */
  const railRoot = host.querySelector<HTMLElement>(".lsr-root");
  const overflow = railRoot ? railRoot.scrollWidth - railRoot.clientWidth : 0;
  out.push({ name: "rail: no horizontal overflow at 360px", pass: overflow <= 1, detail: `scroll - client = ${overflow}px` });
  return out;
}

/* ── Tab (focus grid) families ────────────────────────────────────────────────── */

function tabChecks(host: HTMLElement): Check[] {
  const out: Check[] = [];
  // One tab stop per grid: each roving grid has exactly one tabIndex=0 cell.
  const grids = Array.from(host.querySelectorAll<HTMLElement>("[role='group']"));
  const offenders = grids.map((g) => ({ g, stops: g.querySelectorAll<HTMLElement>("[data-rc][tabindex='0']").length })).filter((x) => x.stops !== 1);
  out.push({ name: "keyboard: one tab stop per roving grid", pass: grids.length > 0 && offenders.length === 0, detail: `${grids.length} grids, ${offenders.length} with ≠1 stop` });

  const heat = Array.from(host.querySelectorAll<HTMLElement>("[role='group']")).find((g) => (g.getAttribute("aria-label") ?? "").includes("Substitution heatmap"));
  const entry = heat?.querySelector<HTMLElement>("[data-rc][tabindex='0']");
  out.push({ name: "keyboard: Tab lands on the queried heatmap cell", pass: Boolean(entry && entry.hasAttribute("data-entry") && (entry.getAttribute("aria-label") ?? "").startsWith("A5V")), detail: entry?.getAttribute("aria-label")?.slice(0, 60) ?? "no entry" });

  const cons = Array.from(host.querySelectorAll<HTMLElement>("[role='group']")).find((g) => (g.getAttribute("aria-label") ?? "").includes("phyloP"));
  const consCells = cons ? cons.querySelectorAll<HTMLElement>("button[data-rc]") : [];
  const consFocused = cons ? cons.querySelectorAll<HTMLElement>("[data-rc][tabindex='0']").length : 0;
  out.push({ name: "keyboard: the phyloP track is reachable (one stop over its cells)", pass: consCells.length > 0 && consFocused === 1, detail: `${consCells.length} cells, ${consFocused} stops` });

  // Route A: every interactive cell is ≥ 24px tall for ALL pointers (no pointer:coarse fallback).
  const cells = Array.from(host.querySelectorAll<HTMLElement>(".ls-sub, .ls-cell"));
  const shortCells = cells.filter((c) => c.getBoundingClientRect().height < 23.5);
  out.push({ name: "targets: every focus-grid cell is ≥ 24px tall (route A, all pointers)", pass: cells.length > 0 && shortCells.length === 0, detail: shortCells.length ? `${shortCells.length} of ${cells.length} under 24px` : `${cells.length} cells ≥ 24px` });

  const panel = host.querySelector<HTMLElement>(".ls-panel");
  const h = panel ? panel.getBoundingClientRect().height : Infinity;
  out.push({ name: "layout: the focus grid stays within ~800px so the window keeps its overview", pass: h <= 800, detail: `${Number.isFinite(h) ? h.toFixed(0) : "∞"}px` });

  // The ClinVar P/LP assertion token: a real colour, distinct from the PP3 band red, readable on the card.
  const plp = computedVar(host, "--ls-clinvar-plp");
  const pp3 = computedVar(host, "--ls-pp3-strong");
  const bg = parseColor(getComputedStyle(host.querySelector(".ls-panel") ?? host).backgroundColor);
  const surface = parseColor(getComputedStyle(document.body).backgroundColor);
  const base = bg ?? surface;
  const plpContrast = plp && base ? contrast(plp, base) : 0;
  const dist = plp && pp3 ? Math.hypot(plp[0] - pp3[0], plp[1] - pp3[1], plp[2] - pp3[2]) : 0;
  out.push({ name: "clinvar: the P/LP token is ≥ 3:1 on the card and well clear of the PP3 red", pass: plpContrast >= 3 && dist >= 60, detail: `contrast ${plpContrast.toFixed(2)}:1, RGB distance to PP3 red ${dist.toFixed(0)}` });
  return out;
}

/* ── Run ──────────────────────────────────────────────────────────────────────── */

async function run(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  for (const c of CASES) {
    const host = document.createElement("div");
    host.id = `case-${c.id}`;
    document.body.appendChild(host);
    if (c.dark) document.documentElement.classList.add("dark");
    try {
      if (c.kind === "rail") mountRail(host);
      else mountTab(host);
      // Two frames: the initial mount flushes, then ResizeObserver/settle effects run.
      await nextFrame();
      await nextFrame();
      const produced = c.kind === "rail" ? await railChecks(host) : tabChecks(host);
      for (const check of produced) checks.push({ name: `${c.id}: ${check.name}`, pass: check.pass, detail: check.detail });
      if (produced.length !== c.expectAssertions) {
        checks.push({ name: `${c.id}: harness produced ${produced.length} assertions, expected ${c.expectAssertions}`, pass: false, detail: "update expectAssertions if deliberate" });
      }
    } catch (err: any) {
      checks.push({ name: `${c.id}: case threw`, pass: false, detail: String(err?.stack ?? err).slice(0, 400) });
    }
    if (c.dark) document.documentElement.classList.remove("dark");
  }
  checks.push({ name: "harness: cases rendered", pass: CASES.every((c) => document.getElementById(`case-${c.id}`) !== null), detail: `${CASES.length} cases` });
  checks.push({ name: "harness: no console errors", pass: ERR_LOG.length === 0, detail: ERR_LOG.slice(0, 3).join(" | ") || "clean" });
  return { ok: checks.every((c) => c.pass), checks };
}

run().then((report) => {
  const el = document.getElementById("geometry-result")!;
  el.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
  const pre = document.createElement("pre");
  pre.id = "geometry-report";
  pre.textContent = report.checks.map((c) => `${c.pass ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`).join("\n");
  document.body.appendChild(pre);
});

/* A crash inside a case must not look like an empty-but-passing run. */
window.addEventListener("error", (e) => {
  const el = document.getElementById("geometry-result")!;
  const report = { ok: false, checks: [{ name: "page error", pass: false, detail: String(e.error?.stack ?? e.message).slice(0, 500) }] };
  el.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
});

import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "@fontsource-variable/lora";
import "@fontsource-variable/lora/wght-italic.css";
import "./preview.css";
import { ClinicalTab } from "../../src/components/evidence/ClinicalTab";
import { PopulationRail } from "../../src/components/inspector/PopulationRail";
import VariantHeader from "../../src/components/VariantHeader";
import { VariantIdentity } from "../../src/components/header/VariantIdentity";
import { buildVariantHeaderModel } from "../../src/components/header/variantHeaderModel";
import type { AnalysisResult } from "../../src/types";
import { LOCUS_POLICY_VERSION } from "../../src/shared/locusResolution";

/**
 * Geometry assertions for the global variant header.
 *
 * jsdom cannot answer any of these: it has no layout engine, no container-query
 * evaluation and no font metrics. That is exactly why the header's layout rules —
 * cross-row column alignment, the threshold numerals vs the value marker, the
 * fixed-width columns that must not clip — were previously only checked by eye.
 *
 * The page renders the header at several widths, measures the live boxes and
 * reports PASS/FAIL as base64 JSON in #geometry-result, which check.mjs reads back
 * through the browser's --dump-dom. It exits non-zero on any failure.
 */

interface GeometryCheck {
  name: string;
  pass: boolean;
  detail: string;
}

interface GeometryReport {
  ok: boolean;
  checks: GeometryCheck[];
  heights: Record<string, number>;
}

/** MACO1 p.Glu433Lys — the case whose rails and footnote exercise every branch. */
const maco1 = {
  transcriptId: "NM_018202.6",
  isManeSelect: true,
  predictorData: {
    gnomadVariantId: "1-25484258-G-A",
    gnomadVariantAssembly: "GRCh38",
  },
  gnomadConstraint: {
    provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "synthetic-geometry-fixture" },
    regionalRelease: "4.1.1",
    missense_z: 3.13,
    oe_mis: 0.26,
    pli: 0.98,
    loeuf: 0.26,
    isPP2Constrained: true,
    hasRegionalData: true,
    regionalConstraint: {
      isConstrained: true,
      oeRatio: 0.68,
      pValue: 6.648150909581207e-6,
      regionText: "Gln199 to Met555",
    },
  },
} as unknown as AnalysisResult;

/** BRAF p.Val600Glu — four identifier chips (forces a wrap in the identity column). */
const braf = {
  transcriptId: "ENST00000288602.11",
  isManeSelect: true,
  predictorData: { gnomadVariantId: "7-140753336-A-T", gnomadVariantAssembly: "GRCh38" },
  gnomadConstraint: {
    provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "synthetic-geometry-fixture" },
    regionalRelease: "4.1.1",
    missense_z: 2.04,
    oe_mis: 0.72,
    pli: 0.99,
    loeuf: 0.71,
    isPP2Constrained: true,
    hasRegionalData: true,
    regionalConstraint: { isConstrained: true, oeRatio: 0.85, pValue: 0.002, regionText: "460 to 600" },
  },
  conservationData: { spliceProximity: { isNearSpliceSite: true, distance: 4 } },
} as unknown as AnalysisResult;

const CASES: Array<{ id: string; width: number; gene: string; variant: string; uniprot: string; result: AnalysisResult }> = [
  { id: "maco1-wide", width: 1000, gene: "MACO1", variant: "p.Glu433Lys", uniprot: "Q9NSG2", result: maco1 },
  { id: "braf-wide", width: 1000, gene: "BRAF", variant: "p.Val600Glu", uniprot: "P15056", result: braf },
  { id: "maco1-mid", width: 860, gene: "MACO1", variant: "p.Glu433Lys", uniprot: "Q9NSG2", result: maco1 },
  { id: "maco1-stacked", width: 560, gene: "MACO1", variant: "p.Glu433Lys", uniprot: "Q9NSG2", result: maco1 },
  { id: "braf-stacked", width: 560, gene: "BRAF", variant: "p.Val600Glu", uniprot: "P15056", result: braf },
  { id: "maco1-narrow", width: 375, gene: "MACO1", variant: "p.Glu433Lys", uniprot: "Q9NSG2", result: maco1 },
];

/** The one-line form the header collapses to on scroll. */
/** MACO1 again, with the GRCh38 lookup fallen back to hg19: the run-state slot must fit too. */
const maco1Fallback = {
  ...maco1,
  coordinateLift: { status: "not-needed", fromAssembly: "GRCh38", toAssembly: "GRCh38" },
  predictorData: {
    gnomadVariantId: "1-25810749-G-A",
    gnomadVariantAssembly: "GRCh37",
    locusResolution: { route: "fallback", canonicalBy: null, retryable: true, steps: [] },
  },
} as unknown as AnalysisResult;

/** SLC12A4 Q867H: an input requirement, not a provider outage or an inferred allele. */
const ambiguousAllele = {
  ...maco1,
  metadata: { gene: "SLC12A4", variant: "Q867H", populationPolicyVersion: LOCUS_POLICY_VERSION },
  transcriptId: "NM_005072.5",
  serviceStatus: { gnomadFrequency: "unsupported-build" },
  gnomadFrequency: null, aouFrequency: null, aouLookup: null,
  ruleBasedInsights: { acmgCriteria: [] },
  // Synthetic layout values, not a live constraint reading for the reference variant.
  gnomadConstraint: {
    provenance: { release: "4.1.2", assembly: "GRCh38", geneId: "ENSG00000000001", transcriptId: "ENST00000000001", transcriptVersion: "1", selection: "matched", sourceUrl: "https://gnomad.broadinstitute.org/downloads", sourceSha256: "synthetic-geometry-fixture" },
    regionalRelease: "4.1.1", missense_z: 1.35, loeuf: 0.68, isPP2Constrained: false, hasRegionalData: false },
  predictorData: {
    gnomadVariantId: null,
    gnomadVariantAssembly: null,
    locusResolution: { route: "fallback", canonicalBy: null, retryable: false, failureKind: "ambiguous-allele", policyVersion: LOCUS_POLICY_VERSION, steps: [] },
  },
} as unknown as AnalysisResult;
const RECOVERY_CASES = [
  { id: "allele-large", width: 1440 },
  { id: "allele-desktop", width: 1200 },
  { id: "allele-wide", width: 1000 },
  { id: "allele-mid", width: 820 },
  { id: "allele-narrow", width: 375 },
];
const POPULATION_CASES = [
  { id: "population-wide", width: 820, dark: false },
  { id: "population-narrow", width: 375, dark: false },
  { id: "population-dark", width: 375, dark: true },
];

/** The top-bar identity at the widths its zone takes as the bar narrows. */
const IDENTITY_CASES: Array<{ id: string; width: number; expect: string[] }> = [
  { id: "identity-900", width: 900, expect: ["transcript", "coordinate", "uniprot"] },
  { id: "identity-700", width: 700, expect: ["transcript", "coordinate"] },
  { id: "identity-500", width: 500, expect: ["transcript"] },
  { id: "identity-380", width: 380, expect: [] },
];

const px = (n: number): number => Math.round(n * 10) / 10;
const rect = (el: Element): DOMRect => el.getBoundingClientRect();

/** Left/right edges of the four aligned line-1 columns, per metric row. */
function columnEdges(header: Element): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  header.querySelectorAll("li.vh-metric").forEach((row) => {
    (["vh-metric-label", "vh-metric-value", "vh-scale", "vh-verdict"] as const).forEach((cls) => {
      const cell = row.querySelector(`.${cls}`);
      if (!cell) return;
      const r = rect(cell);
      (out[cls] ??= []).push([px(r.left), px(r.right)]);
    });
  });
  return out;
}

function checkCase(host: HTMLElement, id: string, width: number): GeometryCheck[] {
  const checks: GeometryCheck[] = [];
  const header = host.querySelector(".variant-header");
  if (!header) {
    return [{ name: `${id}: renders`, pass: false, detail: "no .variant-header in the host" }];
  }

  // 1. Every metric row shares the same line-1 column edges. Each row is its own grid,
  //    so any content-sized column silently desynchronises the rails down the group.
  //    The verdict chip is content-sized and start-aligned, so only its left edge is
  //    expected to match; the other three columns stretch to their track.
  const edges = columnEdges(header);
  for (const [cls, rows] of Object.entries(edges)) {
    if (rows.length < 2) continue;
    const spread = Math.max(...rows.map((r) => r[0])) - Math.min(...rows.map((r) => r[0]));
    const endSpread = Math.max(...rows.map((r) => r[1])) - Math.min(...rows.map((r) => r[1]));
    const edgeOnly = cls === "vh-verdict";
    checks.push({
      name: `${id}: ${cls} column aligned across ${rows.length} rows`,
      pass: spread <= 1 && (edgeOnly || endSpread <= 1),
      detail: `left spread ${px(spread)}px, right spread ${px(endSpread)}px`,
    });
  }

  // 2. Nothing inside the header is wider than its box: a fixed column plus nowrap
  //    would otherwise clip or overlap its neighbour.
  //    `.vh-icon-btn::after` is a 4px hit-area halo, which is scrollable overflow by
  //    definition and is not a layout defect, so it is excluded (and tracked as a known
  //    LOW: the halo overlaps the neighbouring chip by 2px).
  const spills: string[] = [];
  header.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (el.classList.contains("vh-sr-only") || el.classList.contains("vh-icon-btn")) return;
    // A row that scrolls sideways by design (the strip's chips at narrow widths) is not a spill.
    if (getComputedStyle(el).overflowX === "auto") return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow > 1) {
      const hitAreaOnly = overflow <= 4 && el.querySelector(".vh-icon-btn") !== null;
      if (!hitAreaOnly) spills.push(`${el.className || el.tagName}[${px(el.clientWidth)}<${px(el.scrollWidth)}]`);
    }
  });
  checks.push({ name: `${id}: no content spills its box`, pass: spills.length === 0, detail: spills.join(" ") || "none" });

  // 3. The value marker must not paint over the threshold numeral that names it.
  const collisions: string[] = [];
  header.querySelectorAll("li.vh-metric").forEach((row) => {
    const marker = row.querySelector(".vh-marker");
    if (!marker) return;
    const m = rect(marker);
    row.querySelectorAll(".vh-axis-label").forEach((label) => {
      const l = rect(label);
      const overlapX = Math.min(m.right, l.right) - Math.max(m.left, l.left);
      const overlapY = Math.min(m.bottom, l.bottom) - Math.max(m.top, l.top);
      if (overlapX > 0 && overlapY > 0) {
        collisions.push(`marker vs "${label.textContent}" ${px(overlapX)}x${px(overlapY)}px`);
      }
    });
  });
  checks.push({
    name: `${id}: marker clears the threshold numerals`,
    pass: collisions.length === 0,
    detail: collisions.join(" | ") || "none",
  });

  // 4. An ellipsised label hides the metric name; an ellipsised verdict hides the call.
  const clipped: string[] = [];
  header.querySelectorAll<HTMLElement>(".vh-metric-label, .vh-verdict").forEach((el) => {
    if (el.scrollWidth - el.clientWidth > 1) clipped.push(`${el.className} "${el.textContent ?? ""}"`);
  });
  checks.push({ name: `${id}: labels and verdicts are not truncated`, pass: clipped.length === 0, detail: clipped.join(" | ") || "none" });

  return checks;
}

/** The scope caption is the rail's first child, and its axis legend spans exactly the track
   column of the rows below it — the legend names that column's direction, so it must sit over it. */
function checkRailCaption(host: HTMLElement, id: string): GeometryCheck[] {
  const rail = host.querySelector(".vh-rail");
  const head = host.querySelector(".vh-rail-head");
  const list = host.querySelector(".vh-metrics");
  if (!rail || !head || !list) {
    return [{ name: `${id}: rail opens with its scope caption`, pass: false, detail: "missing rail/caption/list" }];
  }
  const checks: GeometryCheck[] = [{
    name: `${id}: rail opens with its scope caption`,
    pass: rail.firstElementChild === head && head.nextElementSibling === list,
    detail: "caption, then list",
  }];
  const axis = host.querySelector(".vh-rail-axis");
  const scale = host.querySelector("li.vh-metric .vh-scale");
  if (axis && scale && getComputedStyle(axis).display !== "none") {
    const a = rect(axis);
    const t = rect(scale);
    const off = Math.max(Math.abs(a.left - t.left), Math.abs(a.right - t.right));
    checks.push({
      name: `${id}: axis legend spans the track column`,
      pass: off <= 1,
      detail: `max edge offset ${px(off)}px`,
    });
  }
  return checks;
}

/** The strip is one line by construction: 44px, whatever the width. */
function checkStripOneLine(host: HTMLElement, id: string): GeometryCheck {
  const strip = host.querySelector(".variant-header");
  if (!strip) return { name: `${id}: strip is one line`, pass: false, detail: "no strip" };
  const h = rect(strip).height;
  return { name: `${id}: strip is one line`, pass: h <= 48, detail: `strip ${px(h)}px tall` };
}

/** Measure the composed toolbar and constraint strip, including their shared
 * edges and the masthead height used by fill-height workspaces. */
function checkShellFrame(): GeometryCheck[] {
  const shell = document.querySelector<HTMLElement>(".app-shell");
  if (!shell) return [{ name: "shell: composed host renders", pass: false, detail: "no .app-shell in the page" }];
  const header = shell.querySelector<HTMLElement>("#shell-joined-header");
  const strip = shell.querySelector<HTMLElement>(".variant-header");
  const standalone = document.querySelector<HTMLElement>("#shell-standalone-header");
  if (!header || !strip || !standalone) {
    return [{ name: "shell: header, strip and standalone header render", pass: false, detail: "missing chrome" }];
  }

  const checks: GeometryCheck[] = [];
  const hb = header.getBoundingClientRect();
  const sb = strip.getBoundingClientRect();
  const hStyle = getComputedStyle(header);
  const sStyle = getComputedStyle(strip);

  // Identity and context align without an enclosing card or a doubled seam.
  checks.push({
    name: "shell: header and context align on the shell canvas",
    pass: Math.abs(hb.bottom - sb.top) <= 1 &&
      Math.abs(hb.left - sb.left) <= 1 && Math.abs(hb.right - sb.right) <= 1 &&
      sStyle.borderBlockStartWidth === "0px" &&
      hStyle.borderBlockEndWidth === "0px" &&
      hStyle.backgroundColor === "rgba(0, 0, 0, 0)" && sStyle.backgroundColor === "rgba(0, 0, 0, 0)",
    detail: `dy=${(sb.top - hb.bottom).toFixed(2)} dxL=${(sb.left - hb.left).toFixed(2)} seam=${sStyle.borderBlockStartWidth}`,
  });

  // Search keeps the same unframed toolbar and reserves its workspace gutter.
  const st = getComputedStyle(standalone);
  const radii = [st.borderStartStartRadius, st.borderStartEndRadius, st.borderEndStartRadius, st.borderEndEndRadius];
  checks.push({
    name: "shell: standalone toolbar stays unframed and keeps its gutter",
    pass: radii.every(v => v === "0px") && st.borderWidth === "0px" && parseFloat(st.marginBlockEnd) > 0,
    detail: `radii=${radii.join("/")} margin=${st.marginBlockEnd}`,
  });

  // --cs-masthead must equal the real chrome above the workspace, or the fixed-height
  // fill panes (Search empty state, About) drift as the card chrome evolves.
  const shellRect = shell.getBoundingClientRect();
  const actual = sb.bottom - shellRect.top + parseFloat(sStyle.marginBlockEnd);
  const probe = document.createElement("div");
  probe.style.height = "var(--cs-masthead)";
  shell.appendChild(probe);
  const expected = probe.getBoundingClientRect().height;
  probe.remove();
  checks.push({
    name: "shell: --cs-masthead matches the real chrome stack",
    pass: expected > 0 && Math.abs(actual - expected) <= 1,
    detail: `${actual.toFixed(1)} measured vs ${expected.toFixed(0)} (margin=${sStyle.marginBlockEnd}, stripBottom=${sb.bottom.toFixed(1)}, shellTop=${shellRect.top.toFixed(1)})`,
  });

  return checks;
}

/** The identity drops identifiers in a fixed order as its zone narrows, and never wraps. */
function checkIdentity(host: HTMLElement, id: string, expected: string[]): GeometryCheck[] {
  const vid = host.querySelector(".vid");
  if (!vid) return [{ name: `${id}: identity renders`, pass: false, detail: "no .vid" }];
  const visible = ["transcript", "coordinate", "uniprot"].filter((k) => {
    const el = vid.querySelector(`.vid-chip--${k}`);
    return el !== null && getComputedStyle(el).display !== "none";
  });
  const title = vid.querySelector(".vid-title");
  const oneLine = rect(vid).height <= (title ? rect(title).height + 4 : 30);
  return [
    {
      name: `${id}: shows ${expected.join(", ") || "the title only"}`,
      pass: visible.join(",") === expected.join(","),
      detail: `visible: ${visible.join(", ") || "none"}`,
    },
    { name: `${id}: identity is one line`, pass: oneLine, detail: `${px(rect(vid).height)}px tall` },
    {
      name: `${id}: identity does not overflow its zone`,
      pass: (vid as HTMLElement).scrollWidth - (vid as HTMLElement).clientWidth <= 1 || visible.length === 0,
      detail: `${(vid as HTMLElement).scrollWidth} vs ${(vid as HTMLElement).clientWidth}`,
    },
  ];
}

// ── Contrast ──
// jsdom applies no CSS, so a "dark mode render" there asserts nothing. Here the
// computed colours are real and can be composited, which is the only way to keep the
// dark-mode AA fixes (muted micro-text) honest.

type Rgb = [number, number, number, number];

function parseColor(value: string): Rgb | null {
  const rgb = value.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseFloat(p.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  return null;
}

function compositeOver(top: Rgb, bottom: Rgb): Rgb {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = luminance(a) > luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour an element's text actually sits on, compositing translucent ancestors. */
function effectiveBackground(el: Element, pageBackground: Rgb): Rgb {
  const layers: Rgb[] = [];
  let node: Element | null = el;
  while (node) {
    const parsed = parseColor(getComputedStyle(node).backgroundColor);
    if (parsed && parsed[3] > 0) {
      layers.push(parsed);
      if (parsed[3] >= 1) break;
    }
    node = node.parentElement;
  }
  return layers.reverse().reduce((acc, layer) => compositeOver(layer, acc), pageBackground);
}

/** Micro-text that carries meaning must clear AA in both themes. */
function checkContrast(host: HTMLElement, id: string, pageBackgroundHex: string): GeometryCheck[] {
  const page = parseColor(pageBackgroundHex);
  if (!page) return [];
  const selectors = [
    ".vh-metric-label", ".vh-axis-label", ".vh-metric-value", ".vh-verdict",
    ".vh-rail-source", ".vh-rail-axis",
    ".vcs-chip-label", ".vcs-chip-value", ".vcs-chip-verdict", ".vcs-source", ".vcs-details",
  ];
  const checks: GeometryCheck[] = [];
  selectors.forEach((selector) => {
    const el = host.querySelector(selector);
    if (!el) return;
    const fg = parseColor(getComputedStyle(el).color);
    if (!fg) return;
    const ratio = contrastRatio(fg, effectiveBackground(el, page));
    checks.push({
      name: `${id}: ${selector} clears AA`,
      pass: ratio >= 4.5,
      detail: `${ratio.toFixed(2)}:1 (needs 4.5:1)`,
    });
  });
  return checks;
}

function App(): React.ReactElement {
  const [report, setReport] = React.useState<GeometryReport | null>(null);

  React.useEffect(() => {
    // Open every Details panel: the full tracks are what the row/marker/numeral checks measure.
    document.querySelectorAll<HTMLButtonElement>(".vcs-details").forEach((b) => b.click());
    const timer = window.setTimeout(() => {
      const checks: GeometryCheck[] = [];
      const heights: Record<string, number> = {};

      CASES.forEach((c) => {
        const host = document.getElementById(`host-${c.id}`);
        if (!host) return;
        checks.push(...checkCase(host, c.id, c.width));
        checks.push(...checkRailCaption(host, c.id));
        checks.push(checkStripOneLine(host, c.id));
        const strip = host.querySelector(".variant-header");
        if (strip) heights[c.id] = px(rect(strip).height);
      });

      const fallbackHost = document.getElementById("host-fallback");
      if (fallbackHost) {
        checks.push(checkStripOneLine(fallbackHost, "fallback-1000"));
        const state = fallbackHost.querySelector(".vcs-runstate");
        checks.push({
          name: "fallback-1000: run state is shown and fits",
          pass: Boolean(state) && (state as HTMLElement).scrollWidth - (state as HTMLElement).clientWidth <= 1,
          detail: state ? `${(state as HTMLElement).scrollWidth} vs ${(state as HTMLElement).clientWidth}` : "missing",
        });
      }

      RECOVERY_CASES.forEach(c => {
        const host = document.getElementById(`host-${c.id}`);
        if (!host) return;
        const state = host.querySelector<HTMLElement>(".vcs-runstate");
        const action = state?.querySelector<HTMLButtonElement>("button");
        checks.push({
          name: `${c.id}: original-allele action is legible without a false retry`,
          pass: Boolean(action) && action!.textContent?.includes("Provide nucleotide allele") === true &&
            !state?.textContent?.includes("Re-run") && action!.scrollWidth <= action!.clientWidth + 1,
          detail: action ? `${action.textContent}: ${action.scrollWidth} vs ${action.clientWidth}` : "missing action",
        });
        checks.push({
          name: `${c.id}: recovery chrome has no horizontal spill`,
          pass: Boolean(state) && state!.scrollWidth <= state!.clientWidth + 1,
          detail: state ? `${state.scrollWidth} vs ${state.clientWidth}` : "missing state",
        });
        if (c.width >= 820) {
          const chips = host.querySelector<HTMLElement>(".vcs-chips");
          const details = host.querySelector<HTMLElement>(".vcs-details");
          const right = chips ? chips.getBoundingClientRect().left + chips.scrollWidth : Infinity;
          const left = details?.getBoundingClientRect().left ?? -Infinity;
          checks.push({
            name: `${c.id}: constraint readings do not overprint Details or recovery`,
            pass: Boolean(chips && details) && right <= left + 1,
            detail: `${right.toFixed(1)} vs ${left.toFixed(1)}`,
          });
        }
      });

      POPULATION_CASES.forEach(c => {
        const host = document.getElementById(`host-${c.id}`);
        const action = host?.querySelector<HTMLButtonElement>(".pop-callout__action");
        const box = host?.getBoundingClientRect();
        const buttonBox = action?.getBoundingClientRect();
        checks.push({
          name: `${c.id}: population card and lineage have no horizontal spill`,
          pass: Boolean(host) && host!.scrollWidth <= host!.clientWidth + 1,
          detail: host ? `${host.scrollWidth} vs ${host.clientWidth}` : "missing host",
        });
        checks.push({
          name: `${c.id}: allele-entry action is inside the card and legible`,
          pass: Boolean(action && box && buttonBox) && action!.scrollWidth <= action!.clientWidth + 1 &&
            buttonBox!.left >= box!.left && buttonBox!.right <= box!.right + 1 &&
            (c.width > 560 || buttonBox!.height >= 44),
          detail: buttonBox ? `${buttonBox.width.toFixed(1)} x ${buttonBox.height.toFixed(1)}` : "missing action",
        });
      });

      IDENTITY_CASES.forEach((c) => {
        const host = document.getElementById(`host-${c.id}`);
        if (host) checks.push(...checkIdentity(host, c.id, c.expect));
      });

      const lightHost = document.getElementById("host-maco1-wide");
      const darkHost = document.getElementById("host-maco1-dark");
      if (lightHost) checks.push(...checkContrast(lightHost, "light", "#F9F8F6"));
      if (darkHost) checks.push(...checkContrast(darkHost, "dark", "#191816"));

      checks.push(...checkShellFrame());

      const result: GeometryReport = { ok: checks.every((c) => c.pass), checks, heights };
      setReport(result);
      const sink = document.getElementById("geometry-result");
      // base64 so --dump-dom cannot mangle the JSON through HTML escaping
      if (sink) sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);

  const strip = (gene: string, variant: string, uniprot: string, result: AnalysisResult) => (
    <VariantHeader gene={gene} variant={variant} uniprotId={uniprot} analysisResult={result} onProvideAllele={() => {}} />
  );

  return (
    <div>
      <div id="geometry-report">
        {report?.checks.map((c) => (
          <div key={c.name} style={{ font: "12px monospace", color: c.pass ? "#166534" : "#B91C1C" }}>
            {c.pass ? "PASS" : "FAIL"} {c.name} — {c.detail}
          </div>
        ))}
      </div>
      {/* Shell composition: the joined seam and the masthead budget only exist with a
          real .app-header sibling inside a .app-shell, which no other case mounts. The
          second header (last child, no following strip) pins the standalone state. */}
      <div className="app-shell" data-variant-chrome="true">
        <div className="app-main">
          <header className="app-header" id="shell-joined-header" />
          {strip("MACO1", "p.Glu433Lys", "Q9NSG2", maco1)}
          <header className="app-header" id="shell-standalone-header" />
        </div>
      </div>
      {/* Each host reserves room under the strip for its open Details panel. */}
      {CASES.map((c) => (
        <div key={c.id} style={{ width: c.width, marginBottom: c.width <= 600 ? 380 : 230 }}>
          <div id={`host-${c.id}`}>{strip(c.gene, c.variant, c.uniprot, c.result)}</div>
        </div>
      ))}
      <div style={{ width: 1000, marginBottom: 230 }}>
        <div id="host-fallback">{strip("MACO1", "p.Glu433Lys", "Q9NSG2", maco1Fallback)}</div>
      </div>
      {RECOVERY_CASES.map(c => (
        <div key={c.id} style={{ width: c.width, marginBottom: 230 }}>
          <div id={`host-${c.id}`}>{strip("SLC12A4", "p.Gln867His", "Q9UP95", ambiguousAllele)}</div>
        </div>
      ))}
      {POPULATION_CASES.map(c => (
        <div key={c.id} id={`host-${c.id}`} className={`${c.dark ? "dark " : ""}font-mono text-xs`} style={{ width: c.width, background: "var(--cs-bg)", marginBottom: 20 }}>
          <ClinicalTab {...({ analysisState: { result: ambiguousAllele, isLoading: false }, onNavigateToView: () => {} } as any)} />
          <PopulationRail analysisResult={ambiguousAllele} />
        </div>
      ))}
      {IDENTITY_CASES.map((c) => (
        <div key={c.id} id={`host-${c.id}`} className="vid-zone" style={{ width: c.width, marginBottom: 12 }}>
          <VariantIdentity
            model={buildVariantHeaderModel({ gene: "BRAF", variant: "p.Val600Glu", uniprotId: "P15056", analysisResult: braf })}
          />
        </div>
      ))}
      {/* Same strip on the dark theme, for the contrast assertions. */}
      <div className="dark" style={{ width: 1000, background: "var(--cs-bg)", paddingBottom: 230 }}>
        <div id="host-maco1-dark">{strip("MACO1", "p.Glu433Lys", "Q9NSG2", maco1)}</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

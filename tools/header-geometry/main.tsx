import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-code-pro";
import "@fontsource-variable/lora";
import "@fontsource-variable/lora/wght-italic.css";
import "../../src/index.css";
import VariantHeader from "../../src/components/VariantHeader";
import type { AnalysisResult } from "../../src/types";

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

/** There is no caption line above the rows anymore: the bare list owns the
   rail. This check keeps a future regression from re-introducing the strip. */
function checkStackedStrip(host: HTMLElement, id: string): GeometryCheck {
  const rail = host.querySelector(".vh-rail");
  const stray = host.querySelector(".vh-rail-meta");
  const list = host.querySelector(".vh-metrics");
  if (!rail || !list) {
    return { name: `${id}: rail is a bare list`, pass: false, detail: "missing rail/list" };
  }
  return {
    name: `${id}: rail is a bare list`,
    pass: stray === null && rail.firstElementChild === list,
    detail: stray ? "stray .vh-rail-meta caption still rendered" : "list is the rail's only child",
  };
}

function checkWrapped(host: HTMLElement, id: string, expectWrapped: boolean): GeometryCheck {
  const identity = host.querySelector(".variant-header-top");
  const rail = host.querySelector(".vh-rail");
  if (!identity || !rail) return { name: `${id}: wrap state`, pass: false, detail: "missing identity or rail" };
  const wrapped = rect(rail).top >= rect(identity).bottom - 1;
  return {
    name: `${id}: group ${expectWrapped ? "wraps under" : "sits beside"} the identity`,
    pass: wrapped === expectWrapped,
    detail: `rail top ${px(rect(rail).top)}, identity bottom ${px(rect(identity).bottom)}`,
  };
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
  const selectors = [".vh-metric-label", ".vh-axis-label", ".vh-chip-key", ".vh-metric-value", ".vh-verdict"];
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
    const checks: GeometryCheck[] = [];
    const heights: Record<string, number> = {};

    CASES.forEach((c) => {
      const host = document.getElementById(`host-${c.id}`);
      if (!host) return;
      checks.push(...checkCase(host, c.id, c.width));
      const header = host.querySelector(".variant-header");
      if (header) heights[c.id] = px(rect(header).height);
      checks.push(checkWrapped(host, c.id, c.width < 909));
      if (c.width <= 600) checks.push(checkStackedStrip(host, c.id));
    });

    // Contrast in both themes, composited from the real computed colours.
    const lightHost = document.getElementById("host-maco1-wide");
    const darkHost = document.getElementById("host-maco1-dark");
    if (lightHost) checks.push(...checkContrast(lightHost, "light", "#F9F8F6"));
    if (darkHost) checks.push(...checkContrast(darkHost, "dark", "#191816"));

    const result: GeometryReport = { ok: checks.every((c) => c.pass), checks, heights };
    setReport(result);

    const sink = document.getElementById("geometry-result");
    if (sink) {
      // base64 so --dump-dom cannot mangle the JSON through HTML escaping
      sink.textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
    }
  }, []);

  return (
    <div>
      <div id="geometry-report">
        {report?.checks.map((c) => (
          <div key={c.name} style={{ font: "12px monospace", color: c.pass ? "#166534" : "#B91C1C" }}>
            {c.pass ? "PASS" : "FAIL"} {c.name} — {c.detail}
          </div>
        ))}
      </div>
      {CASES.map((c) => (
        <div key={c.id} style={{ width: c.width, marginBottom: 12 }}>
          <div id={`host-${c.id}`}>
            <VariantHeader
              gene={c.gene}
              variant={c.variant}
              uniprotId={c.uniprot}
              analysisResult={c.result}
            />
          </div>
        </div>
      ))}
      {/* Same header on the dark theme, for the contrast assertions. */}
      <div className="dark" style={{ width: 1000, background: "var(--cs-bg)" }}>
        <div id="host-maco1-dark">
          <VariantHeader gene="MACO1" variant="p.Glu433Lys" uniprotId="Q9NSG2" analysisResult={maco1} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

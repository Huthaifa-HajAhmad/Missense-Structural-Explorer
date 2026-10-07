import React from "react";
import { Activity, ScatterChart, BookOpen, Bookmark } from "lucide-react";
import { AnalysisResult, UniprotFeatureItem } from "../../types";
import type { LandscapeResidueItem } from "../../shared/contracts";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { selectResidueLetter, type LandscapeRailTab } from "../../stores/slices/searchSlice";
import { AMINO_ACID_MAP_FULL, AMINO_ACID_MAP_3_TO_1 } from "../sequence/sequenceConstants";
import { AMINO_ACID_1_TO_3_TITLE } from "../../aminoAcids";
import { isGenomicOrCdnaNotation } from "../../shared/variantNotation.ts";
import {
  bandLabel,
  bandSpans,
  bandTone,
  clinvarIsQuery,
  complementBase,
  landscapeKey,
  landscapeVerdict,
  provenanceLine,
  readsAsSentence,
  residueCount,
  residueRange,
  residueSummary,
  type LandscapeTool,
  type SummaryMode
} from "../../shared/landscapeEvidence";
import { useMeasuredWidth } from "../sequence/useMeasuredWidth";
import LandscapeAgreementPlot from "../LandscapeAgreementPlot";

interface LandscapeInspectorProps {
  analysisResult: AnalysisResult | null;
  metricMode?: SummaryMode;
  setMetricMode?: (mode: SummaryMode) => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
  onSelectResidueIndex?: (idx: number) => void;
  selectedResidueIndex?: number | null;
  selectedGenomicVariant?: any | null;
}

const TOOL_NAME: Record<LandscapeTool, string> = { revel: "REVEL", alphaMissense: "AlphaMissense" };

const RAIL_TABS: Array<{ id: LandscapeRailTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "substitutions", label: "Substitutions" },
  { id: "agreement", label: "Agreement" },
  { id: "sources", label: "Sources" }
];

const SOURCES = [
  { label: "REVEL — Ioannidis et al., Am J Hum Genet 2016", doi: "10.1016/j.ajhg.2016.08.016" },
  { label: "AlphaMissense — Cheng et al., Science 2023", doi: "10.1126/science.adg7492" },
  { label: "REVEL bands — Pejaver et al., Am J Hum Genet 2022", doi: "10.1016/j.ajhg.2022.10.013" },
  { label: "AlphaMissense bands — Bergquist et al., Genet Med 2025", doi: "10.1016/j.gim.2025.101402" },
  { label: "GERP++ — Davydov et al., PLoS Comput Biol 2010", doi: "10.1371/journal.pcbi.1001025" },
  { label: "phyloP — Pollard et al., Genome Res 2010", doi: "10.1101/gr.097857.109" },
  { label: "dbNSFP — Liu et al., Genome Med 2020", doi: "10.1186/s13073-020-00803-9" }
];

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/* ─────────────────── substitution strip ─────────────────── */

export const STRIP_CHIP_W = 24;
export const STRIP_CHIP_GAP = 4;

export interface StripPlacement {
  alt: string;
  value: number;
  /** Left edge (px) of the chip's true value position, clamped inside the strip. */
  anchorLeft: number;
  /** Left edge (px) the chip is drawn at, after the collision pass. */
  chipLeft: number;
}

/**
 * Chip placement for the strip. The old strip put each letter at its raw value with no collision
 * pass, so on SOD1 residue 5 the S and V chips (0.88, 0.95) drew on top of each other and the strip
 * was unreadable at first sight. Sorted left to right, then: each chip wants to sit centred on its
 * value; a chip never sits closer to its left neighbour than chip+gap; if the run reaches past the
 * right edge the whole run is walked back, and the pass keeps a floor of 0 so nothing is pushed off
 * the left. When even the tight run does not fit, chips spread evenly (the assertion lives in the
 * landscape geometry harness at real widths).
 */
export function placeStripChips(stripWidth: number, chips: Array<{ alt: string; v: number }>): StripPlacement[] {
  const W = Math.max(120, stripWidth);
  const n = chips.length;
  const sorted = [...chips].sort((a, b) => a.v - b.v || a.alt.localeCompare(b.alt));
  const anchorOf = (v: number) => Math.min(Math.max(v * W - STRIP_CHIP_W / 2, 0), W - STRIP_CHIP_W);
  if (n === 0) return [];
  const lefts = sorted.map((c) => anchorOf(c.v));
  for (let i = 1; i < n; i++) lefts[i] = Math.max(lefts[i], lefts[i - 1] + STRIP_CHIP_W + STRIP_CHIP_GAP);
  if (lefts[n - 1] > W - STRIP_CHIP_W) {
    lefts[n - 1] = W - STRIP_CHIP_W;
    for (let i = n - 2; i >= 0; i--) lefts[i] = Math.max(0, Math.min(lefts[i], lefts[i + 1] - STRIP_CHIP_W - STRIP_CHIP_GAP));
  }
  return sorted.map((c, i) => ({ alt: c.alt, value: c.v, anchorLeft: anchorOf(c.v), chipLeft: lefts[i] }));
}

/**
 * Every scored substitution at a residue as a letter chip over the calibrated bands. A chip the
 * collision pass moved is connected to its true position by a stem and an anchor dot, so a letter
 * never reads as sitting on the wrong band. Chips are buttons: picking one selects that
 * substitution on the tab too.
 */
function SubstitutionStrip({
  tool,
  wt,
  subs,
  highlight,
  target,
  onPick
}: {
  tool: LandscapeTool;
  wt: string;
  subs: Array<{ alt: string; v: number }>;
  highlight: string | null;
  target: string | null;
  onPick: (alt: string) => void;
}) {
  const [ref, measured] = useMeasuredWidth<HTMLDivElement>();
  const placements = React.useMemo(() => placeStripChips(measured || 300, subs), [measured, subs]);
  return (
    <div ref={ref} className="lsr-strip">
      <div className="lsr-strip__bands" aria-hidden="true">
        {bandSpans(tool).map((b) => (
          <span key={b.key} className="ls-band" data-band={b.key} style={{ left: `${b.lo * 100}%`, width: `${(b.hi - b.lo) * 100}%` }} />
        ))}
      </div>
      {placements.map((p) => {
        const moved = Math.abs(p.chipLeft - p.anchorLeft) > 2;
        return moved ? <span key={`a-${p.alt}`} className="lsr-strip__anchor" aria-hidden="true" style={{ left: `${p.anchorLeft + STRIP_CHIP_W / 2}px` }} /> : null;
      })}
      {placements.map((p) => {
        const on = p.alt === highlight || p.alt === target;
        return (
          <button
            key={p.alt}
            type="button"
            className="lsr-strip__chip"
            data-on={on ? "true" : undefined}
            data-query={p.alt === target ? "true" : undefined}
            style={{ left: `${p.chipLeft + STRIP_CHIP_W / 2}px` }}
            onClick={() => onPick(p.alt)}
            aria-label={`${wt}→${p.alt} ${TOOL_NAME[tool]} ${p.value.toFixed(3)} (${bandLabel(tool, p.value)})`}
            title={`${wt}→${p.alt} ${p.value.toFixed(3)} · ${bandLabel(tool, p.value)}`}
          >
            {p.alt}
          </button>
        );
      })}
      {placements.map((p) => {
        const moved = Math.abs(p.chipLeft - p.anchorLeft) > 2;
        return moved ? <span key={`s-${p.alt}`} className="lsr-strip__stem" aria-hidden="true" style={{ left: `${p.chipLeft + STRIP_CHIP_W / 2}px` }} /> : null;
      })}
      <span className="lsr-strip__axis" aria-hidden="true">
        <span>0</span>
        <span>1</span>
      </span>
    </div>
  );
}

/* ─────────────────── the rail ─────────────────── */

export const LandscapeInspector: React.FC<LandscapeInspectorProps> = ({
  analysisResult,
  metricMode = "mean",
  onSelectResidueIndex,
  selectedResidueIndex: selectedResidueProp,
  selectedGenomicVariant: selectedGenomicVariantProp
}) => {
  const storeSelectedRes = useVariantAnalysisStore((s) => s.selectedResidueIndex);
  const storeHoveredRes = useVariantAnalysisStore((s) => s.hoveredResidueIndex);
  const storeGenomicVariant = useVariantAnalysisStore((s) => s.selectedGenomicVariant);
  const gene = useVariantAnalysisStore((s) => s.gene);
  const variant = useVariantAnalysisStore((s) => s.variant);
  const uniprotId = useVariantAnalysisStore((s) => s.uniprotId);
  const activeTab = useVariantAnalysisStore((s) => s.landscapeRailTab);
  const setActiveTab = useVariantAnalysisStore((s) => s.setLandscapeRailTab);
  const extraKey = landscapeKey(gene, variant, uniprotId);
  const extraRows = useVariantAnalysisStore((s) => (s.landscapeExtra?.key === extraKey ? s.landscapeExtra.rows : null));
  const selection = useVariantAnalysisStore((s) => (s.landscapeSelection?.key === extraKey ? s.landscapeSelection : null));
  const setSelection = useVariantAnalysisStore((s) => s.setLandscapeSelection);
  const overview = useVariantAnalysisStore((s) => (s.landscapeOverview?.key === extraKey ? s.landscapeOverview : null));
  const activeResIndex = storeHoveredRes ?? selectedResidueProp ?? storeSelectedRes;
  const selectedGenomicVariant = selectedGenomicVariantProp ?? storeGenomicVariant;
  const residueLetter = useVariantAnalysisStore((s) => selectResidueLetter(s, activeResIndex));

  const domains: UniprotFeatureItem[] = (analysisResult?.uniprotFeatures?.features || []).filter(
    (f: any) => f.type === "DOMAIN" || f.type === "REGION"
  );
  const meta = analysisResult?.landscapeMeta ?? null;

  const rows: LandscapeResidueItem[] = React.useMemo(() => {
    const map = new Map<number, LandscapeResidueItem>();
    for (const item of [...(analysisResult?.landscapeData ?? []), ...(extraRows ?? [])]) {
      if (item && typeof item.residx === "number") map.set(item.residx, item);
    }
    return [...map.values()].sort((a, b) => a.residx - b.residx);
  }, [analysisResult?.landscapeData, extraRows]);
  const scoredRows = rows.filter((r) => residueCount(r, "revel") > 0 || residueCount(r, "alphaMissense") > 0);
  const plottedSpan = scoredRows.length
    ? `residues ${scoredRows[0].residx}–${scoredRows[scoredRows.length - 1].residx} loaded, ${scoredRows.length} scored`
    : "no scored residues";
  const activeRow = activeResIndex ? rows.find((r) => r.residx === activeResIndex) : undefined;

  const target = React.useMemo(() => {
    const raw = variant || analysisResult?.metadata?.variant || "";
    let parsed: { pos: number; wt: string; mut: string } | null = null;
    if (raw && !isGenomicOrCdnaNotation(raw) && !/^(?:chr)?[\dXYM]+[-:]/i.test(raw)) {
      const m = raw.match(/^(?:p\.)?([A-Za-z]{1,3})(\d+)([A-Za-z]{1,3})?$/);
      if (m) {
        const one = (s: string) => (s.length === 3 ? AMINO_ACID_MAP_3_TO_1[s.toUpperCase()] || s : s);
        parsed = { pos: parseInt(m[2], 10), wt: one(m[1]), mut: one(m[3] || "") };
      }
    }
    return {
      pos: analysisResult?.metadata?.residueIndex ?? parsed?.pos ?? null,
      wt: analysisResult?.metadata?.wildType || parsed?.wt || "",
      mut: analysisResult?.metadata?.mutant || parsed?.mut || ""
    };
  }, [variant, analysisResult?.metadata?.variant, analysisResult?.metadata?.residueIndex, analysisResult?.metadata?.wildType, analysisResult?.metadata?.mutant]);

  const isTarget = Boolean(activeResIndex && target.pos && activeResIndex === target.pos);
  const resSymbol = residueLetter || (isTarget ? target.wt : "") || activeRow?.aaref || "";
  const aaData = resSymbol ? AMINO_ACID_MAP_FULL[resSymbol] : null;
  const variantScores = {
    revel: finite(analysisResult?.conservationData?.revel),
    alphaMissense: finite(analysisResult?.predictorData?.amPathogenicity)
  };

  /*
   * Verdict first: what the chips are read on (the picked substitution, the queried variant, or the
   * residue summary) is decided in the shared model, never re-derived here.
   */
  const selectedAlt = selection?.kind === "substitution" && selection.pos === activeResIndex ? selection.alt ?? null : null;
  const verdict = landscapeVerdict({
    target: target.pos && target.wt && target.mut ? { pos: target.pos, wt: target.wt, mut: target.mut } : null,
    residx: activeResIndex ?? null,
    row: activeRow,
    variantRevel: variantScores.revel,
    variantAm: variantScores.alphaMissense,
    mode: metricMode,
    selectedAlt
  });
  // The per-tool block repeats "this variant 0.853" only when the verdict row does not already
  // carry it (it does for a variant-level verdict).
  const showVariantLine = !(verdict.kind === "variant" && verdict.isQuery);
  const noRecord = Boolean(activeRow && residueCount(activeRow, "revel") === 0 && residueCount(activeRow, "alphaMissense") === 0);

  const residueContext = (() => {
    const ctx = overview?.data?.context;
    if (!activeResIndex || !ctx) return [] as Array<{ label: string; value: string }>;
    const out: Array<{ label: string; value: string }> = [];
    const cv = ctx.clinvar?.filter((c) => c.pos === activeResIndex) ?? [];
    if (ctx.clinvar)
      out.push({
        label: "ClinVar",
        value: cv.length
          ? cv.map((c) => `${c.hgvsp} ${c.significance}${clinvarIsQuery(c, target.pos ? { pos: target.pos, mut: target.mut } : null) ? " (queried)" : ""}`).join("; ")
          : "no missense here"
      });
    const gn = ctx.gnomad?.find((x) => x.pos === activeResIndex);
    if (ctx.gnomad) out.push({ label: "gnomAD", value: gn ? `${gn.variants} missense, max AC ${gn.maxAc}` : "no missense here" });
    const region = ctx.regions?.find((r) => activeResIndex >= r.start && activeResIndex <= r.end);
    if (ctx.regions) out.push({ label: "Regional O/E", value: region ? `${region.oe ?? "—"} (${region.start}–${region.end}, ${ctx.regionsBasis})` : "no constrained region" });
    return out;
  })();

  // The picked nucleotide stays in the store after the reader moves on to a residue or substitution;
  // it is shown only while it is the current selection (or when the exon panel set it alone).
  const g = !selection || selection.kind === "nucleotide" ? selectedGenomicVariant : null;
  const codingChange =
    g && g.strand === "-" && !g.isRef ? ` (coding ${complementBase(String(g.ref))}>${complementBase(String(g.alt))})` : "";

  /* Tablist: one roving tab stop, arrow / Home / End move, selection follows focus. */
  const onTablistKey = (e: React.KeyboardEvent) => {
    const keys = RAIL_TABS.map((t) => t.id);
    const at = keys.indexOf(activeTab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (at + 1) % keys.length;
    else if (e.key === "ArrowLeft") next = (at - 1 + keys.length) % keys.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    if (next === null) return;
    e.preventDefault();
    setActiveTab(RAIL_TABS[next].id);
    (e.currentTarget.querySelector<HTMLElement>(`#lsr-tab-${RAIL_TABS[next].id}`))?.focus();
  };

  const toolBlock = (tool: LandscapeTool) => {
    const range = residueRange(activeRow, tool);
    const n = residueCount(activeRow, tool);
    const own = showVariantLine && isTarget ? variantScores[tool] : null;
    return (
      <div key={tool} className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold text-cs-text-primary">{TOOL_NAME[tool]}</span>
          <span className="lsr-strip__meta">{range ? `${range[0].toFixed(2)}–${range[1].toFixed(2)}` : "no score"}</span>
        </div>
        {(activeRow?.substitutions?.length ?? 0) > 0 && (
          <SubstitutionStrip
            tool={tool}
            wt={resSymbol}
            subs={(activeRow?.substitutions ?? [])
              .map((x) => ({ alt: x.alt, v: tool === "revel" ? x.revel : x.am }))
              .filter((x): x is { alt: string; v: number } => x.v !== null)}
            highlight={selectedAlt}
            target={isTarget ? target.mut : null}
            onPick={(alt) => {
              if (!activeResIndex) return;
              setSelection({ key: extraKey, kind: "substitution", pos: activeResIndex, alt });
              onSelectResidueIndex?.(activeResIndex);
            }}
          />
        )}
        <div className="flex justify-between text-[10px] font-mono text-cs-text-muted">
          <span>
            {n} substitution{n === 1 ? "" : "s"} scored
          </span>
        </div>
        {own !== null && (
          <div className="text-[10px] font-mono text-cs-accent-clay">
            ◆ this variant {own.toFixed(3)} · {verdict.calls.find((c) => c.tool === tool)?.band ?? ""}
          </div>
        )}
      </div>
    );
  };

  const hasSelection = Boolean(g || activeResIndex);

  return (
    <div className="lsr-root flex flex-col gap-3 text-xs font-sans">
      <div className="lsr-tabs" role="tablist" aria-label="Landscape inspector" onKeyDown={onTablistKey}>
        {RAIL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lsr-tab-${t.id}`}
            aria-selected={activeTab === t.id}
            aria-controls={`lsr-panel-${t.id}`}
            tabIndex={activeTab === t.id ? 0 : -1}
            data-active={activeTab === t.id ? "true" : undefined}
            className="ls-pill lsr-tab"
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && (
        <div role="tabpanel" id="lsr-panel-summary" aria-labelledby="lsr-tab-summary" className="lsr-panelbox">
          {!hasSelection ? (
            <div className="lsr-empty">Nothing is selected yet. Hover or click a residue on the tab, or pick a nucleotide in the exon panel.</div>
          ) : (
            <div className="lsr-card flex flex-col gap-2.5">
              {g && (
                <div className="flex flex-col gap-1 pb-2.5 border-b border-cs-border-subtle">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-cs-text-primary">
                      chr{g.chrom}:{g.pos} {g.ref}&gt;{g.alt}
                      <span className="font-normal text-cs-text-muted">{codingChange}</span>
                    </span>
                    {g.rankBand && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-cs-text-secondary" title="Genome-wide rank decade of the AlphaGenome AVI; not an ACMG band">
                        {g.rankBand}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-cs-text-secondary">
                    <span>AVI Phred {finite(g.phred) !== null ? Number(g.phred).toFixed(2) : "—"}</span>
                    <span>{g.codonIndex ? `residue ${g.codonIndex}, codon position ${g.codonPosition}/3` : g.isExonic ? "exonic, no codon reported" : "splice flank"}</span>
                  </div>
                  {g.topModality && <span className="text-[10px] text-cs-text-muted">Largest predicted effect: {g.topModality}</span>}
                </div>
              )}

              {activeResIndex && (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className={`h-9 w-9 rounded-lg shrink-0 flex items-center justify-center font-mono font-bold text-base border bg-cs-surface text-cs-text-primary ${isTarget ? "border-cs-accent-clay border-2" : "border-cs-border"}`}>
                      {resSymbol || "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-cs-text-primary">
                        {aaData?.name ? `${aaData.name} ` : "Residue "}{activeResIndex}
                      </div>
                      <div className="text-[11px] text-cs-text-muted truncate">
                        {isTarget && target.wt && target.mut
                          ? `Queried: ${AMINO_ACID_1_TO_3_TITLE[target.wt] || target.wt} → ${AMINO_ACID_1_TO_3_TITLE[target.mut] || target.mut}`
                          : aaData?.property || ""}
                      </div>
                    </div>
                  </div>

                  {activeRow?.refMismatch && (
                    <div className="text-[11px] text-cs-text-warning">
                      dbNSFP reports {activeRow.aaref} here, not {resSymbol}: these scores may be on a different numbering.
                    </div>
                  )}

                  {noRecord ? (
                    <div className="text-[12px] text-cs-text-secondary leading-snug">
                      <span className="font-semibold text-cs-text-primary">No score to read here.</span> dbNSFP has no missense record at residue {activeResIndex}, so
                      there is no REVEL, AlphaMissense or conservation score to show. That is absence of data, not a benign reading.
                      {isTarget && (variantScores.revel !== null || variantScores.alphaMissense !== null) && (
                        <span className="block font-mono text-[11px] text-cs-accent-clay mt-1.5">
                          ◆ this variant{variantScores.revel !== null ? ` REVEL ${variantScores.revel.toFixed(3)} · ${verdict.calls.find((c) => c.tool === "revel")?.band ?? ""}` : ""}
                          {variantScores.alphaMissense !== null ? ` AlphaMissense ${variantScores.alphaMissense.toFixed(3)} · ${verdict.calls.find((c) => c.tool === "alphaMissense")?.band ?? ""}` : ""}
                        </span>
                      )}
                    </div>
                  ) : activeRow ? (
                    <>
                      {/* The lead box: the verdict as one plain sentence, before any figure. */}
                      <div className="lsr-readsas">
                        <span className="font-semibold">Reads as</span> · {readsAsSentence(verdict)}
                      </div>
                      <div className="lsr-verdict" role="list" aria-label="What the scores are read on">
                        {verdict.calls.map((c) => (
                          <div key={c.tool} className="lsr-verdict__row" role="listitem">
                            <span className="lsr-verdict__score">
                              {TOOL_NAME[c.tool]} {c.score !== null ? c.score.toFixed(3) : "—"}
                            </span>
                            <span className="ev-tier" data-tone={bandTone(c.band)}>
                              {c.band ?? "no score"}
                            </span>
                          </div>
                        ))}
                        <span className="lsr-scope">
                          {verdict.kind === "variant" && verdict.isQuery ? "The queried variant · " : verdict.kind === "substitution" ? "Selected substitution · " : ""}
                          {verdict.scope}
                        </span>
                        {verdict.rank && (
                          <span className="lsr-scope">
                            Ranks {verdict.rank.rank} of {verdict.rank.of} scored substitutions here by AlphaMissense (1 = highest).
                          </span>
                        )}
                      </div>

                      {residueContext.length > 0 && (
                        <div className="lsr-kv">
                          {residueContext.map((r) => (
                            <div key={r.label} className="lsr-kv__row">
                              <span className="lsr-kv__label">{r.label}</span>
                              <span className="lsr-kv__value">{r.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] italic text-cs-text-muted">No residue scores are loaded for residue {activeResIndex}.</div>
                  )}
                </>
              )}
            </div>
          )}

          {domains.length > 0 && (
            <section className="flex flex-col gap-2 pt-3">
              <div className="flex items-center justify-between">
                <span className="lsr-eyebrow flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5 text-cs-accent-clay" />
                  Go to domain
                </span>
                <span className="text-[10px] font-mono text-cs-text-muted">{domains.length}</span>
              </div>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-0.5">
                {domains.map((dom, i) => (
                  <button
                    key={`${dom.description}_${i}`}
                    type="button"
                    onClick={() => onSelectResidueIndex?.(dom.start)}
                    className="p-2 rounded-lg border border-cs-border-subtle bg-cs-surface-2 hover:border-cs-accent-clay text-left cursor-pointer flex items-center justify-between gap-2"
                    title="Centre the residue grid on this domain's first residue"
                  >
                    <span className="font-semibold text-[11px] text-cs-text-primary truncate">{dom.description || "Region"}</span>
                    <span className="font-mono text-[10px] text-cs-text-secondary shrink-0">{dom.start}–{dom.end}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === "substitutions" && (
        <div role="tabpanel" id="lsr-panel-substitutions" aria-labelledby="lsr-tab-substitutions" className="lsr-panelbox">
          {!activeResIndex ? (
            <div className="lsr-empty">No residue is selected. Pick one on the tab to see its substitutions.</div>
          ) : noRecord ? (
            <div className="lsr-empty">dbNSFP has no missense record at residue {activeResIndex} — there is nothing to break down.</div>
          ) : !activeRow ? (
            <div className="lsr-empty">No residue scores are loaded for residue {activeResIndex}.</div>
          ) : (
            <div className="lsr-card flex flex-col gap-3">
              {toolBlock("revel")}
              {toolBlock("alphaMissense")}
              <div className="flex justify-between text-[10px] font-mono text-cs-text-secondary border-t border-cs-border-subtle pt-2">
                <span>GERP++ {activeRow.gerp !== null ? activeRow.gerp.toFixed(2) : "—"}</span>
                <span>phyloP {activeRow.phylop !== null ? activeRow.phylop.toFixed(2) : "—"}</span>
                <span className="text-cs-text-muted">{activeRow.nucleotideCount ?? 0} nt</span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "agreement" && (
        <div role="tabpanel" id="lsr-panel-agreement" aria-labelledby="lsr-tab-agreement" className="lsr-panelbox">
          {scoredRows.length === 0 ? (
            <div className="lsr-empty">No residue has both a REVEL and an AlphaMissense score, so there is nothing to plot.</div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="lsr-eyebrow flex items-center gap-1.5">
                <ScatterChart className="w-3.5 h-3.5 text-cs-accent-clay" />
                REVEL × AlphaMissense
              </span>
              <span className="text-[10px] font-mono text-cs-text-muted">{plottedSpan} · residue {metricMode}s</span>
              <div className="rounded-lg border border-cs-border-subtle bg-cs-surface-2 p-2">
                <LandscapeAgreementPlot
                  rows={rows}
                  variantRevel={variantScores.revel}
                  variantAm={variantScores.alphaMissense}
                  mode={metricMode}
                  selectedResidue={activeResIndex}
                  onSelectResidue={onSelectResidueIndex}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "sources" && (
        <div role="tabpanel" id="lsr-panel-sources" aria-labelledby="lsr-tab-sources" className="lsr-panelbox">
          <section className="flex flex-col gap-2">
            <span className="lsr-eyebrow flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-cs-accent-clay" />
              Sources & method
            </span>
            <div className="text-[11px] text-cs-text-secondary leading-snug flex flex-col gap-1.5">
              <span className="font-mono text-[10px]">{provenanceLine(meta)}</span>
              {meta?.window && <span>Scores loaded for residues {meta.window.start}–{meta.window.end}{meta.retrievedAt ? `, retrieved ${new Date(meta.retrievedAt).toLocaleString()}` : ""}.</span>}
              <details>
                <summary className="cursor-pointer font-semibold text-cs-text-primary select-none w-fit rounded focus-visible:outline-2 focus-visible:outline-cs-accent-clay">Method and citations</summary>
                <div className="flex flex-col gap-1.5 pt-2">
                  <span>
                    Each SNV is counted once, on one transcript. REVEL and AlphaMissense are summarised over a residue's
                    missense substitutions; GERP++ and phyloP are averaged over the codon's nucleotides.
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {SOURCES.map((s) => (
                      <li key={s.doi}>
                        <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" className="text-cs-accent-clay hover:underline">
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default React.memo(LandscapeInspector);

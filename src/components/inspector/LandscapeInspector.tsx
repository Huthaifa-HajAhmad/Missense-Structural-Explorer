import React from "react";
import { Bookmark, Activity, ScatterChart, BookOpen } from "lucide-react";
import { AnalysisResult, UniprotFeatureItem } from "../../types";
import type { LandscapeResidueItem } from "../../shared/contracts";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { selectResidueLetter } from "../../stores/slices/searchSlice";
import { AMINO_ACID_MAP_FULL, AMINO_ACID_MAP_3_TO_1 } from "../sequence/sequenceConstants";
import { AMINO_ACID_1_TO_3_TITLE } from "../../aminoAcids";
import { isGenomicOrCdnaNotation } from "../../shared/variantNotation.ts";
import { complementBase, bandLabel, landscapeKey, legendSteps, provenanceLine, residueCount, residueRange, residueSummary, type LandscapeTool, type SummaryMode } from "../../shared/landscapeEvidence";
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

/**
 * Every scored substitution at a residue as a letter on the 0–1 axis, over the calibrated bands.
 * Letters are buttons: picking one selects that substitution on the tab too.
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
  const edges = legendSteps(tool);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative h-7 rounded overflow-hidden flex">
        {edges.map((e) => {
          const [lo, hi] = stepSpan(e.range);
          return <span key={e.key} className="ls-band h-full" data-band={e.key} style={{ width: `${(hi - lo) * 100}%` }} title={`${e.label} ${e.range}`} />;
        })}
        {subs.map((x) => {
          const on = x.alt === highlight || x.alt === target;
          return (
            <button
              key={x.alt}
              type="button"
              onClick={() => onPick(x.alt)}
              className={`absolute top-1 -ml-[9px] w-[18px] h-5 rounded border text-[10px] font-mono font-bold cursor-pointer ${
                on ? "bg-cs-text-primary text-cs-surface border-cs-text-primary z-10" : "bg-cs-surface text-cs-text-primary border-cs-text-primary"
              } ${x.alt === target ? "ring-2 ring-cs-accent-clay" : ""}`}
              style={{ left: `${Math.min(97, Math.max(3, x.v * 100))}%` }}
              aria-label={`${wt}→${x.alt} ${TOOL_NAME[tool]} ${x.v.toFixed(3)}`}
              title={`${wt}→${x.alt} ${x.v.toFixed(3)}`}
            >
              {x.alt}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-cs-text-muted">
        <span>0</span>
        <span>1</span>
      </div>
    </div>
  );
}

/** Numeric span of a legend range string ("0.644–0.773", "≥ 0.932", "≤ 0.016") on [0, 1]. */
function stepSpan(range: string): [number, number] {
  const nums = (range.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (range.startsWith("≥")) return [nums[0], 1];
  if (range.startsWith("≤")) return [0, nums[0]];
  return [Math.min(nums[0], nums[1]), Math.max(nums[0], nums[1])];
}

export const LandscapeInspector: React.FC<LandscapeInspectorProps> = ({
  analysisResult,
  metricMode = "mean",
  setMetricMode,
  windowSize = 31,
  setWindowSize,
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

  const toolBlock = (tool: LandscapeTool) => {
    const summary = residueSummary(activeRow, tool, metricMode);
    const range = residueRange(activeRow, tool);
    const n = residueCount(activeRow, tool);
    const own = isTarget ? variantScores[tool] : null;
    return (
      <div key={tool} className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="font-semibold text-cs-text-primary">{TOOL_NAME[tool]}</span>
          <span className="font-mono text-cs-text-secondary">
            {summary !== null ? `${metricMode} ${summary.toFixed(3)}` : "no score"}
          </span>
        </div>
        {(activeRow?.substitutions?.length ?? 0) > 0 && (
          <SubstitutionStrip
            tool={tool}
            wt={resSymbol}
            subs={(activeRow?.substitutions ?? [])
              .map((x) => ({ alt: x.alt, v: tool === "revel" ? x.revel : x.am }))
              .filter((x): x is { alt: string; v: number } => x.v !== null)}
            highlight={selection?.kind === "substitution" && selection.pos === activeResIndex ? selection.alt ?? null : null}
            target={isTarget ? target.mut : null}
            onPick={(alt) => {
              if (!activeResIndex) return;
              setSelection({ key: extraKey, kind: "substitution", pos: activeResIndex, alt });
              onSelectResidueIndex?.(activeResIndex);
            }}
          />
        )}
        <div className="flex justify-between text-[10px] font-mono text-cs-text-muted">
          <span>{n} substitution{n === 1 ? "" : "s"}{range ? ` · ${range[0].toFixed(2)}–${range[1].toFixed(2)}` : ""}</span>
          {summary !== null && <span>{bandLabel(tool, summary)}</span>}
        </div>
        {own !== null && (
          <div className="text-[10px] font-mono text-cs-accent-clay">
            ◆ this variant {own.toFixed(3)} · {bandLabel(tool, own)}
          </div>
        )}
      </div>
    );
  };

  const selectedSub = (() => {
    if (!activeResIndex || selection?.kind !== "substitution" || selection.pos !== activeResIndex || !selection.alt) return null;
    const subs = (activeRow?.substitutions ?? []).filter((x) => x.am !== null);
    const hit = activeRow?.substitutions?.find((x) => x.alt === selection.alt) ?? null;
    const own = isTarget && selection.alt === target.mut;
    const am = hit?.am ?? (own ? variantScores.alphaMissense : null);
    const revel = hit?.revel ?? (own ? variantScores.revel : null);
    const rank = am !== null ? subs.filter((x) => (x.am as number) > am).length + 1 : 0;
    return { alt: selection.alt, am, revel, scored: Boolean(hit), rank, of: subs.length };
  })();

  const residueContext = (() => {
    const ctx = overview?.data?.context;
    if (!activeResIndex || !ctx) return [] as string[];
    const out: string[] = [];
    const cv = ctx.clinvar?.filter((c) => c.pos === activeResIndex) ?? [];
    if (ctx.clinvar) out.push(cv.length ? `ClinVar: ${cv.map((c) => `${c.hgvsp} ${c.significance}`).join("; ")}` : "ClinVar: no missense here");
    const gn = ctx.gnomad?.find((x) => x.pos === activeResIndex);
    if (ctx.gnomad) out.push(gn ? `gnomAD: ${gn.variants} missense, max AC ${gn.maxAc}` : "gnomAD: no missense here");
    const region = ctx.regions?.find((r) => activeResIndex >= r.start && activeResIndex <= r.end);
    if (ctx.regions) out.push(region ? `Regional O/E ${region.oe ?? "—"} (${region.start}–${region.end}, gnomAD v2)` : "Regional O/E: no constrained region");
    return out;
  })();

  // The picked nucleotide stays in the store after the reader moves on to a residue or substitution;
  // it is shown only while it is the current selection (or when the exon panel set it alone).
  const g = !selection || selection.kind === "nucleotide" ? selectedGenomicVariant : null;
  const codingChange =
    g && g.strand === "-" && !g.isRef ? ` (coding ${complementBase(String(g.ref))}>${complementBase(String(g.alt))})` : "";

  return (
    <div className="flex flex-col gap-4 text-xs font-sans">
      {(g || activeResIndex) && (
        <section className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-cs-accent-clay" />
            Selection
          </span>
          <div className="p-3 rounded-lg border border-cs-border-subtle bg-cs-surface-2 flex flex-col gap-3">
            {g && (
              <div className="flex flex-col gap-1 pb-2 border-b border-cs-border-subtle">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-cs-text-primary">
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
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <div className={`h-9 w-9 rounded-lg shrink-0 flex items-center justify-center font-mono font-bold text-sm border bg-cs-surface text-cs-text-primary ${isTarget ? "border-cs-accent-clay border-2" : "border-cs-border"}`}>
                    {resSymbol || "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-cs-text-primary">
                      {aaData?.name ? `${aaData.name} ` : "Residue "}{activeResIndex}
                    </div>
                    <div className="text-[10px] text-cs-text-muted truncate">
                      {isTarget && target.wt && target.mut
                        ? `Queried: ${AMINO_ACID_1_TO_3_TITLE[target.wt] || target.wt} → ${AMINO_ACID_1_TO_3_TITLE[target.mut] || target.mut}`
                        : aaData?.property || ""}
                    </div>
                  </div>
                </div>
                {activeRow?.refMismatch && (
                  <div className="text-[10px] text-cs-text-warning">
                    dbNSFP reports {activeRow.aaref} here, not {resSymbol}: these scores may be on a different numbering.
                  </div>
                )}
                {selectedSub && (
                  <div className="p-2 rounded border border-cs-border bg-cs-surface flex flex-col gap-1">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono font-semibold text-cs-text-primary">
                        {resSymbol}{activeResIndex}{selectedSub.alt}
                      </span>
                      <span className="text-[10px] text-cs-text-muted">
                        {isTarget && selectedSub.alt === target.mut ? "the queried variant" : "substitution"}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono">
                      <span>AlphaMissense {selectedSub.am !== null ? `${selectedSub.am.toFixed(3)} · ${bandLabel("alphaMissense", selectedSub.am)}` : "—"}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-mono">
                      <span>REVEL {selectedSub.revel !== null ? `${selectedSub.revel.toFixed(3)} · ${bandLabel("revel", selectedSub.revel)}` : "—"}</span>
                    </div>
                    <span className="text-[10px] text-cs-text-muted">
                      {selectedSub.scored
                        ? `Ranks ${selectedSub.rank} of ${selectedSub.of} scored substitutions here by AlphaMissense (1 = highest). A variant-level score: its band applies to it.`
                        : "Not in dbNSFP for this residue: either it needs two or more nucleotide changes, or it has no score."}
                    </span>
                  </div>
                )}
                {residueContext.length > 0 && (
                  <div className="flex flex-col gap-0.5 text-[10px] font-mono text-cs-text-secondary">
                    {residueContext.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                )}
                {activeRow ? (
                  <>
                    {toolBlock("revel")}
                    {toolBlock("alphaMissense")}
                    <div className="flex justify-between text-[10px] font-mono text-cs-text-secondary border-t border-cs-border-subtle pt-2">
                      <span>GERP++ {activeRow.gerp !== null ? activeRow.gerp.toFixed(2) : "—"}</span>
                      <span>phyloP {activeRow.phylop !== null ? activeRow.phylop.toFixed(2) : "—"}</span>
                      <span className="text-cs-text-muted">{activeRow.nucleotideCount ?? 0} nt</span>
                    </div>
                  </>
                ) : (
                  <div className="text-[10px] italic text-cs-text-muted">No residue scores are loaded for residue {activeResIndex}.</div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
            <ScatterChart className="w-3.5 h-3.5 text-cs-accent-clay" />
            REVEL × AlphaMissense · residues {rows[0].residx}–{rows[rows.length - 1].residx}
          </span>
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
        </section>
      )}

      {domains.length > 0 && (
        <section className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
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

      <section className="flex flex-col gap-2 pt-3 border-t border-cs-border-subtle">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-cs-text-muted flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-cs-accent-clay" />
          Sources & method
        </span>
        <div className="text-[11px] text-cs-text-secondary leading-snug flex flex-col gap-1.5">
          <span className="font-mono text-[10px]">{provenanceLine(meta)}</span>
          {meta?.window && <span>Scores loaded for residues {meta.window.start}–{meta.window.end}{meta.retrievedAt ? `, retrieved ${new Date(meta.retrievedAt).toLocaleString()}` : ""}.</span>}
          <span>
            Each SNV is counted once, on one transcript. REVEL and AlphaMissense are summarised over a residue's
            missense SNVs; GERP++ and phyloP are averaged over the codon's nucleotides.
          </span>
          <ul className="flex flex-col gap-0.5 mt-1">
            {SOURCES.map((s) => (
              <li key={s.doi}>
                <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noopener noreferrer" className="text-cs-accent-clay hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
};

export default React.memo(LandscapeInspector);

import React from "react";
import { Crosshair } from "lucide-react";
import { AnalysisResult } from "../../types";
import type { LandscapeResidueItem } from "../../shared/contracts";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { selectResidueLetter } from "../../stores/slices/searchSlice";
import { AMINO_ACID_MAP_FULL, toOneLetter } from "../sequence/sequenceConstants";
import { AMINO_ACID_1_TO_3_TITLE } from "../../aminoAcids";
import { isGenomicOrCdnaNotation } from "../../shared/variantNotation.ts";
import { LandscapeLocalContext, LandscapeDomainNavigation } from "./LandscapeLocalContext";
import { LandscapeMethods } from "./LandscapeMethods";
import { SubstitutionStrip } from "./LandscapeSubstitutionStrip";
export { placeStripChips } from "./LandscapeSubstitutionStrip";
import {
  bandLabel,
  bandTone,
  complementBase,
  landscapeKey,
  landscapeVerdict,
  provenanceLine,
  residueCount,
  residueRange,
  TOOL_DISPLAY,
  type LandscapeTool,
  type SummaryMode
} from "../../shared/landscapeEvidence";

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

const TOOL_NAME = TOOL_DISPLAY;

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

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
  const extraKey = landscapeKey(gene, variant, uniprotId);
  const extraRows = useVariantAnalysisStore((s) => (s.landscapeExtra?.key === extraKey ? s.landscapeExtra.rows : null));
  const selection = useVariantAnalysisStore((s) => (s.landscapeSelection?.key === extraKey ? s.landscapeSelection : null));
  const setSelection = useVariantAnalysisStore((s) => s.setLandscapeSelection);
  const overview = useVariantAnalysisStore((s) => (s.landscapeOverview?.key === extraKey ? s.landscapeOverview : null));
  const activeResIndex = storeHoveredRes ?? selectedResidueProp ?? storeSelectedRes;
  const selectedGenomicVariant = selectedGenomicVariantProp ?? storeGenomicVariant;
  const residueLetter = useVariantAnalysisStore((s) => selectResidueLetter(s, activeResIndex));

  const meta = analysisResult?.landscapeMeta ?? null;

  const rows: LandscapeResidueItem[] = React.useMemo(() => {
    const map = new Map<number, LandscapeResidueItem>();
    for (const item of [...(analysisResult?.landscapeData ?? []), ...(extraRows ?? [])]) {
      map.set(item.residx, item);
    }
    return [...map.values()].sort((a, b) => a.residx - b.residx);
  }, [analysisResult?.landscapeData, extraRows]);
  const activeRow = activeResIndex ? rows.find((r) => r.residx === activeResIndex) : undefined;

  const target = React.useMemo(() => {
    const raw = variant || analysisResult?.metadata?.variant || "";
    const one = (s: string) => toOneLetter(s) || s.trim();
    let parsed: { pos: number; wt: string; mut: string } | null = null;
    if (raw && !isGenomicOrCdnaNotation(raw) && !/^(?:chr)?[\dXYM]+[-:]/i.test(raw)) {
      const m = raw.match(/^(?:p\.)?([A-Za-z]{1,3})(\d+)([A-Za-z]{1,3})?$/);
      if (m) {
        parsed = { pos: parseInt(m[2], 10), wt: one(m[1]), mut: one(m[3] || "") };
      }
    }
    return {
      pos: analysisResult?.metadata?.residueIndex ?? parsed?.pos ?? null,
      wt: one(analysisResult?.metadata?.wildType || parsed?.wt || ""),
      mut: one(analysisResult?.metadata?.mutant || parsed?.mut || "")
    };
  }, [variant, analysisResult?.metadata?.variant, analysisResult?.metadata?.residueIndex, analysisResult?.metadata?.wildType, analysisResult?.metadata?.mutant]);

  const isTarget = Boolean(activeResIndex && target.pos && activeResIndex === target.pos);
  const resSymbol = residueLetter || (isTarget ? target.wt : "") || activeRow?.aaref || "";
  const aaData = resSymbol ? AMINO_ACID_MAP_FULL[resSymbol] : null;
  const variantScores = {
    revel: finite(analysisResult?.conservationData?.revel),
    alphaMissense: finite(analysisResult?.predictorData?.amPathogenicity)
  };

  const selectedAlt = selection?.kind === "substitution" && selection.pos === activeResIndex ? selection.alt ?? null : null;
  const verdict = landscapeVerdict({
    target: target.pos && target.wt && target.mut ? { pos: target.pos, wt: target.wt, mut: target.mut } : null,
    residx: activeResIndex ?? null,
    row: activeRow,
    variantRevel: variantScores.revel,
    variantAm: variantScores.alphaMissense,
    mode: metricMode,
    selectedAlt,
    provenance: { am: analysisResult?.predictorData?.amProvenance, revel: analysisResult?.conservationData?.revelProvenance, table: provenanceLine(meta) }
  });
  const showVariantLine = !(verdict.kind === "variant" && verdict.isQuery);
  const noRecord = Boolean(activeRow && residueCount(activeRow, "revel") === 0 && residueCount(activeRow, "alphaMissense") === 0);

  // The picked nucleotide stays in the store after the reader moves on to a residue or substitution;
  // it is shown only while it is the current selection (or when the exon panel set it alone).
  const g = !selection || selection.kind === "nucleotide" ? selectedGenomicVariant : null;
  const codingChange =
    g && g.strand === "-" && !g.isRef ? ` (coding ${complementBase(String(g.ref))}>${complementBase(String(g.alt))})` : "";

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
            highlight={selectedAlt ?? (verdict.isQuery ? target.mut : null)}
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
            ◆ this variant {own.toFixed(3)} · {bandLabel(tool, own)}
          </div>
        )}
      </div>
    );
  };

  const hasSelection = Boolean(g || activeResIndex);

  return (
    <div className="lsr-root flex flex-col gap-3 text-xs font-sans">
      <div className="lsr-selection-heading"><div className="lsr-selection-identity"><strong>{verdict.label || 'Select a residue'}</strong>
        <span>{storeHoveredRes ? 'Residue preview' : verdict.kind === 'residue' ? 'Residue summary' : verdict.isQuery ? 'Queried substitution' : 'Inspected substitution'}</span></div>
        {target.pos && <button type="button" className="lsr-return" onClick={() => {
          setSelection({ key: extraKey, kind: 'substitution', pos: target.pos!, alt: target.mut || undefined });
          onSelectResidueIndex?.(target.pos!);
        }}><Crosshair size={13} /> Query {target.wt}{target.pos}{target.mut}</button>}
      </div>
      <section aria-label="Selected residue summary" className="lsr-panelbox">
          {!hasSelection ? (
            <div className="lsr-empty">Select a residue or substitution to inspect its scores and supporting records. Hover previews a residue; click keeps the selection.</div>
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
                      <div className="text-[11px] text-cs-text-muted">
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

                  {noRecord && !selectedAlt ? (
                    <div className="text-[12px] text-cs-text-secondary leading-snug">
                      <span className="font-semibold text-cs-text-primary">No score to read here.</span> dbNSFP has no missense record at residue {activeResIndex}, so
                      there is no REVEL, AlphaMissense or conservation score to show. That is absence of data, not a benign reading.
                      {isTarget && (variantScores.revel !== null || variantScores.alphaMissense !== null) && (
                        <span className="block font-mono text-[11px] text-cs-accent-clay mt-1.5">
                          ◆ this variant{variantScores.revel !== null ? ` REVEL ${variantScores.revel.toFixed(3)} · ${bandLabel("revel", variantScores.revel)}` : ""}
                          {variantScores.alphaMissense !== null ? ` AlphaMissense ${variantScores.alphaMissense.toFixed(3)} · ${bandLabel("alphaMissense", variantScores.alphaMissense)}` : ""}
                        </span>
                      )}
                    </div>
                  ) : activeRow || selectedAlt || (isTarget && (variantScores.revel !== null || variantScores.alphaMissense !== null)) ? (
                    <>

                      {verdict.mismatch && (
                        <details className="lsr-mismatch">
                          <summary>Score disagreement — read with caution</summary>
                          <p>{verdict.mismatch}</p>
                        </details>
                      )}
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
                          {verdict.scope}
                        </span>
                        {verdict.rank && (
                          <span className="lsr-scope">
                            Ranks {verdict.rank.rank} of {verdict.rank.of} scored substitutions here by AlphaMissense (1 = highest).
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] italic text-cs-text-muted">No residue scores are loaded for residue {activeResIndex}.</div>
                  )}

                  <LandscapeLocalContext context={overview?.data?.context ?? null}
                    features={analysisResult?.uniprotFeatures?.features}
                    position={activeResIndex} target={target} />
                </>
              )}
            </div>
          )}

      </section>

      {activeResIndex && activeRow && !noRecord && <section aria-label="Substitution scores" className="lsr-panelbox">
        <h4 className="lsr-section-title">Substitutions at {resSymbol}{activeResIndex}</h4>
        <p className="lsr-help">Select a letter to inspect that substitution. Filled = the substitution the reading above is on; clay outline = queried variant.</p>
            <div className="lsr-card flex flex-col gap-3">
              {toolBlock("revel")}
              {toolBlock("alphaMissense")}
              <div className="flex justify-between text-[10px] font-mono text-cs-text-secondary border-t border-cs-border-subtle pt-2">
                <span>GERP++ {activeRow.gerp !== null ? activeRow.gerp.toFixed(2) : "—"}</span>
                <span>phyloP {activeRow.phylop !== null ? activeRow.phylop.toFixed(2) : "—"}</span>
                <span className="text-cs-text-muted">{activeRow.nucleotideCount ?? 0} nt</span>
              </div>
            </div>
      </section>}

      <LandscapeMethods meta={meta} />
      <LandscapeDomainNavigation features={analysisResult?.uniprotFeatures?.features} onPick={(pos) => {
        setSelection({ key: extraKey, kind: "residue", pos });
        onSelectResidueIndex?.(pos);
      }} />
    </div>
  );
};

export default React.memo(LandscapeInspector);

import React, { useState, useMemo, useCallback, useRef, memo } from "react";
import { Dna, ExternalLink, ChevronDown, ChevronUp, Sparkles, Activity } from "lucide-react";
import type { AlphaGenomeRegionState } from "./useAlphaGenomeRegion";
import {
  AlphaGenomeSaturationPosition,
  AlphaGenomeSaturationVariant
} from "../../shared/contracts";
import { aviRankBand } from "../../shared/alphagenomeEvidence";
import { complementBase, displayBase } from "../../shared/landscapeEvidence";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { MAX_SATURATION_REGION_BP } from "../../shared/alphagenomeRegion";
import {
  DensityTrack,
  isDensityPoint,
  type DensityGuide
} from "./DensityTrack";

/** One clay ramp by rank decade (aviRankBand level 0–4). Tokens only; no red/green, no ACMG bands. */
const RANK_CELL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-cs-accent-clay/5 border-cs-border-subtle/40",
  1: "bg-cs-accent-clay/20 border-cs-accent-clay/20",
  2: "bg-cs-accent-clay/45 border-cs-accent-clay/40",
  3: "bg-cs-accent-clay/75 border-cs-accent-clay/70",
  4: "bg-cs-accent-clay border-cs-accent-clay"
};
const RANK_LEGEND: Array<{ level: 0 | 1 | 2 | 3 | 4; label: string }> = [
  { level: 4, label: "top 0.01%" },
  { level: 3, label: "top 0.1%" },
  { level: 2, label: "top 1%" },
  { level: 1, label: "top 10%" },
  { level: 0, label: "below" }
];

export interface GenomicSaturationHeatmapProps {
  /** Shared region query (useAlphaGenomeRegion); the focus grid's aligned lane reads the same one. */
  region: AlphaGenomeRegionState;
  genomicPos?: number | null;
  genomicAlt?: string | null;
  /** Starts collapsed under the redesigned tab, where the aligned lane carries the coding bases. */
  defaultExpanded?: boolean;
  mutationIndex: number;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  onResidueClick?: (index: number) => void;
  /** Shares hover with the residue grid: a codon's cells highlight their residue and back. */
  onResidueHover?: (index: number | null) => void;
  onSelectGenomicVariant?: (variantInfo: any) => void;
}

const NUCLEOTIDES: Array<"A" | "C" | "G" | "T"> = ["A", "C", "G", "T"];

/** Fixed Phred domain for the 1D density track so curves stay comparable across regions. */
const PHRED_DOMAIN = [0, 45] as const;
const COLUMN_WIDTH = 10;

type Base = "A" | "C" | "G" | "T";

interface SaturationCellProps {
  pos: number;
  /** Base as displayed (coding strand on a − strand gene). */
  base: Base;
  /** Genomic (+ strand) reference and alternate, as the variant is named. */
  refBase: Base;
  genomicAlt: Base;
  strandNote: string;
  phred: number | null;
  colorClass: string;
  isQueryVariant: boolean;
  isFocusable: boolean;
  chromLabel: string;
  onCellClick: (pos: number, base: Base) => void;
  onCellHover: (pos: number, base: Base) => void;
  onCellLeave: () => void;
}

/**
 * Memoized so grid-wide hover state (the quick-HUD) does not re-render every cell:
 * a 5,000 bp region renders 20,000 cells and hover fires on every mouse move.
 *
 * Only one cell is in the tab order at a time. Twenty thousand tab stops are not navigable,
 * so the group owns arrow-key movement and focus mirrors hover in the quick-HUD.
 */
const SaturationCell = memo(function SaturationCell({
  pos,
  base,
  refBase,
  genomicAlt,
  strandNote,
  phred,
  colorClass,
  isQueryVariant,
  isFocusable,
  chromLabel,
  onCellClick,
  onCellHover,
  onCellLeave
}: SaturationCellProps) {
  const isRef = genomicAlt === refBase;
  const label = isRef
    ? `Reference ${base} at ${chromLabel}:${pos}${strandNote}`
    : phred !== null
      ? `${chromLabel}:${pos} ${refBase}>${genomicAlt}${strandNote} · AVI Phred ${phred.toFixed(1)}, ${aviRankBand(phred)?.label ?? "no rank"} of all possible SNVs`
      : `${chromLabel}:${pos} ${refBase}>${genomicAlt}${strandNote} · no score returned`;

  return (
    <button
      type="button"
      data-pos={pos}
      data-base={base}
      tabIndex={isFocusable ? 0 : -1}
      onClick={() => onCellClick(pos, base)}
      onMouseEnter={() => onCellHover(pos, base)}
      onMouseLeave={onCellLeave}
      onFocus={() => onCellHover(pos, base)}
      onBlur={onCellLeave}
      className={`w-[10px] h-6 shrink-0 flex items-center justify-center font-mono text-[9px] border rounded-[2px] transition-all cursor-pointer ${colorClass} ${
        isQueryVariant
          ? "ring-2 ring-cs-text-primary z-10"
          : isRef
            ? "opacity-50 hover:opacity-100 focus-visible:opacity-100"
            : "hover:scale-115 hover:z-20 hover:ring-1 hover:ring-cs-accent-clay"
      } focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-cs-accent-clay focus-visible:outline-none`}
      title={label}
      aria-label={label}
    >
      {isRef ? "·" : ""}
    </button>
  );
});

interface RefBaseCellProps {
  pos: number;
  refBase: string;
  isExonic: boolean;
  chromLabel: string;
}

/** Memoized for the same reason as SaturationCell: 5,000 of these rebuild on every hover. */
const RefBaseCell = memo(function RefBaseCell({ pos, refBase, isExonic, chromLabel }: RefBaseCellProps) {
  // `refBase` arrives already on the displayed strand.
  return (
    <div
      className={`w-[10px] h-4 shrink-0 flex items-center justify-center font-mono text-[9px] font-bold ${
        isExonic ? "text-cs-text-primary" : "text-cs-text-muted/60 bg-cs-bg-subtle/50"
      }`}
      title={`Genomic Pos: ${chromLabel}:${pos} | Ref: ${refBase}${isExonic ? " (Exonic)" : " (Intronic/Flank)"}`}
    >
      {refBase}
    </div>
  );
});

interface CodonBracketProps {
  pos: number;
  codonIndex: number | null;
  codonPosition: number | null;
  isExonic: boolean;
  isTarget: boolean;
  isSelected: boolean;
  isHovered: boolean;
}

const CodonBracket = memo(function CodonBracket({
  pos,
  codonIndex,
  codonPosition,
  isExonic,
  isTarget,
  isSelected,
  isHovered
}: CodonBracketProps) {
  const isFirstInCodon = isExonic ? codonPosition === 1 : false;
  return (
    <div
      className={`w-[10px] shrink-0 h-3 flex items-end justify-center border-b ${
        isTarget
          ? "border-cs-warn border-b-2"
          : isSelected
            ? "border-cs-accent-clay border-b-2"
            : isHovered
              ? "border-cs-text-primary"
              : "border-cs-border-subtle"
      } ${isFirstInCodon ? "border-l border-cs-border/60" : ""}`}
      title={`Genomic Pos: ${pos} | Codon: ${codonIndex || "Flank"} Pos: ${codonPosition || "-"}`}
    >
      {isFirstInCodon && codonIndex ? (
        <span className="text-[9px] font-mono font-bold text-cs-text-muted -translate-y-1">
          {codonIndex}
        </span>
      ) : null}
    </div>
  );
});

export const GenomicSaturationHeatmap = memo(function GenomicSaturationHeatmap({
  region,
  genomicPos,
  genomicAlt,
  defaultExpanded = true,
  mutationIndex,
  residueIndex,
  hoveredResidueIndex,
  onResidueClick,
  onResidueHover,
  onSelectGenomicVariant
}: GenomicSaturationHeatmapProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const regionParams = region.params;
  const data = region.data;
  const error = region.error;
  const [hoveredCell, setHoveredCell] = useState<{
    pos: number;
    ref: string;
    alt: string;
    variant: AlphaGenomeSaturationVariant | null;
    codonIndex: number | null;
  } | null>(null);

  // Shade by rank decade on one clay ramp. The AVI has no ClinGen calibration, so this grid draws
  // no PP3/BP4 colours: it used to paint Phred ≥ 35 / 25 / 15 as PP3 Strong / Moderate / Supporting
  // and ≤ 8 / 5 as BP4, while the AlphaGenome tab said the score counts toward no criterion.
  const getCellColor = (phred: number | null | undefined, isRef: boolean): string => {
    if (isRef) {
      return "bg-cs-surface-2 text-cs-text-muted/60 border-cs-border-subtle/40";
    }
    const band = aviRankBand(phred);
    if (!band) {
      return "bg-cs-bg-subtle text-cs-text-muted/40 border-cs-border-subtle/30";
    }
    return RANK_CELL_CLASS[band.level];
  };

  const positions = data?.positions || [];
  const hasPositions = positions.length > 0;
  const isReverseStrand = regionParams?.strand === "-";
  const strand = (regionParams?.strand ?? null) as "+" | "-" | null;
  /*
   * On a − strand gene the columns run in transcript order AND the bases are complemented, so the
   * reference row reads as codons (GAT for Asp) and each substitution row is a coding-strand base.
   * Reversing without complementing, as before, showed the complement of the coding sequence.
   */
  const toGenomic = (displayed: Base): Base => (isReverseStrand ? (complementBase(displayed) as Base) : displayed);
  const strandNote = isReverseStrand ? " (genomic + strand; shown complemented on the − coding strand)" : "";
  // A request is in flight, or this is the frame between an interval resolving and its effect
  // starting. Showing the empty state there would describe an answered query that has not been.
  const pending = region.pending;

  // Ordered positions according to transcription orientation
  const orderedPositions = useMemo(() => {
    if (!hasPositions) return [];
    const copy = [...positions];
    if (isReverseStrand) {
      copy.sort((a, b) => b.pos - a.pos);
    } else {
      copy.sort((a, b) => a.pos - b.pos);
    }
    return copy;
  }, [positions, isReverseStrand, hasPositions]);

  // DeepMind Atlas link URL
  const atlasUrl = useMemo(() => {
    if (data?.atlasLocusUrl) return data.atlasLocusUrl;
    if (!regionParams) return "https://deepmind.google.com/science/alphagenome";
    const chromStr = regionParams.chrom.startsWith("chr") ? regionParams.chrom : `chr${regionParams.chrom}`;
    return `https://deepmind.google.com/science/alphagenome/atlas/locus?interval=${encodeURIComponent(chromStr)}%3A${regionParams.start}-${regionParams.end}`;
  }, [data, regionParams]);

  // Stable pos/base handlers keep SaturationCell memoization effective: closures capturing
  // posData objects would give every cell fresh props on each render.
  const positionByPos = useMemo(() => {
    const map = new Map<number, AlphaGenomeSaturationPosition>();
    for (const p of orderedPositions) map.set(p.pos, p);
    return map;
  }, [orderedPositions]);

  const handleCellClick = useCallback((pos: number, shown: Base) => {
    const posData = positionByPos.get(pos);
    if (!posData) return;
    const base = toGenomic(shown);
    const variant = base === posData.ref ? null : posData.variants[base] || null;
    if (posData.codonIndex && onResidueClick) {
      onResidueClick(posData.codonIndex);
    }
    if (onSelectGenomicVariant) {
      onSelectGenomicVariant({
        chrom: regionParams?.chrom,
        pos: posData.pos,
        ref: posData.ref,
        alt: base,
        isRef: base === posData.ref,
        phred: variant?.phred ?? null,
        rankBand: aviRankBand(variant?.phred)?.label ?? null,
        topModality: variant?.topModality ?? posData.topModality ?? null,
        codonIndex: posData.codonIndex,
        codonPosition: posData.codonPosition,
        isExonic: posData.isExonic,
        strand
      });
    }
    // toGenomic depends only on the strand, which regionParams carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionByPos, onResidueClick, onSelectGenomicVariant, regionParams]);

  const handleCellHover = useCallback((pos: number, shown: Base) => {
    const posData = positionByPos.get(pos);
    if (!posData) return;
    const base = toGenomic(shown);
    setHoveredCell({
      pos,
      ref: posData.ref,
      alt: base,
      variant: base === posData.ref ? null : posData.variants[base] || null,
      codonIndex: posData.codonIndex ?? null
    });
    onResidueHover?.(posData.codonIndex ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionByPos, onResidueHover, isReverseStrand]);

  const handleCellLeave = useCallback(() => {
    setHoveredCell(null);
    onResidueHover?.(null);
  }, [onResidueHover]);

  const hoveredCodonIndex = hoveredCell?.codonIndex ?? null;

  /*
   * Roving tabindex. The grid can hold 20,000 buttons; as tab stops that is unnavigable, and as
   * a fully untabbable set that is unreachable. One cell stays in the tab order and arrow keys
   * move it, which also gives the hover-only quick-HUD a keyboard path.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [rovingCell, setRovingCell] = useState<{ pos: number; base: Base } | null>(null);

  const activeCell = useMemo(() => {
    if (rovingCell && positionByPos.has(rovingCell.pos)) return rovingCell;
    const fallbackPos =
      orderedPositions.find((p) => p.pos === genomicPos)?.pos ?? orderedPositions[0]?.pos ?? null;
    return fallbackPos !== null ? { pos: fallbackPos, base: "A" as Base } : null;
  }, [rovingCell, positionByPos, orderedPositions, genomicPos]);

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activeCell) return;
      const column = orderedPositions.findIndex((p) => p.pos === activeCell.pos);
      const row = NUCLEOTIDES.indexOf(activeCell.base);
      if (column < 0 || row < 0) return;

      let nextColumn = column;
      let nextRow = row;
      switch (event.key) {
        case "ArrowLeft":
          nextColumn = Math.max(0, column - 1);
          break;
        case "ArrowRight":
          nextColumn = Math.min(orderedPositions.length - 1, column + 1);
          break;
        case "ArrowUp":
          nextRow = Math.max(0, row - 1);
          break;
        case "ArrowDown":
          nextRow = Math.min(NUCLEOTIDES.length - 1, row + 1);
          break;
        case "Home":
          nextColumn = 0;
          break;
        case "End":
          nextColumn = orderedPositions.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();

      const target = orderedPositions[nextColumn];
      const targetBase = NUCLEOTIDES[nextRow];
      if (!target || !targetBase) return;
      setRovingCell({ pos: target.pos, base: targetBase });
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-pos="${target.pos}"][data-base="${targetBase}"]`)
        ?.focus();
    },
    [activeCell, orderedPositions]
  );

  // One point per genomic position: the highest rank among its three substitutions. A mean of
  // Phred values is a mean of log-ranks and has no reading, so the track does not offer one. A
  // position without a score stays a gap; substituting 0 would plot an invented measurement.
  const densityPoints = useMemo(
    () => orderedPositions.map((p) => (isDensityPoint(p.maxPhred) ? Math.max(0, p.maxPhred) : null)),
    [orderedPositions]
  );

  // Guides at the rank decades — the Phred definition itself (10 = top 10%, 20 = top 1%), not
  // evidence thresholds.
  const densityGuides: DensityGuide[] = [
    { value: 10, color: "var(--cs-border)", label: "top 10%" },
    { value: 20, color: "var(--cs-text-muted)", label: "top 1%" },
    { value: 30, color: "var(--cs-accent-clay)", label: "top 0.1%" }
  ];

  const densitySummary = `AlphaGenome AVI rank across ${orderedPositions.length} genomic positions, highest Phred per position. Scale 0 to 45 Phred. Reference lines at the top 10%, 1% and 0.1% of all possible SNVs. Positions with no returned score are left as gaps.`;

  // Spoken once for the whole grid, so a screen-reader gets the shape of the region without
  // traversing twenty thousand cells.
  const tierSummary = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    let scored = 0;
    for (const position of orderedPositions) {
      for (const base of NUCLEOTIDES) {
        if (base === position.ref) continue;
        const band = aviRankBand(position.variants[base]?.phred);
        if (!band) continue;
        scored += 1;
        counts[band.level] += 1;
      }
    }
    return `${scored} substitutions scored: ${counts[4] + counts[3]} in the top 0.1% of all possible SNVs, ${counts[2]} more in the top 1%, ${counts[1]} more in the top 10%.`;
  }, [orderedPositions]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-cs-border-subtle bg-cs-surface-2 p-3 transition-colors mt-2">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2 border-b border-cs-border-subtle/80">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-xs font-semibold text-cs-text-primary">
                AlphaGenome variant-effect rank, every SNV in the exon
              </h4>
              {regionParams && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-cs-accent-clay">
                  chr{regionParams.chrom}:{regionParams.start.toLocaleString()}–{regionParams.end.toLocaleString()}
                  {regionParams.strand ? ` (${regionParams.strand})` : ""}
                </span>
              )}
              {regionParams && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border-subtle text-cs-text-secondary"
                  title={isReverseStrand ? "Gene on the − strand: columns run 5′→3′ along the transcript and bases are complemented, so codons read as in the mRNA. Tooltips and the Inspector name the genomic (+ strand) change." : "Bases shown on the + strand, which is the coding strand for this gene."}
                >
                  {isReverseStrand ? "coding strand (−), complemented" : "coding strand (+)"}
                </span>
              )}
              {regionParams?.exonNumber && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border-subtle text-cs-text-muted">
                  {regionParams.clamped
                    ? `Exon ${regionParams.exonNumber} (partly shown)`
                    : `Exon ${regionParams.exonNumber} (±15bp Splice Flank)`}
                </span>
              )}
              {regionParams?.clamped && (
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cs-warn-soft border border-cs-warn/30 text-cs-warn"
                  title="Exon exceeds the 5,000 bp saturation window; region clamped around the query variant"
                >
                  Window clamped to {MAX_SATURATION_REGION_BP.toLocaleString()} bp
                </span>
              )}
            </div>
            <p className="text-[11px] text-cs-text-muted mt-0.5">
              Each cell is one possible SNV, shaded by its genome-wide rank on AlphaGenome's composite AVI score
              (Phred 10 = top 10%, 20 = top 1%). A rank, not a probability and not an ACMG band; AlphaMissense is one of
              the AVI's inputs, so these ranks are not independent evidence from AlphaMissense. Columns are nucleotides, not
              residues: hover or select a cell to inspect its mapped residue.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <a
            href={atlasUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono text-cs-accent-clay hover:underline px-2 py-1 rounded bg-cs-surface border border-cs-border transition"
            title="Open exact locus interval in Google DeepMind AlphaGenome Atlas"
          >
            <span>DeepMind Atlas</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded text-cs-text-muted hover:text-cs-text-primary hover:bg-cs-surface transition cursor-pointer"
            title={isExpanded ? "Collapse Saturation Heatmap" : "Expand Saturation Heatmap"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {pending ? (
            <div className="h-32 flex flex-col items-center justify-center text-xs text-cs-text-muted gap-2">
              <div className="w-5 h-5 border-2 border-cs-accent-clay border-t-transparent rounded-full animate-spin"></div>
              <span>Querying AlphaGenome saturation mutagenesis & 1D intolerance profile...</span>
            </div>
          ) : error ? (
            /* Network / Server Error State */
            <div className="p-4 rounded-lg border border-cs-danger/30 bg-cs-danger-soft text-center flex flex-col items-center justify-center gap-2" role="alert">
              <div className="text-xs font-semibold text-cs-danger">
                AlphaGenome Regional Saturation Unavailable
              </div>
              <p className="text-[11px] text-cs-text-muted">
                {error}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={region.reload}
                  className="px-2.5 py-1 rounded bg-cs-surface border border-cs-border hover:bg-cs-surface-2 text-cs-text-primary text-[11px] font-mono transition cursor-pointer"
                >
                  Retry Query
                </button>
                <a
                  href={atlasUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-cs-accent-clay hover:underline px-2.5 py-1 rounded bg-cs-surface border border-cs-border transition"
                >
                  <span>Open in DeepMind Atlas</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : !regionParams ? (
            /*
              * No interval could be built, so no request was issued. This is not the same absence as
              * an answered query with zero positions, and reporting it as one would claim a server
              * response that never happened.
              */
            <div className="p-4 rounded-lg border border-dashed border-cs-border-subtle bg-cs-surface text-center flex flex-col items-center justify-center gap-2">
              <Dna className="w-6 h-6 text-cs-accent-clay/60 stroke-[1.5]" />
              <div className="text-xs font-semibold text-cs-text-primary">
                No genomic interval for this variant
              </div>
              <p className="text-[11px] text-cs-text-muted">
                Saturation is queried by genomic window, and neither a chromosome coordinate nor an exon
                interval was resolved for this variant, so no region request was issued.
              </p>
            </div>
          ) : !hasPositions ? (
            /*
              * No positions came back. The heading previously read "… Standby" and the body asserted
              * that queries "require an active AlphaGenome service connection" — a credential/transport
              * cause this code never establishes. The region-saturation route records no build refusal
              * and no credential check, so an empty region can mean a provider fault, an unsupported
              * window, or an unindexed locus, and naming one of those is a guess. Render the server's
              * own message when it sent one; say nothing was recorded when it did not.
              */
            <div className="p-4 rounded-lg border border-dashed border-cs-border-subtle bg-cs-surface text-center flex flex-col items-center justify-center gap-2">
              <Activity className="w-6 h-6 text-cs-accent-clay/60 stroke-[1.5]" />
              <div className="text-xs font-semibold text-cs-text-primary">
                {`Regional saturation — ${ENGINE_STATE_LABELS["no-result"]}`}
              </div>
              <p className="text-[11px] text-cs-text-muted">
                {data?.message ||
                  "No saturation profile was returned for this region, and no cause was recorded for the absence. Under the strict no-heuristics protocol no scores are synthesised in its place. The live Atlas locus viewer below shows the underlying tracks:"}
              </p>
              <a
                href={atlasUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cs-accent-clay text-white font-mono text-xs font-semibold hover:opacity-90 transition"
              >
                <span>Explore Locus in DeepMind AlphaGenome Atlas</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          ) : (
            /* Active Live Visualizer Stack */
            <div className="flex flex-col gap-2 w-full overflow-x-auto pb-2 scrollbar-thin">
              <div className="min-w-fit flex flex-col">
                
                {/* 1D Density Track — the same component the residue panel renders */}
                {densityPoints.length > 0 && (
                  <DensityTrack
                    series={[
                      {
                        key: "phred",
                        name: "AlphaGenome max Phred",
                        color: "var(--cs-accent-clay)",
                        points: densityPoints
                      }
                    ]}
                    guides={densityGuides}
                    columnWidth={COLUMN_WIDTH}
                    domain={PHRED_DOMAIN}
                    unitLabel="Phred 0–45"
                    modeLabel="MAX RANK"
                    ariaLabel={densitySummary}
                    emptyNotice="No Phred values were returned for this region"
                  />
                )}

                {/* Triplet Codon Bracket Indicators */}
                <div className="flex items-center pl-2 h-4 mb-0.5">
                  <div className="w-[68px] text-[9px] font-mono text-cs-text-muted pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                    CODON
                  </div>
                  <div className="flex">
                    {orderedPositions.map((p) => (
                      <CodonBracket
                        key={`bracket-${p.pos}`}
                        pos={p.pos}
                        codonIndex={p.codonIndex ?? null}
                        codonPosition={p.codonPosition ?? null}
                        isExonic={p.isExonic}
                        isTarget={p.codonIndex === mutationIndex}
                        isSelected={p.codonIndex === residueIndex}
                        isHovered={
                          p.codonIndex !== null &&
                          (p.codonIndex === hoveredResidueIndex || p.codonIndex === hoveredCodonIndex)
                        }
                      />
                    ))}
                  </div>
                </div>

                {/* 4-Row Saturation Grid (A, C, G, T) */}
                <div
                  ref={gridRef}
                  role="group"
                  aria-label={`Saturation grid, ${orderedPositions.length} positions by 4 bases on the ${isReverseStrand ? "minus, complemented" : "plus"} strand. ${tierSummary} Arrow keys move between substitutions; Enter pins the variant in the inspector.`}
                  onKeyDown={handleGridKeyDown}
                >
                  {NUCLEOTIDES.map((base) => (
                    <div key={base} className="flex items-center pl-2 mb-0.5">
                      <span className="w-[68px] text-[9px] font-bold font-mono text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                        {base}
                      </span>
                      <div className="flex">
                        {orderedPositions.map((posData) => {
                          const gAlt = toGenomic(base);
                          const isRef = posData.ref === gAlt;
                          const variant = isRef ? null : posData.variants[gAlt] || null;
                          const phred = variant?.phred ?? null;
                          const isTargetPos = genomicPos !== null && genomicPos !== undefined && posData.pos === genomicPos;
                          const isQueryVariant = isTargetPos && Boolean(genomicAlt && gAlt === genomicAlt.toUpperCase());

                          return (
                            <SaturationCell
                              key={`${posData.pos}-${base}`}
                              pos={posData.pos}
                              base={base}
                              refBase={posData.ref}
                              genomicAlt={gAlt}
                              strandNote={strandNote}
                              phred={phred}
                              colorClass={getCellColor(phred, isRef)}
                              isQueryVariant={isQueryVariant}
                              isFocusable={Boolean(
                                activeCell && activeCell.pos === posData.pos && activeCell.base === base
                              )}
                              chromLabel={`chr${regionParams?.chrom}`}
                              onCellClick={handleCellClick}
                              onCellHover={handleCellHover}
                              onCellLeave={handleCellLeave}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Reference Genomic Sequence Row */}
                <div className="flex items-center pl-2 mt-1">
                  <span className="w-[68px] text-[9px] font-semibold text-cs-text-secondary pr-2 shrink-0 select-none uppercase tracking-wider text-right">
                    {isReverseStrand ? "REF (−)" : "REF (+)"}
                  </span>
                  <div className="flex" aria-hidden="true">
                    {orderedPositions.map((posData) => (
                      <RefBaseCell
                        key={`ref-${posData.pos}`}
                        pos={posData.pos}
                        refBase={displayBase(posData.ref, strand)}
                        isExonic={Boolean(posData.isExonic)}
                        chromLabel={`chr${regionParams?.chrom}`}
                      />
                    ))}
                  </div>
                </div>

              </div>

              {/* Hover Inspection Quick-HUD */}
              {hoveredCell && (
                <div className="mt-2 p-2 rounded-lg border border-cs-border bg-cs-surface flex items-center justify-between text-[10.5px] font-mono gap-4 animate-fade-in">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-cs-text-primary">
                      chr{regionParams?.chrom}:{hoveredCell.pos} {hoveredCell.ref}&gt;{hoveredCell.alt}
                      {isReverseStrand && hoveredCell.ref !== hoveredCell.alt && (
                        <span className="font-normal text-cs-text-muted">
                          {" "}(coding {complementBase(hoveredCell.ref)}&gt;{complementBase(hoveredCell.alt)})
                        </span>
                      )}
                    </span>
                    {hoveredCell.ref === hoveredCell.alt ? (
                      <span className="px-1.5 py-0.5 rounded bg-cs-surface-2 border border-cs-border text-cs-text-muted text-[9px]">
                        Reference Nucleotide
                      </span>
                    ) : (
                      <>
                        <span className="px-1.5 py-0.5 rounded bg-cs-accent-clay/10 text-cs-accent-clay border border-cs-accent-clay/20 font-bold">
                          AVI Phred: {hoveredCell.variant?.phred !== null && hoveredCell.variant?.phred !== undefined ? hoveredCell.variant.phred.toFixed(2) : "N/A"}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-[9px]">
                          Rank: {aviRankBand(hoveredCell.variant?.phred)?.label ?? "no score"}
                        </span>
                        {hoveredCell.variant?.topModality && (
                          <span className="px-1.5 py-0.5 rounded bg-cs-surface border border-cs-border text-cs-text-secondary text-[9px]">
                            Modality: {hoveredCell.variant.topModality}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {hoveredCell.codonIndex && (
                    <span className="text-cs-text-muted text-[9.5px]">
                      Codon Residue #{hoveredCell.codonIndex}
                    </span>
                  )}
                </div>
              )}

              {/* Rank legend: decades of the genome-wide rank, not ACMG bands */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-cs-border-subtle/60 text-[9px] font-mono text-cs-text-muted flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="font-bold uppercase tracking-wider text-cs-text-secondary">Genome-wide rank:</span>
                  {RANK_LEGEND.map(item => (
                    <div key={item.label} className="flex items-center gap-1">
                      <span className={`w-2.5 h-2.5 rounded border ${RANK_CELL_CLASS[item.level]}`}></span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                  <span>· not an ACMG band</span>
                </div>

                <span className="text-[10px] italic text-cs-text-muted">
                  Click any substitution to pin telemetry in the Inspector
                </span>
              </div>

            </div>
          )}
        </>
      )}
    </div>
  );
});

export default GenomicSaturationHeatmap;

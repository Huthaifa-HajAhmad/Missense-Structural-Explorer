import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { Dna, AlertTriangle, Crosshair } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useProteinSequence } from "../hooks/useProteinSequence";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useApiClient } from "../apiClient";
import { parseGenomicCoordinateString, type LandscapeMeta, type LandscapeResidueItem } from "../shared/contracts";
import { landscapeFinding, provenanceLine, type SummaryMode } from "../shared/landscapeEvidence";
import { AMINO_ACID_MAP_3_TO_1 } from "./sequence/sequenceConstants";
import { SequenceRowGrid } from "./sequence/SequenceRowGrid";
import { LandscapeLegend } from "./sequence/LandscapeLegend";
import { GenomicSaturationHeatmap } from "./sequence/GenomicSaturationHeatmap";
import type { DomainSpan, TargetMutation, VariantScores } from "./sequence/types";

interface SequenceVisualizerProps {
  uniprotId: string;
  gene?: string | null;
  variant: string;
  residueIndex: number | null;
  hoveredResidueIndex?: number | null;
  onResidueClick?: (index: number) => void;
  predictorData?: any;
  conservationData?: any;
  landscapeData?: LandscapeResidueItem[] | null;
  landscapeMeta?: LandscapeMeta | null;
  uniprotFeatures?: Array<{ type?: string; description?: string; start: number; end: number }> | null;
  metricMode?: SummaryMode;
  windowSize?: number;
}

/** Scores are fetched this far either side of the window centre when the reader navigates. */
const FETCH_HALF_SPAN = 30;

const ACIDIC = new Set(["D", "E"]);
const BASIC = new Set(["K", "R", "H"]);
const POLAR = new Set(["S", "T", "N", "Q"]);
const AROMATIC = new Set(["F", "W", "Y"]);
const SPECIAL = new Set(["G", "P", "C"]);
const HYDROPHOBIC = new Set(["A", "V", "L", "I", "M", "F", "W", "C"]);

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** p.Arg215Trp / p.R215W → target; anything else falls back to the app-resolved residue. */
export function parseTargetMutation(variant: string, resolvedResidue: number | null): TargetMutation {
  const clean = variant.replace(/^p\./i, "");
  const m3 = clean.match(/^([a-zA-Z]{3})(\d+)([a-zA-Z]{3})$/);
  if (m3) {
    const wt3 = m3[1].toUpperCase();
    const mut3 = m3[3].toUpperCase();
    return {
      wt: AMINO_ACID_MAP_3_TO_1[wt3] || wt3.charAt(0),
      pos: parseInt(m3[2], 10),
      mut: AMINO_ACID_MAP_3_TO_1[mut3] || mut3.charAt(0)
    };
  }
  const m1 = clean.match(/^([a-zA-Z])(\d+)([a-zA-Z])$/);
  if (m1) return { wt: m1[1].toUpperCase(), pos: parseInt(m1[2], 10), mut: m1[3].toUpperCase() };
  // Genomic/cDNA notation carries no residue token; stripping digits from "20-23369727-C-T" would
  // give a nonsense position, so use the resolved residue and mark the target unknown (0) otherwise.
  return { wt: "", pos: resolvedResidue && resolvedResidue > 0 ? resolvedResidue : 0, mut: "" };
}

/** The residue range a window of `size` centred on `center` covers inside a protein of `length`. */
export function windowRange(center: number, size: number, length: number): { start: number; end: number } {
  if (length <= 0) return { start: 1, end: 0 };
  const half = Math.floor(size / 2);
  const c = center > 0 ? Math.min(center, length) : Math.ceil(length / 2);
  let start = Math.max(1, c - half);
  const end = Math.min(length, start + size - 1);
  if (end - start + 1 < size) start = Math.max(1, end - size + 1);
  return { start, end };
}

const SequenceVisualizer = memo(function SequenceVisualizer({
  uniprotId,
  gene,
  variant,
  residueIndex,
  hoveredResidueIndex: hoveredResidueIndexProp,
  onResidueClick,
  predictorData,
  conservationData,
  landscapeData,
  landscapeMeta,
  uniprotFeatures,
  metricMode = "mean",
  windowSize = 31
}: SequenceVisualizerProps) {
  const { settings } = useSettings();
  const { apiClient } = useApiClient();
  const storeHoveredIndex = useVariantAnalysisStore((s) => s.hoveredResidueIndex);
  const hoveredResidueIndex = hoveredResidueIndexProp !== undefined ? hoveredResidueIndexProp : storeHoveredIndex;
  const seqColorScheme = settings.seqColorScheme;

  const { sequence, isLoading: sequenceLoading, error: sequenceError } = useProteinSequence(uniprotId);
  const mutation = useMemo(() => parseTargetMutation(variant, residueIndex), [variant, residueIndex]);
  const targetPos = mutation.pos;

  /*
   * Window centre. It starts on the queried residue and moves only when the reader selects a residue
   * outside the window (a domain jump, a codon click in the genomic grid), so clicking inside the
   * window does not scroll the grid under the pointer.
   */
  const [center, setCenter] = useState<number>(targetPos);
  useEffect(() => setCenter(targetPos), [targetPos, variant]);
  const range = useMemo(() => windowRange(center, windowSize, sequence.length), [center, windowSize, sequence.length]);
  useEffect(() => {
    if (residueIndex && residueIndex > 0 && (residueIndex < range.start || residueIndex > range.end)) {
      setCenter(residueIndex);
    }
    // Only a new selection may move the window; a window change must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [residueIndex]);

  const wildWindow = useMemo(
    () => (sequence ? sequence.slice(range.start - 1, range.end).split("") : []),
    [sequence, range.start, range.end]
  );

  /*
   * Scores for windows the reader navigates to. The pipeline loads ±25 around the variant; a jump
   * outside that loads the new window once and merges it.
   */
  const extraKey = `${gene ?? ""}|${variant}`;
  const extraRows = useVariantAnalysisStore((s) => (s.landscapeExtra?.key === extraKey ? s.landscapeExtra.rows : null));
  const addLandscapeRows = useVariantAnalysisStore((s) => s.addLandscapeRows);
  const [extraLoading, setExtraLoading] = useState(false);
  const requested = useRef<Set<string>>(new Set());
  useEffect(() => {
    requested.current = new Set();
  }, [extraKey]);

  const landscapeMap = useMemo(() => {
    const map = new Map<number, LandscapeResidueItem>();
    for (const item of [...(landscapeData ?? []), ...(extraRows ?? [])]) {
      if (item && typeof item.residx === "number") map.set(item.residx, item);
    }
    return map;
  }, [landscapeData, extraRows]);

  useEffect(() => {
    if (!gene || !uniprotId || !variant || !landscapeData || wildWindow.length === 0) return;
    let missing = false;
    for (let p = range.start; p <= range.end; p++) {
      if (!landscapeMap.has(p)) {
        missing = true;
        break;
      }
    }
    if (!missing) return;
    const start = Math.max(1, center - FETCH_HALF_SPAN);
    const end = Math.min(sequence.length, center + FETCH_HALF_SPAN);
    const key = `${start}-${end}`;
    if (requested.current.has(key)) return;
    requested.current.add(key);
    const controller = new AbortController();
    setExtraLoading(true);
    apiClient
      .getLandscapeData({ gene, uniprotId, variant, landscapeWindow: { start, end } }, controller.signal)
      .then((res) => addLandscapeRows(extraKey, res.landscapeData ?? []))
      .catch((err: any) => {
        // Forget the request so a later visit (or a re-run after an abort) asks again.
        requested.current.delete(key);
        if (err?.name !== "AbortError") console.warn("[Landscape] window fetch failed:", err);
      })
      .finally(() => setExtraLoading(false));
    return () => controller.abort();
  }, [gene, uniprotId, variant, landscapeData, landscapeMap, range.start, range.end, center, sequence.length, wildWindow.length, apiClient, addLandscapeRows, extraKey]);

  const residueClass = useCallback(
    (res: string) => {
      if (seqColorScheme === "minimal") return "hydrophobic";
      if (seqColorScheme === "hydrophobic") return HYDROPHOBIC.has(res) ? "basic" : "muted";
      if (ACIDIC.has(res)) return "acidic";
      if (BASIC.has(res)) return "basic";
      if (POLAR.has(res)) return "polar";
      if (AROMATIC.has(res)) return "aromatic";
      if (SPECIAL.has(res)) return "special";
      return "hydrophobic";
    },
    [seqColorScheme]
  );

  const setHovered = useVariantAnalysisStore((s) => s.setHoveredResidueIndex);
  const onResidueHover = useCallback((pos: number | null) => setHovered(pos), [setHovered]);

  const variantScores: VariantScores = useMemo(
    () => ({
      revel: finiteOrNull(conservationData?.revel),
      am: finiteOrNull(predictorData?.amPathogenicity),
      gerp: finiteOrNull(conservationData?.gerp),
      phylop: finiteOrNull(conservationData?.phylop)
    }),
    [conservationData?.revel, conservationData?.gerp, conservationData?.phylop, predictorData?.amPathogenicity]
  );

  const domains: DomainSpan[] = useMemo(
    () =>
      (uniprotFeatures ?? [])
        .filter((f) => (f.type === "DOMAIN" || f.type === "REGION") && Number.isFinite(f.start) && Number.isFinite(f.end))
        .map((f) => ({ name: f.description || f.type || "Region", start: f.start, end: f.end })),
    [uniprotFeatures]
  );

  const finding = useMemo(
    () =>
      landscapeFinding({
        rows: [...landscapeMap.values()],
        window: range,
        target: targetPos > 0 ? mutation : null,
        variantRevel: variantScores.revel,
        variantAm: variantScores.am,
        mode: metricMode,
        meta: landscapeMeta
      }),
    [landscapeMap, range, targetPos, mutation, variantScores.revel, variantScores.am, metricMode, landscapeMeta]
  );

  const parsedGenomic = useMemo(
    () => parseGenomicCoordinateString(predictorData?.gnomadVariantId || variant),
    [predictorData?.gnomadVariantId, variant]
  );

  const handleSelectGenomicVariant = useCallback((v: any) => {
    useVariantAnalysisStore.getState().setSelectedGenomicVariant(v);
  }, []);

  const hasSequence = sequence.length > 0;
  /*
   * The hook starts idle and only flips to loading inside its effect, so the first frame after a
   * new accession is neither loading nor loaded. Until a load has been seen, treat that as loading
   * rather than flashing the failure notice.
   */
  const sawLoad = useRef<string | null>(null);
  if (sequenceLoading) sawLoad.current = uniprotId;
  const pendingSequence = sequenceLoading || (!hasSequence && !sequenceError && sawLoad.current !== uniprotId);
  const awayFromTarget = targetPos > 0 && (targetPos < range.start || targetPos > range.end);

  return (
    <div id="sequence-alignment-visualizer" className="flex flex-col gap-4 animate-fade-in text-cs-text-primary w-full p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-cs-border-subtle">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
            <Dna className="w-4 h-4 text-cs-accent-clay" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-cs-text-primary">Residue landscape</h3>
            <p className="text-xs mt-0.5 text-cs-text-muted">
              {targetPos > 0
                ? `REVEL, AlphaMissense and conservation per residue around ${mutation.wt}${targetPos}${mutation.mut}`
                : "REVEL, AlphaMissense and conservation per residue"}
            </p>
          </div>
        </div>
        {awayFromTarget && (
          <button
            type="button"
            onClick={() => setCenter(targetPos)}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-cs-border bg-cs-surface text-cs-text-primary hover:border-cs-accent-clay cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 text-cs-accent-clay" />
            Back to residue {targetPos}
          </button>
        )}
      </div>

      {!uniprotId ? (
        <div className="text-center py-12 text-cs-text-muted text-sm">
          Run an analysis to see the residue landscape around the variant.
        </div>
      ) : pendingSequence ? (
        <div className="h-28 flex flex-col items-center justify-center text-cs-text-muted text-xs gap-2" role="status">
          <div className="w-5 h-5 border-2 border-cs-accent-clay border-t-transparent rounded-full animate-spin" />
          <span>Loading the UniProt sequence for {uniprotId}…</span>
        </div>
      ) : !hasSequence ? (
        <div className="p-4 rounded-lg border border-cs-danger/30 bg-cs-danger-soft text-sm text-cs-text-primary flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 text-cs-danger shrink-0 mt-0.5" />
          <span>
            The UniProt sequence for {uniprotId} could not be loaded{sequenceError ? ` (${sequenceError})` : ""}, so residues
            cannot be laid out. Scores are not shown without the sequence they belong to.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <section className="ls-finding" aria-label="Landscape finding">
            <div className="ls-finding__head">
              <span className="font-semibold uppercase tracking-wider text-[10px]">Finding · residues {range.start}–{range.end}</span>
              <span className="font-mono text-[10px] text-cs-text-muted truncate">{provenanceLine(landscapeMeta)}</span>
            </div>
            <div className="ls-finding__body">
              {!landscapeData ? (
                <span className="text-cs-text-muted">Loading residue scores…</span>
              ) : (
                <>
                  {finding.variant && <span className="font-semibold">{finding.variant}</span>}
                  <span>{finding.window}</span>
                  {finding.cautions.map((c) => (
                    <span key={c} className="ls-finding__caution flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {c}
                    </span>
                  ))}
                </>
              )}
            </div>
          </section>

          <SequenceRowGrid
            wildWindow={wildWindow}
            relativeStartIndex={range.start}
            mutation={mutation}
            residueIndex={residueIndex}
            hoveredResidueIndex={hoveredResidueIndex}
            landscapeMap={landscapeMap}
            metricMode={metricMode}
            variantScores={variantScores}
            domains={domains}
            residueClass={residueClass}
            onResidueClick={onResidueClick}
            onResidueHover={onResidueHover}
            loadingWindow={!landscapeData || extraLoading}
          />

          <LandscapeLegend />

          <GenomicSaturationHeatmap
            chrom={parsedGenomic?.chrom || conservationData?.spliceProximity?.chrom || null}
            genomicPos={parsedGenomic?.pos || conservationData?.spliceProximity?.genomicPos || null}
            genomicAlt={parsedGenomic?.alt || null}
            spliceProximity={conservationData?.spliceProximity}
            mutationIndex={targetPos}
            residueIndex={residueIndex}
            hoveredResidueIndex={hoveredResidueIndex}
            onResidueClick={onResidueClick}
            onResidueHover={onResidueHover}
            onSelectGenomicVariant={handleSelectGenomicVariant}
          />
        </div>
      )}
    </div>
  );
});

export default SequenceVisualizer;

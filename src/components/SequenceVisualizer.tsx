import React, { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { Dna, AlertTriangle } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { useProteinSequence } from "../hooks/useProteinSequence";
import { useVariantAnalysisStore } from "../stores/useVariantAnalysisStore";
import { useApiClient } from "../apiClient";
import { parseGenomicCoordinateString, type LandscapeMeta, type LandscapeResidueItem } from "../shared/contracts";
import { landscapeFinding, landscapeKey, provenanceLine, type SummaryMode } from "../shared/landscapeEvidence";
import { aviRankBand } from "../shared/alphagenomeEvidence";
import { AMINO_ACID_MAP_3_TO_1 } from "./sequence/sequenceConstants";
import { LandscapeLegend } from "./sequence/LandscapeLegend";
import { LandscapeToolbar } from "./sequence/LandscapeToolbar";
import { WorkspaceTabs } from "./ui/WorkspaceTabs";
import { LandscapeAgreement } from "./sequence/LandscapeAgreement";
import { LandscapeOverview } from "./sequence/LandscapeOverview";
import { LandscapeFocus, type NucleotidePick } from "./sequence/LandscapeFocus";
import { GenomicSaturationHeatmap } from "./sequence/GenomicSaturationHeatmap";
import { alignCodonsToSequence, codonsByResidue, useAlphaGenomeRegion } from "./sequence/useAlphaGenomeRegion";
import type { DomainSpan, TargetMutation, VariantScores } from "./sequence/types";

interface SequenceVisualizerProps {
  uniprotId: string;
  gene?: string | null;
  variant: string;
  /** The residue the reader has selected (moves the window when outside it). */
  residueIndex: number | null;
  /**
   * The queried residue as the pipeline resolved it (canonical numbering, after any remap). The
   * target must come from here, not from the selection: for genomic notation the variant string
   * carries no residue, and falling back to the selection made the "queried residue" follow clicks.
   */
  targetResidue?: { pos: number | null; wt?: string | null; mut?: string | null } | null;
  hoveredResidueIndex?: number | null;
  onResidueClick?: (index: number) => void;
  predictorData?: any;
  conservationData?: any;
  landscapeData?: LandscapeResidueItem[] | null;
  landscapeMeta?: LandscapeMeta | null;
  uniprotFeatures?: Array<{ type?: string; description?: string; start: number; end: number }> | null;
  metricMode?: SummaryMode;
  setMetricMode?: (mode: SummaryMode) => void;
  windowSize?: number;
  setWindowSize?: (size: number) => void;
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

/**
 * The queried substitution: the pipeline's resolved residue and letters when present (they carry
 * any numbering remap), otherwise what the variant string states.
 */
export function resolveTarget(
  variant: string,
  resolved: { pos: number | null; wt?: string | null; mut?: string | null } | null | undefined
): TargetMutation {
  const parsed = parseTargetMutation(variant, null);
  const pos = resolved?.pos && resolved.pos > 0 ? resolved.pos : parsed.pos;
  const one = (v: string | null | undefined) => {
    if (!v) return "";
    const t = v.trim();
    return t.length === 3 ? AMINO_ACID_MAP_3_TO_1[t.toUpperCase()] || "" : t.toUpperCase();
  };
  return { pos, wt: one(resolved?.wt) || parsed.wt, mut: one(resolved?.mut) || parsed.mut };
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

/**
 * The Landscape tab: finding → controls → whole-protein overview → focus window (residues,
 * every substitution, conservation, codon-aligned nucleotides) → legend → exon panel. Everything
 * shares one residue axis and one selection, which the inspector rail reads.
 */
const SequenceVisualizer = memo(function SequenceVisualizer({
  uniprotId,
  gene,
  variant,
  residueIndex,
  targetResidue,
  hoveredResidueIndex: hoveredResidueIndexProp,
  onResidueClick,
  predictorData,
  conservationData,
  landscapeData,
  landscapeMeta,
  uniprotFeatures,
  metricMode = "mean",
  setMetricMode,
  windowSize = 31,
  setWindowSize
}: SequenceVisualizerProps) {
  const [workspaceTab, setWorkspaceTab] = useState<'map' | 'agreement' | 'nucleotides'>('map');
  const workspaceTabs = [{ id: 'map', label: 'Residue map' }, { id: 'agreement', label: 'Predictor agreement' }, { id: 'nucleotides', label: 'Nucleotide map' }] as const;
  const { settings } = useSettings();
  const { apiClient } = useApiClient();
  const storeHoveredIndex = useVariantAnalysisStore((s) => s.hoveredResidueIndex);
  const hoveredResidueIndex = hoveredResidueIndexProp !== undefined ? hoveredResidueIndexProp : storeHoveredIndex;
  const seqColorScheme = settings.seqColorScheme;

  const { sequence, isLoading: sequenceLoading, error: sequenceError } = useProteinSequence(uniprotId);
  const mutation = useMemo(
    () => resolveTarget(variant, targetResidue),
    [variant, targetResidue?.pos, targetResidue?.wt, targetResidue?.mut]
  );
  const targetPos = mutation.pos;
  const key = landscapeKey(gene, variant, uniprotId);

  const view = useVariantAnalysisStore((s) => s.landscapeView);
  const setView = useVariantAnalysisStore((s) => s.setLandscapeView);
  const selection = useVariantAnalysisStore((s) => (s.landscapeSelection?.key === key ? s.landscapeSelection : null));
  const setSelection = useVariantAnalysisStore((s) => s.setLandscapeSelection);
  const selectedGenomicVariant = useVariantAnalysisStore((s) => s.selectedGenomicVariant);
  const overview = useVariantAnalysisStore((s) => (s.landscapeOverview?.key === key ? s.landscapeOverview : null));
  const setOverview = useVariantAnalysisStore((s) => s.setLandscapeOverview);

  /*
   * Window centre. It starts on the queried residue and moves when the reader picks a spot on the
   * overview, or selects a residue outside the window (a domain jump), so clicking inside the
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

  const residues = useMemo(
    () => (sequence ? sequence.slice(range.start - 1, range.end).split("") : []),
    [sequence, range.start, range.end]
  );

  /* Scores for windows the reader navigates to: the pipeline loads ±25 around the variant. */
  const extraRows = useVariantAnalysisStore((s) => (s.landscapeExtra?.key === key ? s.landscapeExtra.rows : null));
  const addLandscapeRows = useVariantAnalysisStore((s) => s.addLandscapeRows);
  const [extraLoading, setExtraLoading] = useState(false);
  const requested = useRef<Set<string>>(new Set());
  const activeWindowRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    requested.current = new Set();
  }, [key]);

  const landscapeMap = useMemo(() => {
    const map = new Map<number, LandscapeResidueItem>();
    for (const item of [...(landscapeData ?? []), ...(extraRows ?? [])]) {
      if (item && typeof item.residx === "number") map.set(item.residx, item);
    }
    return map;
  }, [landscapeData, extraRows]);

  useEffect(() => {
    if (!gene || !uniprotId || !variant || !landscapeData || residues.length === 0) return;
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
    const reqKey = `${start}-${end}`;
    if (requested.current.has(reqKey)) return;
    requested.current.add(reqKey);
    const controller = new AbortController();
    activeWindowRequest.current = controller;
    setExtraLoading(true);
    apiClient
      .getLandscapeData({ gene, uniprotId, variant, landscapeWindow: { start, end } }, controller.signal)
      .then((res) => addLandscapeRows(key, res.landscapeData ?? []))
      .catch((err: any) => {
        // Forget the request so a later visit (or a re-run after an abort) asks again.
        requested.current.delete(reqKey);
        if (err?.name !== "AbortError") console.warn("[Landscape] window fetch failed:", err);
      })
      // Only the latest request clears the flag; an aborted one finishing late must not.
      .finally(() => activeWindowRequest.current === controller && setExtraLoading(false));
    return () => controller.abort();
  }, [gene, uniprotId, variant, landscapeData, landscapeMap, range.start, range.end, center, sequence.length, residues.length, apiClient, addLandscapeRows, key]);

  /*
   * Whole-protein overview and gene context: one request per query, after the window has loaded.
   * Not aborted on re-render (a re-run finds the loading entry and skips); a late answer for an
   * older query is dropped by comparing the key.
   */
  const hasLandscape = Boolean(landscapeData);
  const [overviewAttempt, setOverviewAttempt] = useState(0);
  const retryOverview = useCallback(() => {
    setOverview(null);
    setOverviewAttempt((n) => n + 1);
  }, [setOverview]);
  useEffect(() => {
    if (!gene || !uniprotId || !variant || !hasLandscape) return;
    if (useVariantAnalysisStore.getState().landscapeOverview?.key === key) return;
    setOverview({ key, status: "loading", data: null, error: null });
    const stillCurrent = () => useVariantAnalysisStore.getState().landscapeOverview?.key === key;
    apiClient
      .getLandscapeOverview({ gene, uniprotId, variant })
      .then((data) => stillCurrent() && setOverview({ key, status: "ready", data, error: null }))
      .catch((err: any) => stillCurrent() && setOverview({ key, status: "error", data: null, error: err?.message ?? "request failed" }));
  }, [gene, uniprotId, variant, hasLandscape, key, apiClient, setOverview, overviewAttempt]);

  const parsedGenomic = useMemo(
    () => parseGenomicCoordinateString(predictorData?.gnomadVariantId || variant),
    [predictorData?.gnomadVariantId, variant]
  );
  const genomicPos = parsedGenomic?.pos || conservationData?.spliceProximity?.genomicPos || null;
  const region = useAlphaGenomeRegion({
    chrom: parsedGenomic?.chrom || conservationData?.spliceProximity?.chrom || null,
    genomicPos,
    spliceProximity: conservationData?.spliceProximity
  });
  const strand = (region.params?.strand ?? null) as "+" | "-" | null;
  const { codons, mismatches: codonMismatches } = useMemo(
    () => alignCodonsToSequence(codonsByResidue(region.data?.positions, strand), sequence),
    [region.data, strand, sequence]
  );
  const laneStatus = !region.params ? "none" : region.pending ? "pending" : region.error ? "error" : "ready";

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
  const onHover = useCallback((pos: number | null) => setHovered(pos), [setHovered]);

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
        meta: landscapeMeta,
        context: overview?.status === "ready" ? overview.data?.context ?? null : overview?.status === "error" ? null : undefined,
        domains,
        predictorProvenance: {
          am: predictorData?.amProvenance ?? null,
          revel: conservationData?.revelProvenance ?? null
        }
      }),
    [landscapeMap, range, targetPos, mutation, variantScores.revel, variantScores.am, metricMode, landscapeMeta, overview, domains, predictorData?.amProvenance, conservationData?.revelProvenance]
  );

  const pickResidue = useCallback(
    (pos: number) => {
      setSelection({ key, kind: "residue", pos });
      onResidueClick?.(pos);
    },
    [key, setSelection, onResidueClick]
  );
  const pickSubstitution = useCallback(
    (pos: number, alt: string) => {
      setSelection({ key, kind: "substitution", pos, alt });
      onResidueClick?.(pos);
    },
    [key, setSelection, onResidueClick]
  );
  const pickNucleotide = useCallback(
    (pick: NucleotidePick) => {
      useVariantAnalysisStore.getState().setSelectedGenomicVariant({
        chrom: region.params?.chrom,
        pos: pick.position.pos,
        ref: pick.position.ref,
        alt: pick.genomicAlt,
        isRef: false,
        phred: pick.phred,
        rankBand: aviRankBand(pick.phred)?.label ?? null,
        topModality: pick.position.variants[pick.genomicAlt]?.topModality ?? pick.position.topModality ?? null,
        codonIndex: pick.codonIndex,
        codonPosition: pick.codonPosition,
        isExonic: pick.position.isExonic,
        strand
      });
      setSelection({ key, kind: "nucleotide", pos: pick.codonIndex });
      onResidueClick?.(pick.codonIndex);
    },
    [key, setSelection, onResidueClick, region.params?.chrom, strand]
  );
  const pickOverview = useCallback(
    (pos: number) => {
      setCenter(pos);
      setSelection({ key, kind: "residue", pos });
      onResidueClick?.(pos);
    },
    [key, setSelection, onResidueClick]
  );
  const handleSelectGenomicVariant = useCallback((v: any) => {
    useVariantAnalysisStore.getState().setSelectedGenomicVariant(v);
    if (v?.codonIndex) setSelection({ key, kind: "nucleotide", pos: v.codonIndex });
  }, [key, setSelection]);

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
  const selectedGenomic =
    selectedGenomicVariant && typeof selectedGenomicVariant.pos === "number"
      ? { pos: selectedGenomicVariant.pos, alt: String(selectedGenomicVariant.alt ?? "").toUpperCase() }
      : null;

  return (
    <div id="sequence-alignment-visualizer" className="landscape-canvas text-cs-text-primary">
      <div className="landscape-canvas__heading">
        <div className="p-1.5 rounded-lg border border-cs-border-subtle bg-cs-surface-2">
          <Dna className="w-4 h-4 text-cs-accent-clay" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-cs-text-primary">Residue landscape</h3>
          <p className="text-xs mt-0.5 text-cs-text-muted">
            {targetPos > 0
              ? `Predictors, conservation, population and nucleotide ranks on one residue axis around ${mutation.wt}${targetPos}${mutation.mut}`
              : "Predictors, conservation, population and nucleotide ranks on one residue axis"}
          </p>
        </div>
      </div>

      <WorkspaceTabs id="landscape" label="Landscape views" tabs={workspaceTabs} value={workspaceTab} onChange={setWorkspaceTab} />
      {workspaceTabs.filter(tab => tab.id !== workspaceTab).map(tab => <div key={tab.id} role="tabpanel" id={`landscape-panel-${tab.id}`} aria-labelledby={`landscape-tab-${tab.id}`} hidden />)}
      <div role="tabpanel" id={`landscape-panel-${workspaceTab}`} aria-labelledby={`landscape-tab-${workspaceTab}`} className="landscape-canvas__content">
      {!uniprotId ? (
        <div className="text-center py-12 text-cs-text-muted text-sm">Run an analysis to see the residue landscape around the variant.</div>
      ) : pendingSequence ? (
        <div className="h-28 flex flex-col items-center justify-center text-cs-text-muted text-xs gap-2" role="status">
          <div className="w-5 h-5 border-2 border-cs-accent-clay border-t-transparent rounded-full animate-spin" />
          <span>Loading the UniProt sequence for {uniprotId}…</span>
        </div>
      ) : !hasSequence ? (
        <div className="p-4 rounded-lg border border-cs-danger/30 bg-cs-danger-soft text-sm text-cs-text-primary flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 text-cs-danger shrink-0 mt-0.5" />
          <span>
            The UniProt sequence for {uniprotId} could not be loaded{sequenceError ? ` (${sequenceError})` : ""}, so residues cannot be laid
            out. Scores are not shown without the sequence they belong to.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {workspaceTab === "map" && <section className="ls-finding" aria-label="Landscape finding">
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
                  <details className="ls-finding__details"><summary>Window summary & context</summary>
                    <p>{finding.window}</p>
                    {finding.context && <p className="text-cs-text-secondary">{finding.context}</p>}
                  </details>
                  <span className="text-[12px] text-cs-text-muted">
                    PM1 context only: no ACMG code is proposed here. Band colours on residue summaries orient; they do not score evidence.
                  </span>
                  {finding.cautions.map((c) => (
                    <span key={c} className="ls-finding__caution flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {c}
                    </span>
                  ))}
                </>
              )}
            </div>
          </section>}

          {workspaceTab === "map" && <LandscapeToolbar
            view={view}
            onView={setView}
            mode={metricMode}
            onMode={setMetricMode}
            width={windowSize}
            onWidth={setWindowSize}
            targetPos={targetPos}
            available={{
              clinvar: overview?.status !== "ready" || overview.data?.context?.clinvar !== undefined,
              gnomad: overview?.status !== "ready" || overview.data?.context?.gnomad !== undefined,
              regions: overview?.status !== "ready" || (overview.data?.context?.regions?.length ?? 0) > 0
            }}
            awayFromTarget={awayFromTarget}
            onBack={() => {
              setCenter(targetPos);
              setSelection({ key, kind: "substitution", pos: targetPos, alt: mutation.mut || undefined });
              onResidueClick?.(targetPos);
            }}
          />}

          {workspaceTab === "map" && <>
          <LandscapeOverview
            length={sequence.length}
            status={overview?.status ?? "idle"}
            error={overview?.error}
            positions={overview?.data?.positions ?? null}
            context={overview?.data?.context ?? null}
            domains={domains}
            window={range}
            targetPos={targetPos}
            mode={metricMode}
            lanes={view.lanes}
            onMove={setCenter}
            onPick={pickOverview}
            onRetry={retryOverview}
            pageStep={windowSize}
          />

          <LandscapeFocus
            residues={residues}
            start={range.start}
            target={mutation}
            width={windowSize}
            rows={landscapeMap}
            mode={metricMode}
            colorBy={view.colorBy}
            variantScores={variantScores}
            domains={domains}
            selected={selection}
            selectedGenomic={selectedGenomic}
            hoveredPos={hoveredResidueIndex ?? null}
            loadingWindow={!landscapeData || extraLoading}
            codons={codons}
            strand={strand}
            laneStatus={laneStatus}
            codonMismatches={codonMismatches}
            genomicPos={genomicPos}
            genomicAlt={parsedGenomic?.alt || null}
            onPickResidue={pickResidue}
            onPickSubstitution={pickSubstitution}
            onPickNucleotide={pickNucleotide}
            onHover={onHover}
            residueClass={residueClass}
          />

          <LandscapeLegend colorBy={view.colorBy} laneVisible={laneStatus === "ready" && codons.size > 0} />

          </>}
          {workspaceTab === "agreement" && <LandscapeAgreement key={`${key}-${metricMode}`} rows={[...landscapeMap.values()].sort((a, b) => a.residx - b.residx)}
            mode={metricMode} onMode={setMetricMode} variantRevel={variantScores.revel} variantAm={variantScores.am}
            selectedResidue={residueIndex} onSelect={pickResidue} onHover={onHover} />}
          {workspaceTab === "nucleotides" && <GenomicSaturationHeatmap
            region={region}
            genomicPos={genomicPos}
            genomicAlt={parsedGenomic?.alt || null}
            defaultExpanded={true}
            mutationIndex={targetPos}
            residueIndex={residueIndex}
            hoveredResidueIndex={hoveredResidueIndex}
            onResidueClick={onResidueClick}
            onResidueHover={onHover}
            onSelectGenomicVariant={handleSelectGenomicVariant}
          />}
        </div>
      )}
      </div>
    </div>
  );
});

export default SequenceVisualizer;

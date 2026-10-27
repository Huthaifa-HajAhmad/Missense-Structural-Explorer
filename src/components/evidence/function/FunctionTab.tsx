import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, ExternalLink, ListTree, Microscope } from "lucide-react";
import type { TabComponentProps } from "../types";
import { buildFunctionEvidence, type AnnotationRow, type FunctionEvidence } from "../../../shared/functionEvidence";
import { DomainArchitecture } from "./DomainArchitecture";
import { functionEvidenceInputFrom } from "./functionInput";
import { drawingMode, layerOf, LAYER_KEYS, SECONDARY_MAX_SPAN, type LayerKey } from "./architectureLayout";
import { FND_SELECTION_PARAM, FND_WINDOW_PARAM, parseFndView, withFndParams, type FndView } from "./viewUrlState";
import { Prose } from "../../ui/Prose";
import { EvidencePanel, EvidenceViewTabs, useEvidenceWorkspace } from '../EvidenceWorkspace';
import { domainRowKeyResolver } from './architectureLayout';
import { safeExternalHref } from '../../../shared/externalLink';
import { FunctionWindowControl } from './FunctionWindowControl';
import { evidenceTab } from '../../../shared/evidenceTabs';

/**
 * Functional domains.
 *
 * ONE QUESTION: what is annotated at and around the variant residue, and does it meet PM1? Three tiers,
 * the shape Population Data set:
 *
 *   1. THE FINDING — the residue as the headline, one bold sentence on what covers it, the domain
 *      architecture with the variant placed, a fact strip ending in the engine record, and caveats.
 *   2. WHAT IS ANNOTATED — one table, grouped, every row with its residues, its distance in sequence
 *      and its evidence level; a row opens to its ECO codes and citation.
 *   3. The foot names what the entry does not annotate at all, so an empty table is never read as
 *      "checked and clear".
 *
 * INTERACTION: the legend toggles layers (with counts), hover links a drawing mark and its table row both ways,
 * a drag on the axis or the overview zooms to that range, ←/→ step through the marks, and the window and the open
 * row are in the URL (`fnd`, `fsel`) so the exact view can be sent.
 *
 * It replaced a zoom/pan track with seven coloured chip filters and an inspector legend, which gave
 * PM1 to every residue between two bonded cysteines, counted sites "by similarity" and predicted
 * sites as critical, painted "Interaction with UBA3" as a disordered region, and labelled the whole
 * table "Swiss-Prot Verified". doc/FUNCTIONAL_DOMAINS_TAB_REVIEW.md lists each finding.
 *
 * INVARIANTS
 *   • Every sentence, state and number comes from `buildFunctionEvidence`; this file decides nothing.
 *   • The PM1 chip is the engine's record. Without one in the payload it says "unconfirmed".
 *   • Absence is a state: nothing is called "not annotated" before the record arrives.
 */

type Zoom = "whole" | "near";
const NEAR = 50;

const LAYER_LABEL: Record<LayerKey, string> = {
  variants: "Disease variants",
  sites: "Sites",
  modifications: "Modifications",
  mutagenesis: "Mutagenesis",
  motifs: "Conserved sites",
  structure: "Helices and strands",
};
/** Above this length the whole-protein drawing cannot name its marks, so the tab opens on the variant's neighbourhood. */
const OPEN_NEAR_ABOVE = 600;

function VerdictChip({ ev }: { ev: FunctionEvidence }) {
  const tone = ev.verdict === "met" ? "danger" : ev.verdict === "not-assessed" ? "muted" : "neutral";
  return (
    <span
      className="ev-tier fnd-verdict"
      data-tone={tone}
      data-unconfirmed={ev.verdictUnconfirmed || undefined}
      data-testid="pm1-verdict"
      title={ev.verdictUnconfirmed ? "No engine record in this payload; the chip shows what the current rule finds." : undefined}
    >
      {ev.verdictLabel}
      {ev.verdictUnconfirmed ? " · unconfirmed" : ""}
    </span>
  );
}

function Legend({
  ev,
  win,
  hidden,
  onToggle,
}: {
  ev: FunctionEvidence;
  win: { start: number; end: number };
  hidden: ReadonlySet<LayerKey>;
  onToggle: (layer: LayerKey) => void;
}) {
  const showSS = win.end - win.start <= SECONDARY_MAX_SPAN;
  const mode = drawingMode(ev, win, hidden);
  const has = (pred: (r: AnnotationRow) => boolean) => ev.rows.some(pred);
  const below = (r: AnnotationRow) => r.lane === "below";
  const counts: Record<LayerKey, number> = {
    variants: ev.rows.filter((r) => r.disease).length,
    sites: ev.rows.filter((r) => layerOf(r) === "sites" && r.lane === "below").length,
    modifications: ev.rows.filter((r) => layerOf(r) === "modifications").length,
    mutagenesis: ev.rows.filter((r) => layerOf(r) === "mutagenesis").length,
    motifs: ev.motifs.length,
    structure: showSS ? ev.secondaryStructure.filter((e) => e.kind !== "turn").length : 0,
  };
  const hasHelix = ev.secondaryStructure.some((e) => e.kind === "helix");
  const hasStrand = ev.secondaryStructure.some((e) => e.kind === "strand");
  const structureLabel =
    hasHelix && hasStrand
      ? "Helices and strands"
      : hasStrand
        ? "Strands"
        : hasHelix
          ? "Helices"
          : "Helices and strands";
  const layers = (Object.keys(LAYER_LABEL) as LayerKey[]).filter((l) => counts[l] > 0);
  const swatch = (layer: LayerKey) =>
    layer === "variants"
      ? "disease"
      : layer === "motifs"
        ? "motif"
        : layer === "structure"
          ? hasHelix && !hasStrand
            ? "helix"
            : "strand"
          : mode.lanes
            ? `lane-${layer}`
            : "site";
  const off = (layer: LayerKey) => hidden.has(layer);
  return (
    <ul className="fnd-legend" aria-label="Legend and layers">
      <li><i className="fnd-key" data-kind="query" />This variant</li>
      {layers.map((layer) => (
        <li key={layer}>
          <button
            type="button"
            className="fnd-layer"
            aria-pressed={!off(layer)}
            onClick={() => onToggle(layer)}
            data-testid={`layer-${layer}`}
            title={layer === "variants" && mode.bars ? "Bar height is the number of UniProtKB disease variants at a residue; clay is this variant's." : mode.lanes && ["sites", "modifications", "mutagenesis"].includes(layer) ? "Each kind has its own row; hover a mark to name it." : undefined}
          >
            {layer === "structure" && hasHelix && hasStrand ? (
              <>
                <i className="fnd-key" data-kind="helix" />
                <i className="fnd-key" data-kind="strand" />
              </>
            ) : (
              <i className="fnd-key" data-kind={swatch(layer)} />
            )}
            {layer === "structure" ? structureLabel : LAYER_LABEL[layer]}
            <span className="fnd-layer__n">{counts[layer]}</span>
          </button>
        </li>
      ))}
      {!off("sites") && has((r) => below(r) && ["experimental", "structure", "proteomics"].includes(r.evidence)) && <li><i className="fnd-key" data-kind="experimental" />Experimental</li>}
      {!off("sites") && has((r) => below(r) && ["similarity", "predicted", "curated"].includes(r.evidence)) && <li><i className="fnd-key" data-kind="inferred" />Inferred</li>}
      {!off("sites") && has((r) => (below(r) || r.lane === "region") && r.evidence === "none") && <li><i className="fnd-key" data-kind="uncited" />No evidence cited</li>}
      {ev.structuralDomains.length > 0 && <li><i className="fnd-key" data-kind="structural" />Gene3D segment</li>}
    </ul>
  );
}

function RowDetail({
  row,
  ev,
  onShow3d,
}: {
  row: AnnotationRow;
  ev: FunctionEvidence;
  onShow3d: (() => void) | null;
}) {
  const source = row.evidence === "match" ? `InterPro member database ${row.type}` : `UniProtKB ${row.type.toLowerCase()}`;
  const citationHref = safeExternalHref(row.citation?.url);
  return (
    <tr className="fnd-detail" data-testid="annotation-detail">
      <td colSpan={4}>
        <dl className="fnd-detail__dl">
          <div>
            <dt>Source</dt>
            <dd>{source}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>
              {row.evidenceLabel}
              {row.evidenceCodes.length > 0 && <span className="fnd-mono"> · {row.evidenceCodes.join(", ")}</span>}
            </dd>
          </div>
          {row.citation && (
            <div>
              <dt>Citation</dt>
              <dd>
                {citationHref ? (
                  <a href={citationHref} target="_blank" rel="noopener noreferrer" className="fnd-link">
                    {row.citation.label}
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  row.citation.label
                )}
              </dd>
            </div>
          )}
          {row.parts.length > 1 || (row.parts.length === 1 && row.parts[0].detail) ? (
            <div>
              <dt>Changes</dt>
              <dd>
                <ul className="fnd-parts" data-testid="variant-parts">
                  {row.parts.map((part) => {
                    const partHref = safeExternalHref(part.citation?.url);
                    return (
                    <li key={part.key}>
                      <span className="fnd-mono">{part.name}</span>
                      {[part.note, part.detail].filter(Boolean).length ? <span> · {[part.note, part.detail].filter(Boolean).join("; ")}</span> : null}
                      {part.citation ? (
                        <>
                          {" · "}
                          {partHref ? (
                            <a href={partHref} target="_blank" rel="noopener noreferrer" className="fnd-link">
                              {part.citation.label}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            part.citation.label
                          )}
                        </>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Position</dt>
            <dd>
              {row.isPair ? `Cysteines ${row.residuesText}, bonded to each other` : `Residues ${row.residuesText}`}
              {row.covers ? `, includes ${ev.residue}` : `, ${Math.abs(row.distance)} from ${ev.residue} in sequence`}
            </dd>
          </div>
        </dl>
        {onShow3d && (
          <button type="button" className="fnd-button" onClick={onShow3d}>
            <Box className="w-3.5 h-3.5" aria-hidden="true" />
            Show in 3D
          </button>
        )}
      </td>
    </tr>
  );
}

export function FunctionTab({ analysisState, active3dModelTab, onSelectResidue, onNavigateToView }: TabComponentProps) {
  const result = analysisState.result;
  const workspace = useEvidenceWorkspace('function');
  // The zoom is the reader's once they touch it; until then it follows the protein (re-derived per variant).
  const [zoomChoice, setZoomChoice] = useState<{ key: string; view: FndView } | null>(null);
  // The address bar carries the window and the open row; read once, applied to the variant the tab opened on.
  const [fromUrl] = useState(() => {
    if (typeof window === "undefined") return { fnd: null as string | null, fsel: null as string | null };
    const q = new URLSearchParams(window.location.search);
    return { fnd: q.get(FND_WINDOW_PARAM), fsel: q.get(FND_SELECTION_PARAM) };
  });
  const [localSelected, setLocalSelected] = useState<string | null>(fromUrl.fsel);
  const selectedKey = workspace.enabled ? workspace.selected : localSelected;
  const setSelectedKey = (key: string | null) => { setLocalSelected(key); workspace.select(key); };
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [localHidden, setLocalHidden] = useState<ReadonlySet<LayerKey>>(new Set());
  // The workspace layer selection survives navigation; unknown keys (a renamed layer) fall
  // back to visible instead of hiding a track the drawing no longer names.
  const hidden = useMemo(() => workspace.enabled ? new Set((workspace.hidden ?? []).filter((k): k is LayerKey => (LAYER_KEYS as readonly string[]).includes(k))) : localHidden, [workspace.enabled, workspace.hidden, localHidden]);
  const toggleLayer = (layer: LayerKey) =>
    (() => {
      const next = new Set(hidden);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      setLocalHidden(next);
      workspace.setOptions({ hidden: [...next] });
    })();
  const firstKey = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  /** The row a "View selected record" click asked to land on; focus is given only when it is set. */
  const focusRowRef = useRef<string | null>(null);
  const [localExpanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const expanded = workspace.enabled ? new Set(workspace.expanded) : localExpanded;
  const toggleGroup = (g: string) =>
    workspace.enabled ? workspace.toggleGroup(g) : setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const ev = useMemo(() => (result ? buildFunctionEvidence(functionEvidenceInputFrom(result)) : null), [result]);
  /** One row-key index for the domain-name disclosure, shared with the drawing's own resolver. */
  const domainKeyFor = useMemo(() => domainRowKeyResolver(ev?.rows ?? []), [ev]);

  // The window the reader chose and the row they opened go in the address bar while the tab is mounted.
  const evLength = ev?.length ?? 0;
  const variantKey = ev ? `${ev.uniprotId}:${ev.residue}:${ev.variantShort}` : "";
  const seededUrl = useRef(false);
  useEffect(() => {
    if (!ev || seededUrl.current) return;
    seededUrl.current = true;
    if (!workspace.enabled) return;
    if (fromUrl.fsel && !workspace.selected && ev.groups.some(g => g.rows.some(r => r.key === fromUrl.fsel))) workspace.select(fromUrl.fsel);
    const linkedWindow = parseFndView(fromUrl.fnd, ev.length);
    if (linkedWindow && !workspace.window) workspace.setOptions({ window: linkedWindow });
  }, [ev, workspace.enabled]);
  useEffect(() => {
    if (typeof window === "undefined" || !evLength) return;
    try {
      // The window written is the one the drawing shows: a choice made on the previous variant is not this variant's
      // (a 40-100 window carried from SOD1 into a link for NAE1 opened the recipient on the wrong stretch).
      const mine = workspace.window ?? (zoomChoice && zoomChoice.key === variantKey ? zoomChoice.view : null);
      const fromLink = variantKey === firstKey.current ? parseFndView(fromUrl.fnd, evLength) : null;
      const next = withFndParams(window.location.href, mine ?? fromLink, selectedKey);
      if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    } catch {
      // A sandboxed frame can refuse replaceState; the link is a convenience, never load-bearing.
    }
  }, [zoomChoice, selectedKey, evLength, fromUrl.fnd, variantKey, workspace.window]);
  // An open row belongs to one variant's table: a new variant starts with none.
  const lastVariant = useRef<string | null>(null);
  useEffect(() => {
    if (!variantKey) return;
    if (lastVariant.current !== null && lastVariant.current !== variantKey) setSelectedKey(null);
    lastVariant.current = variantKey;
  }, [variantKey]);
  useEffect(
    () => () => {
      try {
        const next = withFndParams(window.location.href, null, null);
        if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
      } catch {
        // see above
      }
    },
    []
  );
  // A mark picked in the drawing may open a row below the fold; bring it into view without moving anything else.
  // When the reader arrived from the comparison view's "View selected record" button, scroll alone is not
  // enough: that button unmounts with the comparison view, so focus must land on the row as well. Only that
  // button sets focusRowRef; switching to Annotation details from the tablist must leave focus on the tab it just
  // moved to, which depending on `workspace.view` alone used to override.
  useEffect(() => {
    if (!selectedKey) return;
    const escaped = CSS?.escape ? CSS.escape(selectedKey) : selectedKey;
    const row = tableRef.current?.querySelector(`[data-row-key="${escaped}"]`);
    if (!row) return;
    row.scrollIntoView?.({ block: "nearest" });
    if (workspace.enabled && workspace.view === 'records' && focusRowRef.current === selectedKey) {
      focusRowRef.current = null;
      row.querySelector<HTMLElement>(".fnd-subject__btn")?.focus?.({ preventScroll: true });
    }
  }, [selectedKey, workspace.view, workspace.enabled]);

  if (!result || !ev) return null;

  const zoomKey = `${ev.uniprotId}:${ev.residue}:${ev.variantShort}`;
  if (firstKey.current === null) firstKey.current = zoomKey;
  const defaultZoom: Zoom = ev.length > OPEN_NEAR_ABOVE && Number.isFinite(ev.residue) ? "near" : "whole";
  const urlView = zoomKey === firstKey.current ? parseFndView(fromUrl.fnd, ev.length) : null;
  const view: FndView = workspace.window ?? (zoomChoice && zoomChoice.key === zoomKey ? zoomChoice.view : urlView ?? defaultZoom);
  const setZoom = (z: FndView) => { setZoomChoice({ key: zoomKey, view: z }); workspace.setOptions({ window: z }); };

  const ok = ev.availability.state === "ok";
  const win =
    typeof view === "object"
      ? view
      : view === "near" && Number.isFinite(ev.residue)
        ? { start: Math.max(1, ev.residue - NEAR), end: Math.min(ev.length, ev.residue + NEAR) }
        : { start: 1, end: ev.length };
  const toggle = (key: string) => setSelectedKey(selectedKey === key ? null : key);
  const show3d = (row: AnnotationRow) =>
    onSelectResidue && onNavigateToView
      ? () => {
          onSelectResidue(row.covers ? ev.residue : row.start);
          onNavigateToView(active3dModelTab === "esm3" || active3dModelTab === "esmfold2" ? "structure_esmfold" : "structure_alphafold");
        }
      : null;

  return (
    <div data-evidence-screen className="fnd-screen @container" data-comparison={workspace.comparison || undefined}>
      <header className="fnd-header">
        <h1 className="screen-title">{evidenceTab('function').label}</h1>
        <p className="screen-tab-description">
          What UniProtKB and InterPro annotate at and around the variant residue, and whether it meets PM1.
        </p>
      </header>
      <EvidenceViewTabs tab="function" comparisonLabel="Protein map" />
      <EvidencePanel tab="function">

      {/* ── 1. The finding ───────────────────────────────────────────────────────────────── */}
      <section className="fnd-card" aria-labelledby="fnd-finding-title" data-testid="function-finding">
        <div className="fnd-hero">
          <div className="fnd-hero__top">
            <span className="eyebrow" id="fnd-finding-title">
              <Microscope className="w-3.5 h-3.5" />
              PM1 · critical functional region
            </span>
            <VerdictChip ev={ev} />
          </div>
          <div className="fnd-hero__figure">
            <span className="fnd-figure fnd-mono">{ev.headline.figure}</span>
          </div>
          <Prose className="fnd-hero__finding" data-testid="function-finding-sentence" role={ok ? undefined : "status"}>
            <strong>{ev.finding.lead}</strong>
            {ev.finding.rest ? ` ${ev.finding.rest}` : ""}
            {!ok && ev.availability.reason ? ` ${ev.availability.reason}` : ""}
          </Prose>
        </div>

        {ok && (!workspace.enabled || workspace.comparison) && (
          <figure className="fnd-figure-block">
            <figcaption className="mol-map-title"><h2>Which annotations cover this position?</h2><p>Read along the protein sequence. Separate tracks retain overlapping source annotations; they are not independent evidence.</p></figcaption>
            <div className="fnd-figure-block__bar">
              <Legend ev={ev} win={win} hidden={hidden} onToggle={toggleLayer} />
              <div className="fnd-seg" role="group" aria-label="Zoom the schematic">
                <button type="button" aria-pressed={view === "whole"} onClick={() => setZoom("whole")}>
                  Whole protein
                </button>
                <button type="button" aria-pressed={view === "near"} onClick={() => setZoom("near")}>
                  {ev.residue} ± {NEAR}
                </button>
                {typeof view === "object" && (
                  <button type="button" aria-pressed="true" onClick={() => setZoom("whole")} title="Back to the whole protein" data-testid="zoom-custom">
                    {view.start}–{view.end}
                  </button>
                )}
              </div>
            </div>
            <DomainArchitecture
              ev={ev}
              win={win}
              selectedKey={selectedKey}
              hoverKey={hoverKey}
              hidden={hidden}
              onSelect={toggle}
              onStep={setSelectedKey}
              onHover={setHoverKey}
              onWindow={setZoom}
            />
            <FunctionWindowControl window={win} length={ev.length} onApply={setZoom} />
            {(ev.residue < win.start || ev.residue > win.end) && <p className="mol-guide" role="status">The variant at {ev.residue} is outside this window. <button type="button" className="viz-action" onClick={() => setZoom('near')}>Return to variant</button></p>}
            {/* Progressive disclosure, not a caption paragraph: the drawing's reading guidance sits in a
                closed details (the sod1 guard deliberately forbids caption text below the drawing), where
                an unfamiliar reader can open it without pushing the records below the fold. */}
            <details className="mol-guide mol-read-guide">
              <summary>How to read this map</summary>
              <p>The clay line marks {ev.variantShort}. Read left to right along the sequence; select a domain or site to inspect its evidence.</p>
              <span>Overlapping annotations use separate tracks. Track height separates sources, not physical layers.</span>
            </details>
            {ev.domains.length > 0 && <details className="mol-domain-key"><summary>Domain names and sources · {ev.domains.length}</summary><ul>
              {ev.domains.map(d => <li key={d.key}><button type="button" aria-pressed={selectedKey === domainKeyFor(d)} onClick={() => toggle(domainKeyFor(d))}>
                <strong>{d.name}</strong><span>{d.source} {d.accession} · {d.segments.map(s => `${s.start}–${s.end}`).join(', ')}</span>
              </button></li>)}
            </ul></details>}
          </figure>
        )}

        <dl className="fnd-facts">
          {ev.facts.map((f) => (
            <div key={f.label} className="fnd-fact">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "fnd-mono" : undefined}>{f.value}</dd>
              <span className="fnd-fact__sub">{f.sub}</span>
            </div>
          ))}
        </dl>

        {ev.caveats.length > 0 && (
          <ul className="fnd-caveats" data-testid="function-caveats">
            {ev.caveats.map((c) => (
              <li key={c.lead}>
                <strong>{c.lead}</strong> {c.rest}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. What is annotated ────────────────────────────────────────────────────────── */}
      {ok && workspace.comparison && <div className="mol-guide mol-selection">
        <strong>{selectedKey ? ev.groups.flatMap(g => g.rows).find(r => r.key === selectedKey)?.name ?? 'The pinned annotation is no longer available' : 'Pin an annotation to follow its evidence'}</strong>
        <span>{selectedKey ? 'The inspector holds the pinned record. Open Annotation details for its exact bounds and citations.' : 'Click a domain or site, or use the drawing’s arrow keys. Full domain names remain available above.'}</span>
        {selectedKey && <button className="viz-action" type="button" onClick={() => { focusRowRef.current = selectedKey; workspace.setView('records'); }}>View selected record</button>}
      </div>}
      {ok && (!workspace.enabled || !workspace.comparison) && (
        <section className="fnd-section" aria-labelledby="fnd-table-title">
          <h2 className="eyebrow" id="fnd-table-title">
            <ListTree className="w-3.5 h-3.5" />
            What is annotated
          </h2>
          <div className="fnd-card fnd-table-wrap" ref={tableRef}>
            {ev.groups.length ? (
              <table className="fnd-table" data-testid="annotation-table">
                <thead>
                  <tr>
                    <th scope="col">Annotation</th>
                    <th scope="col" className="fnd-num">Residues</th>
                    <th scope="col" className="fnd-num fnd-col-distance" title="Residues from the nearest covered residue to the variant; 0 covers it. Sequence distance, not 3D.">From {ev.residue}</th>
                    <th scope="col">Evidence</th>
                  </tr>
                </thead>
                {ev.groups.map((g) => {
                  // Near the variant by default: a 68-row wall hides the few rows that matter. Domains stay,
                  // and a row the reader opened stays even when it is far.
                  const near = (r: AnnotationRow) => r.covers || Math.abs(r.distance) <= NEAR || g.group === "domains" || r.key === selectedKey;
                  const open = expanded.has(g.group);
                  const candidates = g.rows.filter(near);
                  // In the workspace's default view the covering and pinned rows come first (they are
                  // what the drawing is about), then at most twenty of the rest; "Show … more" opens
                  // the group in full reading order. The reordering is deliberate, and only here.
                  const limited = workspace.enabled ? candidates.filter(r => r.key === selectedKey || r.covers).concat(candidates.filter(r => r.key !== selectedKey && !r.covers).slice(0, 20)) : candidates;
                  const shown = open ? g.rows : limited;
                  const hidden = g.rows.length - shown.length;
                  const hasFar = g.rows.length > limited.length;
                  return (
                  <tbody key={g.group} data-group={g.group}>
                    <tr className="fnd-group">
                      <th colSpan={4} scope="rowgroup">
                        <span className="fnd-group__title">{g.label}</span>
                        <span className="fnd-group__count">{g.rows.length}</span>
                        {g.summary && <span className="fnd-group__note">{g.summary}</span>}
                      </th>
                    </tr>
                    {shown.map((row) => {
                      const open = selectedKey === row.key;
                      return (
                        <React.Fragment key={row.key}>
                          <tr
                            data-covers={row.covers || undefined}
                            data-selected={open || undefined}
                            data-lit={hoverKey === row.key || undefined}
                            data-row-key={row.key}
                            data-testid="annotation-row"
                            onMouseEnter={() => setHoverKey(row.key)}
                            onMouseLeave={() => setHoverKey(null)}
                          >
                            <th scope="row" className="fnd-subject">
                              <button
                                type="button"
                                className="fnd-subject__btn"
                                aria-expanded={open}
                                onClick={() => toggle(row.key)}
                                onFocus={() => setHoverKey(row.key)}
                                onBlur={() => setHoverKey(null)}
                              >
                                <span className="fnd-subject__name">{row.name}</span>
                                {row.note && <span className="fnd-subject__note">{row.note}</span>}
                              </button>
                            </th>
                            <td className="fnd-num">{row.residuesText}</td>
                            <td className="fnd-num fnd-col-distance">{row.distanceText}</td>
                            <td className="fnd-evidence">
                              {row.evidenceLabel}
                              {row.citation && <span className="fnd-subject__note">{row.citation.label}</span>}
                            </td>
                          </tr>
                          {open && <RowDetail row={row} ev={ev} onShow3d={show3d(row)} />}
                        </React.Fragment>
                      );
                    })}
                    {hasFar ? (
                      <tr className="fnd-more">
                        <td colSpan={4}>
                          <button type="button" className="fnd-more__btn" aria-expanded={open} onClick={() => toggleGroup(g.group)}>
                            {open ? `Show only within ${NEAR} residues of ${ev.residue}` : shown.length === 0 ? `None within ${NEAR} residues of ${ev.residue}. Show ${hidden}` : workspace.enabled ? `Show ${hidden} more annotations` : `Show ${hidden} more, more than ${NEAR} residues away`}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  );
                })}
              </table>
            ) : (
              <p className="fnd-empty">UniProtKB lists no features for this protein beyond the chain itself.</p>
            )}
            {ev.notAnnotated.length > 0 && (
              <div className="fnd-foot" data-testid="not-annotated">
                <span>
                  <strong>Not annotated{ev.gene ? ` for ${ev.gene}` : ""}:</strong> {ev.notAnnotated.join(", ")}.
                </span>
              </div>
            )}
          </div>
        </section>
      )}
      </EvidencePanel>
    </div>
  );
}

export default FunctionTab;

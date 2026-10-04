import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, ExternalLink, ListTree, Microscope } from "lucide-react";
import type { TabComponentProps } from "../types";
import { buildFunctionEvidence, type AnnotationRow, type FunctionEvidence } from "../../../shared/functionEvidence";
import { DomainArchitecture } from "./DomainArchitecture";
import { functionEvidenceInputFrom } from "./functionInput";
import { drawingMode, layerOf, SECONDARY_MAX_SPAN, type LayerKey } from "./architectureLayout";
import { FND_SELECTION_PARAM, FND_WINDOW_PARAM, parseFndView, withFndParams, type FndView } from "./viewUrlState";

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
  const layers = (Object.keys(LAYER_LABEL) as LayerKey[]).filter((l) => counts[l] > 0);
  const swatch = (layer: LayerKey) =>
    layer === "variants" ? "disease" : layer === "motifs" ? "motif" : layer === "structure" ? "helix" : mode.lanes ? `lane-${layer}` : "site";
  const off = (layer: LayerKey) => hidden.has(layer);
  return (
    <ul className="fnd-legend" aria-label="Legend and layers">
      <li><i className="fnd-key" data-kind="query" />This variant</li>
      {layers.map((layer) => (
        <li key={layer}>
          <button type="button" className="fnd-layer" aria-pressed={!off(layer)} onClick={() => onToggle(layer)} data-testid={`layer-${layer}`}>
            <i className="fnd-key" data-kind={swatch(layer)} />
            {LAYER_LABEL[layer]}
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

function architectureCaption(ev: FunctionEvidence, win: { start: number; end: number }, hidden: ReadonlySet<LayerKey>): string {
  const parts: string[] = [];
  const mode = drawingMode(ev, win, hidden);
  if (ev.domains.length && ev.domains[0].source !== "UniProtKB") {
    parts.push(`Domains from InterPro (${ev.domains.map((d) => `${d.source} ${d.accession}`).join(", ")})`);
  } else if (ev.domains.length) parts.push("Domains from UniProtKB");
  if (ev.structuralDomains.length) parts.push(`structural segments from ${ev.structuralDomains[0].source}`);
  if (ev.motifs.length && !hidden.has("motifs")) parts.push(`conserved-site signatures from ${Array.from(new Set(ev.motifs.map((m) => m.source))).join(", ")} as ticks under the backbone`);
  if (ev.rows.some((r) => r.lane === "membrane")) parts.push("membrane topology from UniProtKB");
  if (ev.secondaryStructure.length && win.end - win.start <= SECONDARY_MAX_SPAN) {
    const pdb = ev.secondaryStructure.find((e) => e.pdb)?.pdb;
    parts.push(`helices and strands from ${pdb ? `PDB ${pdb}` : "UniProtKB"}`);
  }
  let text = parts.length ? `${parts.join("; ")}.` : "";
  if (mode.bars) text += `${text ? " " : ""}Bars count UniProtKB disease variants per residue; clay is this variant's.`;
  if (mode.lanes) text += `${text ? " " : ""}Sites, modifications and mutagenesis have a row each; hover a mark to name it.`;
  if (!ev.rows.some((r) => r.group === "domains" && r.type === "Domain")) {
    text += `${text ? " " : ""}UniProtKB itself annotates no domain${ev.gene ? ` for ${ev.gene}` : ""}.`;
  }
  if (ev.interproMissing) text += " InterPro could not be read in this run.";
  return text;
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
                {row.citation.url ? (
                  <a href={row.citation.url} target="_blank" rel="noopener noreferrer" className="fnd-link">
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
                  {row.parts.map((part) => (
                    <li key={part.key}>
                      <span className="fnd-mono">{part.name}</span>
                      {[part.note, part.detail].filter(Boolean).length ? <span> · {[part.note, part.detail].filter(Boolean).join("; ")}</span> : null}
                      {part.citation ? (
                        <>
                          {" · "}
                          {part.citation.url ? (
                            <a href={part.citation.url} target="_blank" rel="noopener noreferrer" className="fnd-link">
                              {part.citation.label}
                              <span className="sr-only"> (opens in a new tab)</span>
                            </a>
                          ) : (
                            part.citation.label
                          )}
                        </>
                      ) : null}
                    </li>
                  ))}
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
  // The zoom is the reader's once they touch it; until then it follows the protein (re-derived per variant).
  const [zoomChoice, setZoomChoice] = useState<{ key: string; view: FndView } | null>(null);
  // The address bar carries the window and the open row; read once, applied to the variant the tab opened on.
  const [fromUrl] = useState(() => {
    if (typeof window === "undefined") return { fnd: null as string | null, fsel: null as string | null };
    const q = new URLSearchParams(window.location.search);
    return { fnd: q.get(FND_WINDOW_PARAM), fsel: q.get(FND_SELECTION_PARAM) };
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(fromUrl.fsel);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<LayerKey>>(new Set());
  const toggleLayer = (layer: LayerKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  const firstKey = useRef<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (g: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });

  const ev = useMemo(() => (result ? buildFunctionEvidence(functionEvidenceInputFrom(result)) : null), [result]);

  // The window the reader chose and the row they opened go in the address bar while the tab is mounted.
  const evLength = ev?.length ?? 0;
  useEffect(() => {
    if (typeof window === "undefined" || !evLength) return;
    try {
      const next = withFndParams(window.location.href, zoomChoice?.view ?? parseFndView(fromUrl.fnd, evLength), selectedKey);
      if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    } catch {
      // A sandboxed frame can refuse replaceState; the link is a convenience, never load-bearing.
    }
  }, [zoomChoice, selectedKey, evLength, fromUrl.fnd]);
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
  useEffect(() => {
    if (!selectedKey) return;
    tableRef.current?.querySelector(`[data-row-key="${CSS?.escape ? CSS.escape(selectedKey) : selectedKey}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedKey]);

  if (!result || !ev) return null;

  const zoomKey = `${ev.uniprotId}:${ev.residue}`;
  if (firstKey.current === null) firstKey.current = zoomKey;
  const defaultZoom: Zoom = ev.length > OPEN_NEAR_ABOVE && Number.isFinite(ev.residue) ? "near" : "whole";
  const urlView = zoomKey === firstKey.current ? parseFndView(fromUrl.fnd, ev.length) : null;
  const view: FndView = zoomChoice && zoomChoice.key === zoomKey ? zoomChoice.view : urlView ?? defaultZoom;
  const setZoom = (z: Zoom) => setZoomChoice({ key: zoomKey, view: z });

  const ok = ev.availability.state === "ok";
  const win =
    typeof view === "object"
      ? view
      : view === "near" && Number.isFinite(ev.residue)
        ? { start: Math.max(1, ev.residue - NEAR), end: Math.min(ev.length, ev.residue + NEAR) }
        : { start: 1, end: ev.length };
  const toggle = (key: string) => setSelectedKey((prev) => (prev === key ? null : key));
  const show3d = (row: AnnotationRow) =>
    onSelectResidue && onNavigateToView
      ? () => {
          onSelectResidue(row.covers ? ev.residue : row.start);
          onNavigateToView(active3dModelTab === "esm3" ? "structure_esmfold" : "structure_alphafold");
        }
      : null;

  return (
    <div className="fnd-screen @container">
      <header className="fnd-header">
        <h1 className="screen-title">Functional domains</h1>
        <p className="screen-tab-description">
          What UniProtKB and InterPro annotate at and around the variant residue, and whether it meets PM1.
        </p>
      </header>

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
            <span className="fnd-hero__sub">{ev.headline.sub}</span>
          </div>
          <p className="fnd-hero__finding" data-testid="function-finding-sentence" role={ok ? undefined : "status"}>
            <strong>{ev.finding.lead}</strong>
            {ev.finding.rest ? ` ${ev.finding.rest}` : ""}
            {!ok && ev.availability.reason ? ` ${ev.availability.reason}` : ""}
          </p>
        </div>

        {ok && (
          <figure className="fnd-figure-block">
            <DomainArchitecture
              ev={ev}
              win={win}
              selectedKey={selectedKey}
              hoverKey={hoverKey}
              hidden={hidden}
              onSelect={toggle}
              onStep={setSelectedKey}
              onHover={setHoverKey}
              onWindow={(w) => setZoomChoice({ key: zoomKey, view: w })}
            />
            <figcaption className="fnd-caption">{architectureCaption(ev, win, hidden)}</figcaption>
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
            <p className="fnd-hint">Drag along the axis to zoom. Click a mark, or use the arrow keys, to open its row.</p>
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
      {ok && (
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
                  const shown = open ? g.rows : g.rows.filter(near);
                  const hidden = g.rows.length - shown.length;
                  const hasFar = g.rows.some((r) => !near(r));
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
                            {open ? `Show only within ${NEAR} residues of ${ev.residue}` : shown.length === 0 ? `None within ${NEAR} residues of ${ev.residue}. Show ${hidden}` : `Show ${hidden} more, more than ${NEAR} residues away`}
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
    </div>
  );
}

export default FunctionTab;

import { ResearchGuideButton } from "../knowledge/ResearchGuideButton";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Boxes, Download, ExternalLink, Handshake, MapPin, RefreshCw, Search, Waypoints, X, Zap } from "lucide-react";
import { TabComponentProps } from "./types";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { STRING_CONFIDENCE_CUTS } from "../../shared/thresholds";
import {
  DDMUT_PPI_PERFORMANCE,
  IPTM_BAND_LABEL,
  buildInterfacesEvidence,
  filterPartnerGroups,
  rcsbUrl,
  stringNetworkUrl,
  type InterfacesEvidence,
  type ObservedView,
  type PartnerGroup,
  type PartnerGroupView,
  type PartnerRow,
  type StringCell,
} from "../../shared/interfacesEvidence";
import { useInterfacesData } from "./interfaces/useInterfacesData";
import { InterfaceMapWorkspace } from "./interfaces/InterfaceMapWorkspace";
import { AssemblyDiagram } from "./interfaces/AssemblyDiagram";
import { PartnerTiers } from "./interfaces/PartnerTiers";
import { BindingRuler, IptmRuler } from "./interfaces/Rulers";
import { PPI_QUERY_PARAM, PPI_QUERY_MAX, PPI_TIER_PARAM, parsePpiQuery, parsePpiTier, withPpiParams } from "./interfaces/viewUrlState";
import { EvidenceViewTabs, EvidencePanel, InspectReadingButton, useEvidenceWorkspace } from "./EvidenceWorkspace";
import { MechanismSelection } from "./MechanismSelection";
import { interfaceWorkspaceReadings, interfaceMapView, interfaceNumberingNote } from "../../shared/mechanismWorkspace";
import { InterfaceOverview } from "./interfaces/InterfaceOverview";
import { Prose } from "../ui/Prose";
import { evidenceTab } from '../../shared/evidenceTabs';

/**
 * Interfaces & PPI.
 *
 * ONE QUESTION: does the variant residue sit where another protein touches this one, how well is that
 * attested, and with whom? It merges the former Multimer assembly and Protein interactions tabs,
 * which answered "at an interface" twice from the same PDBe data and disagreed on the counts
 * (doc/INTERFACES_AUDIT.md). Shape, top to bottom:
 *
 *   1. THE FINDING — interface verdict with its support ("1 of 8 solved structures", or "0 of 142"
 *      native when it is not at one), the assembly diagram, and a fact strip. Fibril stacking and
 *      set-aside chains are stated in a callout, never in the verdict. Engine record once, in the foot.
 *   2. WHERE ON THE SEQUENCE — topology, regions, mapped sites, each solved partner's interface as a
 *      support profile (bar height = share of structures), fibrils last, the model when built. A lane
 *      and its table row light together; the lane's name brings the row into view.
 *   3. ASSEMBLY — every SUBUNIT statement with its qualifier, the solved structures per partner
 *      (native, fibril, set aside), the complex model (on request).
 *   4. PARTNERS — a tier chart that is also the filter, a name search, and one grid grouped by the kind
 *      of evidence. A long single-screen or STRING tail folds behind one line (doc/INTERFACES_PPI_REVIEW.md:
 *      SOD1 drew 120 rows, 66 of them one repeated sentence). Tier and query live in the URL.
 *   5. BINDING CHANGE — DDMut-PPI on a solved wild type first; on request; never on a fibril.
 *
 * No permanent "Run again": cached lookups give the same answer. A section that FAILED offers "Try
 * again" in place; the GPU jobs are stated actions in their own sections.
 *
 * INVARIANTS: every sentence, state, count and fold comes from `buildInterfacesEvidence`; this file
 * decides nothing about the evidence. Nothing here is an ACMG input.
 */

function downloadModel(pdb: string, name: string) {
  const blob = new Blob([pdb], { type: "chemical/x-pdb" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Statement({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ifc-statement">
      <p className="ifc-statement__title">{title}</p>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

function ActionButton({ onClick, busy, icon, children }: { onClick: () => void; busy?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  // `aria-disabled`, not `disabled`: a disabled control leaves the tab order and drops focus to <body>.
  return (
    <button type="button" className="ifc-button" onClick={() => { if (!busy) onClick(); }} aria-disabled={busy || undefined} aria-busy={busy || undefined}>
      {icon}
      {children}
    </button>
  );
}

function StateCells({ label, reason, span = 2, action }: { label: string | null; reason: string | null; span?: number; action?: React.ReactNode }) {
  return (
    <>
      <td className="ifc-reason" colSpan={span}>
        {reason}
        {action && <span className="ifc-inline-action">{action}</span>}
      </td>
      <td className="ifc-status">
        {label && <span className="ev-tier" data-tone={label === ENGINE_STATE_LABELS.running ? "neutral" : label === ENGINE_STATE_LABELS["upstream-error"] ? "warning" : "muted"}>{label}</span>}
      </td>
    </>
  );
}

function StringCellView({ cell }: { cell: StringCell }) {
  if (cell.score === null) return <span className="ifc-dim">{cell.note ?? "—"}</span>;
  return (
    <span className="ifc-assoc">
      <span className="ifc-assoc__row">
        <span className="ifc-bar" aria-hidden="true">
          <span className="ifc-bar__fill" style={{ width: `${Math.max(0, Math.min(1, cell.score)) * 100}%` }} />
          {STRING_CONFIDENCE_CUTS.map(c => (
            <span key={c.id} className="ifc-bar__tick" style={{ left: `${c.min * 100}%` }} />
          ))}
        </span>
        <span className="ifc-num">{cell.score.toFixed(3)}</span>
      </span>
      {cell.band && <span className="ifc-assoc__band">{cell.band}</span>}
    </span>
  );
}

/** A partner name: a STRING link for a human gene; plain text for the query, a family or another species. */
function PartnerName({ p, ev }: { p: PartnerRow; ev: InterfacesEvidence }) {
  const self = !p.family && p.accession && ev.uniprotId && p.accession.toUpperCase() === ev.uniprotId.toUpperCase();
  if (p.family || self || p.organism) {
    return <span>{self ? `${p.gene} (other chain)` : p.gene}</span>;
  }
  return (
    <>
      <a className="ifc-partner-link" href={stringNetworkUrl(ev.gene, p.gene)} target="_blank" rel="noopener noreferrer" title={`Open ${ev.gene} and ${p.gene} on STRING (new tab)`}>
        {p.gene}
      </a>
      <ExternalLink className="w-3 h-3" aria-hidden="true" />
    </>
  );
}

function PartnerRowView({ p, ev }: { p: PartnerRow; ev: InterfacesEvidence }) {
  const workspace = useEvidenceWorkspace('interfaces');
  const hit = p.variantInSite || p.variantAtObservedInterface;
  const self = !p.family && p.accession && ev.uniprotId && p.accession.toUpperCase() === ev.uniprotId.toUpperCase();
  return (
    <tr data-reading-key={`partner:${p.key}`} data-hit={hit || undefined} data-family={p.family || undefined}>
      <th scope="row" className="ifc-subject">
        <span className="ifc-subject__name">
          {workspace.enabled ? <><InspectReadingButton tab="interfaces" readingKey={`partner:${p.key}`}>{self ? `${p.gene} (other chain)` : p.gene}</InspectReadingButton>
            {!p.family && !self && !p.organism && <a className="ifc-link ifc-partner-source" href={stringNetworkUrl(ev.gene, p.gene)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.gene} in STRING (new tab)`}>STRING <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>}</> : <PartnerName p={p} ev={ev} />}
          {p.organism && <span className="ev-tier ifc-species" data-tone="muted">{p.organism}</span>}
        </span>
        {/* Only an accession the row actually has: a STRING-only partner has none, and the query's own is never shown on a partner. */}
        {(self || p.accession || p.family) && (
          <span className="ifc-subject__note">{self ? `${ev.uniprotId} · same protein` : p.family ? "No gene named" : p.accession}</span>
        )}
      </th>
      <td className="ifc-evidence">
        {p.evidence}
        {p.qualifier && <span className="ev-tier ifc-qualifier" data-tone="muted">{p.qualifier}</span>}
      </td>
      {ev.columns.solved && (
        <td className="ifc-num">
          {p.observed ? (
            <>
              {p.observed.variantAtInterface ? `${p.observed.k} of ${p.observed.n}` : `0 of ${p.observed.n}`}
              <span className="ifc-unit">{p.observed.variantAtInterface ? `with ${ev.residueLabel}` : `${ev.residueLabel} not at it`}</span>
            </>
          ) : (
            <span className="ifc-dim">—</span>
          )}
        </td>
      )}
      <td className="ifc-string">{p.family ? <span className="ifc-dim">—</span> : <StringCellView cell={p.physical} />}</td>
      <td className="ifc-string">{p.family ? <span className="ifc-dim">—</span> : <StringCellView cell={p.functional} />}</td>
      {ev.columns.site && (
        <td className="ifc-site" data-hit={p.variantInSite || undefined}>
          {p.sites.length ? (
            <>
              <span className="ifc-site__range">{p.sites.map(s => (s.start === s.end ? `${s.start}` : `${s.start}–${s.end}`)).join(", ")}</span>
              <span className="ifc-site__note">{p.variantInSite ? `${ev.residueLabel} inside` : `${ev.residueLabel} outside`}</span>
            </>
          ) : (
            <span className="ifc-dim">—</span>
          )}
        </td>
      )}
    </tr>
  );
}

/** A folded tail: one line, and on request the names as a list, each with the score it was sorted by. */
function FoldedRows({ g, ev, colCount, open, onToggle }: { g: PartnerGroupView; ev: InterfacesEvidence; colCount: number; open: boolean; onToggle: () => void }) {
  if (!g.folded) return null;
  const listId = `ifc-fold-${g.id}`;
  const scoreOf = (r: PartnerRow) => (g.id === "functional" ? r.functional.score : r.physical.score);
  return (
    <>
      <tr className="ifc-fold">
        <td colSpan={colCount}>
          <span className="ifc-fold__summary">{g.folded.summary}</span>
          <button type="button" className="ifc-link ifc-fold__toggle" aria-expanded={open} aria-controls={listId} onClick={onToggle}>
            {open ? "Hide names" : `Show ${g.folded.rows.length} names`}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ifc-fold__list-row">
          <td colSpan={colCount}>
            <ul className="ifc-chips" id={listId} aria-label={`${g.title}: ${g.folded.rows.length} more partners`}>
              {g.folded.rows.map(r => {
                const score = scoreOf(r);
                return (
                  <li key={r.key} className="ifc-chip" data-reading-key={`partner:${r.key}`}>
                    {r.organism ? (
                      <span className="ifc-chip__name"><InspectReadingButton tab="interfaces" readingKey={`partner:${r.key}`}>{r.gene}</InspectReadingButton></span>
                    ) : (
                      <a className="ifc-chip__name ifc-partner-link" href={stringNetworkUrl(ev.gene, r.gene)} target="_blank" rel="noopener noreferrer" title={`Open ${ev.gene} and ${r.gene} on STRING (new tab)`}>
                        {r.gene}
                      </a>
                    )}
                    {r.organism && <span className="ifc-chip__meta">{r.organism}</span>}
                    {score !== null && <span className="ifc-chip__meta ifc-mono">{score.toFixed(2)}</span>}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

function setAsideChip(o: ObservedView): string {
  if (/antibody|nanobody/i.test(o.artefact ?? "")) return "Tool binder";
  if (/no UniProt/i.test(o.artefact ?? "")) return "Unmapped";
  return "Construct";
}

/** One non-biological chain, set aside and never counted. */
function ArtefactRow({ p }: { p: ObservedView }) {
  return (
    <tr>
      <th scope="row" className="ifc-subject">
        <span className="ifc-subject__name">{p.name}</span>
        <span className="ifc-subject__note ifc-mono">{p.accession}</span>
      </th>
      <td className="ifc-reason" colSpan={2}>
        {p.artefact ? p.artefact.charAt(0).toUpperCase() + p.artefact.slice(1) : "Not biological"}, in {p.n === 1 ? "1 structure" : `${p.n} structures`}: not a biological partner, not counted.
      </td>
      <td className="ifc-status"><span className="ev-tier" data-tone="muted">{setAsideChip(p)}</span></td>
    </tr>
  );
}

export function InterfacesTab({ analysisState }: TabComponentProps) {
  const result = analysisState.result;
  const data = useInterfacesData(result);
  const workspace = useEvidenceWorkspace('interfaces');

  // ── View state: linked highlight, partner tier and query (the last two in the URL) ──
  const [lit, setLit] = useState<string | null>(null);
  const [localTier, setLocalTier] = useState<PartnerGroup | null>(() => (typeof window === "undefined" ? null : parsePpiTier(new URLSearchParams(window.location.search).get(PPI_TIER_PARAM))));
  const [localQuery, setLocalQuery] = useState<string>(() => (typeof window === "undefined" ? "" : parsePpiQuery(new URLSearchParams(window.location.search).get(PPI_QUERY_PARAM))));
  const [localFolds, setLocalFolds] = useState<ReadonlySet<PartnerGroup>>(new Set());
  const tier = workspace.enabled ? parsePpiTier(workspace.section) : localTier;
  const query = workspace.enabled ? workspace.query : localQuery;
  const openFolds = workspace.enabled ? new Set(workspace.expanded) : localFolds;
  const setTier = (value: PartnerGroup | null | ((old: PartnerGroup | null) => PartnerGroup | null)) => {
    const next = typeof value === 'function' ? value(tier) : value;
    if (workspace.enabled) workspace.setOptions({ section: next ?? '' }); else setLocalTier(next);
  };
  const setQuery = (value: string) => workspace.enabled ? workspace.setOptions({ query: value }) : setLocalQuery(value);
  const [setAsideOpen, setSetAsideOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const variantKey = `${result?.metadata?.gene ?? ""}|${result?.metadata?.variant ?? ""}`;
  const firstVariant = useRef(variantKey);
  const urlSeeded = useRef(false);
  useEffect(() => {
    // A new variant starts unfiltered: a query for one protein's partners means nothing for the next.
    if (firstVariant.current === variantKey) return;
    firstVariant.current = variantKey;
    setTier(null);
    setQuery("");
    setLocalFolds(new Set());
    setSetAsideOpen(false);
  }, [variantKey]);
  useEffect(() => {
    if (workspace.enabled && !workspace.initialized) {
      workspace.setOptions({ initialized: true, section: urlSeeded.current ? '' : localTier ?? '', query: urlSeeded.current ? '' : localQuery });
      urlSeeded.current = true;
    }
  }, [workspace.enabled, workspace.initialized]);
  useEffect(() => {
    if (typeof window === "undefined" || (workspace.enabled && !workspace.initialized)) return;
    const next = withPpiParams(window.location.href, tier, query);
    if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
  }, [tier, query, workspace.initialized, workspace.enabled]);
  useEffect(
    () => () => {
      if (typeof window === "undefined") return;
      const next = withPpiParams(window.location.href, null, "");
      if (next !== window.location.href) window.history.replaceState(window.history.state, "", next);
    },
    []
  );
  const openRow = useCallback((key: string) => {
    if (workspace.enabled) { workspace.select(key); return; }
    const row = document.getElementById(`ifc-row-${key}`);
    if (!row) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    setLit(key);
  }, [workspace.enabled, workspace.select]);

  const { assembly, assemblyStatus, assemblyError, modelRequested, ppi, ppiStatus, ppiError, shift, shiftLoading, shiftError } = data;
  // Hover, pin and filter changes re-render this tab; the evidence object is rebuilt only when its inputs move.
  const ev = useMemo(() => (result ? buildInterfacesEvidence({
    result,
    assembly,
    assemblyStatus,
    assemblyError,
    modelRequested,
    ppi,
    ppiStatus,
    ppiError,
    shift,
    shiftLoading,
    shiftError,
  }) : null), [result, assembly, assemblyStatus, assemblyError, modelRequested, ppi, ppiStatus, ppiError, shift, shiftLoading, shiftError]);
  const rows = useMemo(() => (ev ? interfaceWorkspaceReadings(ev) : null), [ev]);
  if (!result || !ev || !rows) return null;
  const { model, binding: b, interface: iface } = ev;
  const pdb = data.assembly?.status === "success" ? data.assembly.complexPdb : null;
  const visibleGroups = filterPartnerGroups(ev.groups, { tier, query });
  // Every partner this filter leaves — shown, folded or listed on request — for the status region below the chart.
  const matchedPartners = visibleGroups.reduce((n, g) => n + g.rows.length + (g.folded?.rows.length ?? 0), 0);
  const colCount = 4 + (ev.columns.solved ? 1 : 0) + (ev.columns.site ? 1 : 0);
  const partnerChain = ev.chains.length === 2 ? `${ev.chains[1].id} ${ev.chains[1].label}` : "another chain";
  const assemblyFailed = ev.status.assembly === "error";
  const lookupsFailed = ev.status.lookups === "error";
  const refPhrase = iface.reference ? (iface.reference.partner === `${ev.gene}, other chain` ? `the other ${ev.gene} chain` : iface.reference.partner) : null;
  const callout = [iface.disagreement, iface.fibril?.sentence ?? null, iface.crystal?.sentence ?? null, iface.setAside].filter(Boolean).join(" ");
  const solvedRows: ObservedView[] = [...ev.observed.partners, ...ev.observed.fibrils, ...ev.observed.crystals];
  // When nothing on the track is a chart — no solved, fibril or predicted lane — the card says why
  // and offers the one chart that can exist (Boltz-2, on request). RGS9's track is otherwise three
  // UniProt range chips above silence, and silence reads as a broken graph, not as an absence.
  const noInterfaceChart =
    ev.position !== null &&
    !ev.track.some(l => l.kind === "solved" || l.kind === "predicted") &&
    (ev.observed.availability.state === "empty" || ev.observed.availability.state === "ok");
  const toggleFold = (id: PartnerGroup) => {
    if (workspace.enabled) { workspace.toggleGroup(id); return; }
    setLocalFolds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const modelAction = model.canRequest ? (
    <ActionButton onClick={data.requestModel} icon={<Boxes className="w-3.5 h-3.5" aria-hidden="true" />}>
      {model.state === "failed" ? "Try again" : "Model the complex"}
    </ActionButton>
  ) : null;

  return (
    <div data-evidence-screen data-mechanism="interfaces" className={`ifc-screen @container${workspace.enabled ? " ifc-workspace" : ""}`}>
      <div role="status" aria-live="polite" className="sr-only">
        {iface.verdict === "pending" ? "" : `${ev.finding.headline}`}
      </div>

      <header className="ifc-header">
        <h1 className="screen-title">{evidenceTab('interfaces').label}</h1>
        <p className="screen-tab-description">
          Whether the variant residue sits where another protein touches {ev.gene}, how well that is attested, which proteins it binds, and any predicted change in binding.
        </p>
      </header>

      {/* ── 1. The finding ───────────────────────────────────────────────────── */}
      <section className="ifc-card" aria-labelledby="ifc-finding-title" data-testid="interfaces-finding">
        <div className="ifc-hero__body">
          <div className="ifc-hero__text">
            <div className="ifc-hero__top">
              <span className="eyebrow" id="ifc-finding-title">
                <Waypoints className="w-3.5 h-3.5" />
                Interface context · not an ACMG input
              </span>
              <span className="ev-tier ifc-verdict" data-tone={ev.finding.chipTone} data-testid="interface-verdict">{ev.finding.chip}</span>
            </div>
            <div className="ifc-hero__figure">
              <span className="ifc-figure" data-empty={iface.verdict === "pending" || iface.verdict === "not-measured" || undefined}>
                {iface.observed ? `${iface.observed.k} of ${iface.observed.n}` : iface.reference ? `0 of ${iface.reference.n}` : iface.label}
              </span>
              <span className="ifc-hero__figure-label">
                {iface.observed
                  ? `solved structures place ${ev.residueLabel} at the interface · PDBe-KB`
                  : iface.reference
                    ? `native solved structures place ${ev.residueLabel} at the interface with ${refPhrase} · PDBe-KB`
                    : iface.support}
              </span>
            </div>
            <Prose className="ifc-hero__finding" data-testid="interfaces-finding-sentence">
              <strong>{ev.finding.headline}</strong> {ev.finding.predicate}.
            </Prose>
            {ev.finding.context && <Prose className="ifc-hero__context">{ev.finding.context}</Prose>}
          </div>
          <figure className="ifc-hero__diagram">
            <details className="mx-composition-disclosure" open={!workspace.enabled || undefined}>
              <summary><span className="mx-kicker">Assembly</span><strong>{ev.assembly.label}</strong><span>View composition and qualifications</span></summary>
              <AssemblyDiagram ev={ev} />
            <p className="mx-composition-caption">
              {ev.assembly.label}
              {ev.assembly.qualifier ? ` (${ev.assembly.qualifier.toLowerCase()})` : ""} ·{" "}
              {model.state === "built" ? "modelled" : ev.observed.partners.length ? "solved" : ev.chains.length > 1 ? "as stated" : "single chain"}
            </p>
            </details>
          </figure>
        </div>

        {callout && (
          <div className="ifc-callout" data-tone="neutral" data-testid="interfaces-callout">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{callout}</span>
          </div>
        )}
        {(assemblyFailed || lookupsFailed) && (
          <div role="status" className="ifc-callout" data-tone="warning">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {[assemblyFailed ? data.assemblyError ?? "The assembly service did not answer." : null, lookupsFailed ? data.ppiError ?? "The interaction lookups did not answer." : null]
                .filter(Boolean)
                .join(" ")}
            </span>
            <span className="ifc-callout__action">
              {assemblyFailed && <ActionButton onClick={data.retryAssembly} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton>}
              {!assemblyFailed && lookupsFailed && <ActionButton onClick={data.retryLookups} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton>}
            </span>
          </div>
        )}

        <details className="mx-finding-details" open={!workspace.enabled || undefined}><summary>Source summary and engine record</summary>
        <dl className="ifc-facts">
          {ev.facts.map(f => (
            <div key={f.label} className="ifc-fact">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "ifc-mono" : undefined}>{f.value}</dd>
              <span className="ifc-fact__sub">{f.sub}</span>
            </div>
          ))}
        </dl>
        <div className="ifc-foot">
          <span>Engine record: none. No ACMG criterion reads this tab.</span>
        </div>
        </details>
      </section>

      {/* ── 2. Where on the sequence ──────────────────────────────────────────── */}
      <EvidenceViewTabs tab="interfaces" comparisonLabel="Interface map" />
      <MechanismSelection tab="interfaces" rows={rows} visibleKeys={workspace.view === 'partners' ? visibleGroups.flatMap(g => [...g.rows, ...(openFolds.has(g.id) ? g.folded?.rows ?? [] : [])].map(p => `partner:${p.key}`)) : workspace.comparison ? interfaceMapView(ev, workspace.window === 'near', workspace.hidden).visibleKeys : [...solvedRows.map(p => p.key), 'complex-model', 'binding-change']} />
      <EvidencePanel tab="interfaces">
      {(!workspace.enabled || workspace.comparison) && <>
      <section className="ifc-section" aria-labelledby="ifc-track-title">
        <h2 className="eyebrow" id="ifc-track-title">
          <MapPin className="w-3.5 h-3.5" />
          Where on the sequence
        </h2>
        <div className="ifc-card">
          <InterfaceMapWorkspace ev={ev} lit={workspace.selected ?? lit} onLit={setLit} onOpen={openRow} numbering={interfaceNumberingNote(result)} />
          {noInterfaceChart && (
            <p className="ifc-track__note" data-testid="interface-track-note">
              <span>
                {ev.observed.availability.reason}
                {model.canRequest && " Model the complex with Boltz-2 to predict one; its contacts would be charted here as a lane."}
              </span>
              {model.canRequest && (
                <ActionButton onClick={data.requestModel} icon={<Boxes className="w-3.5 h-3.5" aria-hidden="true" />}>
                  Model the complex
                </ActionButton>
              )}
            </p>
          )}
          {/* The legend only earns its strip when a key exists to explain: a lone variant chip repeats
              the ruler's own label (and the readout head) across a full-width band. */}
          {(ev.track.some(l => l.kind !== "domains") || ev.observed.fibrils.length > 0) && (
            <div className="ifc-foot" aria-label="Legend">
              {ev.track.some(l => l.kind === "solved") && (
                <span className="ifc-legend__item">
                  <i className="ifc-key" data-kind="support" />
                  Solved interface; bar height = share of the pair&apos;s structures with the residue at it
                </span>
              )}
              {ev.observed.fibrils.length > 0 && <span className="ifc-legend__item"><i className="ifc-key" data-kind="fibril" />Amyloid fibril stacking, read apart</span>}
              {ev.track.some(l => l.kind === "predicted") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="predicted" />Predicted interface</span>}
              {ev.track.some(l => l.kind === "sites") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="site" />Mapped site, UniProt</span>}
              {ev.track.some(l => l.kind === "topology") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="membrane" />Membrane segment; cytoplasmic side below the line, outside above</span>}
              {ev.position !== null && <span className="ifc-legend__item"><i className="ifc-key" data-kind="variant" />{ev.residueLabel}</span>}
            </div>
          )}
        </div>
      </section>

      {/* ── 3. Assembly ──────────────────────────────────────────────────────── */}
      {workspace.enabled && <InterfaceOverview ev={ev} />}
      </>}
      {(!workspace.enabled || workspace.view === 'records') && <>
      <section className="ifc-section" aria-labelledby="ifc-assembly-title">
        <h2 className="eyebrow" id="ifc-assembly-title">
          <Boxes className="w-3.5 h-3.5" />
          Assembly
        </h2>
        <div className="ifc-card ifc-table-wrap">
          <table className="ifc-table" data-testid="assembly-readings">
            <thead>
              <tr>
                <th scope="col">Reading</th>
                <th scope="col" colSpan={2}>Detail</th>
                <th scope="col" className="ifc-status">Status</th>
              </tr>
            </thead>

            <tbody data-group="curation">
              <tr className="ifc-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ifc-group__inner">
                    <span className="ifc-group__title">Curated assembly</span>
                    <span className="ifc-group__meta">UniProtKB{ev.uniprotId ? ` ${ev.uniprotId}` : ""} SUBUNIT</span>
                  </span>
                </th>
              </tr>
              {ev.assembly.statements.length ? (
                ev.assembly.statements.map((s, i) => (
                  <tr key={i} data-rule-input={i === 0 || undefined}>
                    <th scope="row" className="ifc-subject">
                      <span className="ifc-subject__name">{s.label}</span>
                      <span className="ifc-subject__note">{i === 0 ? "decides the assembly" : "also stated"}</span>
                    </th>
                    <td className="ifc-quote" colSpan={2}>
                      &ldquo;{s.sentence}&rdquo;
                      {s.family && <span className="ifc-subject__note">Names a family ({s.family}), not a gene: not resolved here. See STRING&apos;s physical partners below.</span>}
                    </td>
                    <td className="ifc-status">
                      <span className="ev-tier" data-tone={s.qualifier ? "muted" : "neutral"}>{s.qualifier ?? "Stated"}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <th scope="row" className="ifc-subject">
                    <span className="ifc-subject__name">SUBUNIT record</span>
                    <span className="ifc-subject__note">curated assembly statement</span>
                  </th>
                  <StateCells
                    label={ENGINE_STATE_LABELS["no-result"]}
                    reason={ev.assembly.subunitText ? `“${ev.assembly.subunitText}” names no assembly.` : "UniProt has no SUBUNIT record for this protein. That is not evidence of a monomer."}
                  />
                </tr>
              )}
            </tbody>

            <tbody data-group="solved">
              <tr className="ifc-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ifc-group__inner">
                    <span className="ifc-group__title">Solved structures</span>
                    <span className="ifc-group__meta">PDBe-KB interface residues, UniProt numbering</span>
                  </span>
                </th>
              </tr>
              {solvedRows.length ? (
                solvedRows.map(p => {
                  const fibril = p.context === "fibril";
                  const crystal = p.context === "crystal";
                  return (
                    <tr
                      key={p.key}
                      id={`ifc-row-${p.key}`}
                      data-reading-key={p.key}
                      data-rule-input={(!fibril && !crystal && p.variantAtInterface) || undefined}
                      data-lit={lit === p.key || undefined}
                      onMouseEnter={() => setLit(p.key)}
                      onMouseLeave={() => setLit(null)}
                    >
                      <th scope="row" className="ifc-subject">
                        <span className="ifc-subject__name"><InspectReadingButton tab="interfaces" readingKey={p.key}>{p.label}</InspectReadingButton></span>
                        <span className="ifc-subject__note ifc-mono">
                          {p.accession}
                          {p.homomeric ? " · same protein" : ""}
                          {p.organism ? ` · ${p.organism}` : ""}
                        </span>
                      </th>
                      <td className="ifc-reason">
                        {p.variantAtInterface ? (
                          <>
                            {ev.residueLabel} {fibril ? "touches a neighbouring fibril chain" : crystal ? "touches another chain outside the deposited assembly" : "at the interface"} in{" "}
                            {p.variantEntries.map((e, i) => (
                              <React.Fragment key={e}>
                                {i ? ", " : ""}
                                <a className="ifc-pdb" href={rcsbUrl(e)} target="_blank" rel="noopener noreferrer">{e.toUpperCase()}</a>
                              </React.Fragment>
                            ))}
                            .{fibril
                              ? " Stacking along a fibril, not a native interface."
                              : crystal
                                ? " The entry's deposited biological assembly is a monomer, so this contact is outside it and is not counted as a native interface."
                                : ` The best-attested residues of this interface are seen in ${p.maxSupport} of ${p.n}.`}
                          </>
                        ) : (
                          `${ev.residueLabel} is not among its ${p.residues.length} interface residues${fibril ? " in fibrils" : crystal ? " in monomer-assembly entries" : ""}.`
                        )}
                      </td>
                      <td className="ifc-num">
                        {p.k} of {p.n}
                        <span className="ifc-unit">{fibril ? "fibril structures" : crystal ? "monomer-assembly entries" : "structures"}</span>
                      </td>
                      <td className="ifc-status">
                        {fibril ? (
                          <span className="ev-tier" data-tone="muted">Fibril</span>
                        ) : crystal ? (
                          <span className="ev-tier" data-tone="muted">Outside assembly</span>
                        ) : (
                          <span className="ev-tier" data-tone={p.variantAtInterface ? "neutral" : "muted"}>{p.variantAtInterface ? "At interface" : "Not at it"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <th scope="row" className="ifc-subject">
                    <span className="ifc-subject__name">Interfaces in the PDB</span>
                    <span className="ifc-subject__note">observed, not predicted</span>
                  </th>
                  <StateCells label={ev.observed.availability.label} reason={ev.observed.availability.reason} />
                </tr>
              )}
              {ev.observed.artefactsShown.map(p => <ArtefactRow key={p.key} p={p} />)}
              {ev.observed.artefactsFold && (
                <>
                  <tr className="ifc-fold">
                    <td colSpan={4}>
                      <span className="ifc-fold__summary">{ev.observed.artefactsFold.summary}</span>
                      <button
                        type="button"
                        className="ifc-link ifc-fold__toggle"
                        aria-expanded={setAsideOpen}
                        aria-controls="ifc-set-aside-list"
                        onClick={() => setSetAsideOpen(o => !o)}
                      >
                        {setAsideOpen ? "Hide names" : `Show ${ev.observed.artefactsFold.rows.length} names`}
                      </button>
                    </td>
                  </tr>
                  {setAsideOpen && (
                    <tr className="ifc-fold__list-row">
                      <td colSpan={4}>
                        <ul className="ifc-chips" id="ifc-set-aside-list" aria-label={`${ev.observed.artefactsFold.rows.length} more set-aside chains`}>
                          {ev.observed.artefactsFold.rows.map(p => (
                            <li key={p.key} className="ifc-chip">
                              <span className="ifc-chip__name">{p.name}</span>
                              <span className="ifc-chip__meta ifc-mono">{p.accession}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>

            <tbody data-group="model">
              <tr className="ifc-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ifc-group__inner">
                    <span className="ifc-group__title">Predicted complex</span>
                    <ResearchGuideButton topic="boltz2" label="About this complex prediction" iconOnly />
                    <span className="ifc-group__meta">
                      Boltz-2 via JapanFold, on request
                      {ev.chains.length > 1 && model.state !== "not-applicable" && model.state !== "not-modelled" ? ` · chains ${ev.chains.map(c => `${c.id} ${c.label}`).join(", ")} · variant on A` : ""}
                    </span>
                  </span>
                </th>
              </tr>
              {model.state === "built" ? (
                <>
                  <tr>
                    <th scope="row" className="ifc-subject">
                      <span className="ifc-subject__name" data-reading-key="complex-model"><InspectReadingButton tab="interfaces" readingKey="complex-model">Interface confidence</InspectReadingButton></span>
                      <span className="ifc-subject__note">ipTM, all interfaces together</span>
                      <ResearchGuideButton topic="iptm" label="Explain interface confidence" iconOnly />
                    </th>
                    <td className="ifc-scale">{model.iptm !== null && <IptmRuler value={model.iptm} band={model.band} />}</td>
                    <td className="ifc-num">{model.iptm !== null ? model.iptm.toFixed(2) : "—"}</td>
                    <td className="ifc-status">
                      <span className="ev-tier" data-tone={model.band ? "neutral" : "muted"}>{model.band ? IPTM_BAND_LABEL[model.band] : ENGINE_STATE_LABELS["no-result"]}</span>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row" className="ifc-subject">
                      <span className="ifc-subject__name">Contacts from {ev.residueLabel}</span>
                      <span className="ifc-subject__note">pTM {model.ptm !== null ? model.ptm.toFixed(2) : "not reported"}</span>
                    </th>
                    <td className="ifc-reason">
                      {model.variantContacts.length
                        ? `Nearest ${model.variantContacts[0].distance.toFixed(1)} Å (${model.variantContacts.map(c => (c.resA === ev.position ? `${partnerChain} ${c.resB}` : `${partnerChain} ${ev.residueLabel}, wild type`)).slice(0, 3).join("; ")})`
                        : model.nearestInterfaceGap !== null
                          ? `None; nearest interface residue ${model.nearestInterfaceGap} away in sequence`
                          : "None"}
                    </td>
                    <td className="ifc-num">{model.variantContacts.length}<span className="ifc-unit">of {model.contactsTotal}</span></td>
                    <td className="ifc-status">
                      <span className="ev-tier" data-tone={model.variantContacts.length ? "neutral" : "muted"}>{model.variantContacts.length ? "At interface" : "No contact"}</span>
                    </td>
                  </tr>
                </>
              ) : (
                <tr>
                  <th scope="row" className="ifc-subject">
                    <span className="ifc-subject__name" data-reading-key="complex-model"><InspectReadingButton tab="interfaces" readingKey="complex-model">Complex model</InspectReadingButton></span>
                    <span className="ifc-subject__note">ipTM, pTM and contacts</span>
                  </th>
                  <StateCells label={model.stateLabel} reason={model.reason} action={modelAction} />
                </tr>
              )}
            </tbody>
          </table>
          <div className="ifc-foot">
            <span>Only chain A carries the variant; a contact in the variant model is not a contact lost.</span>
            <span>ipTM marks are AlphaFold-Multimer&apos;s guidance; Boltz-2 has none of its own.</span>
            {pdb && (
              <button
                type="button"
                className="ifc-link"
                onClick={() => downloadModel(pdb, `${ev.gene}_${(result.metadata?.variant ?? "variant").replace(/[^A-Za-z0-9]+/g, "")}_complex.pdb`)}
              >
                <Download className="w-3 h-3" aria-hidden="true" />
                Download model
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── 4. Partners ──────────────────────────────────────────────────────── */}
      </>}
      {(!workspace.enabled || workspace.view === 'partners') && <>
      <section className="ifc-section" aria-labelledby="ifc-partners-title" aria-busy={ev.status.lookups === "loading" || undefined}>
        <h2 className="eyebrow" id="ifc-partners-title">
          <Handshake className="w-3.5 h-3.5" />
          Partners
        </h2>
        <div className="ifc-card">
          {/* While the lookups run or after they fail, say so above whatever the assembly alone supplies. */}
          {ev.status.lookups !== "ready" && ev.partners.length > 0 && (
            <Statement
              title={ev.status.lookups === "loading" ? "Reading partners" : "Partners not retrieved"}
              action={lookupsFailed ? <ActionButton onClick={data.retryLookups} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton> : undefined}
            >
              {ev.status.lookups === "loading"
                ? `Asking UniProt, IntAct and STRING about ${ev.gene}. The rows below come from the assembly alone.`
                : `${data.ppiError ?? "The interaction lookups did not answer."} The rows below come from the assembly alone; this is not evidence that there are no other partners.`}
            </Statement>
          )}
          {ev.partners.length ? (
            <>
              <div className="ifc-partners__head">
                <PartnerTiers groups={ev.groups} active={tier} onToggle={id => setTier(t => (t === id ? null : id))} />
                <div className="ifc-partners__tools">
                  <label className="ifc-search">
                    <Search className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="sr-only">Find a partner by gene or accession</span>
                    <input
                      type="search"
                      ref={searchInputRef}
                      value={query}
                      placeholder="Find a partner"
                      onChange={e => setQuery(e.target.value.slice(0, PPI_QUERY_MAX))}
                      onKeyDown={e => { if (e.key === "Escape") setQuery(""); }}
                      maxLength={PPI_QUERY_MAX}
                      aria-controls="ifc-partner-grid"
                    />
                    {query && (
                      <button
                        type="button"
                        className="ifc-search__clear"
                        aria-label="Clear search"
                        title="Clear search"
                        // Keep focus in the field so the reader can type again immediately.
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    )}
                  </label>
                  {(tier || query) && (
                    <button type="button" className="ifc-link" onClick={() => { setTier(null); setQuery(""); }}>
                      Show all
                    </button>
                  )}
                </div>
              </div>
              {/* The tier and the query change what the grid holds; the resulting count is announced, not only redrawn. */}
              <p className="sr-only" role="status" aria-live="polite" data-testid="partner-filter-status">
                {matchedPartners === 0
                  ? "No partner matches the current filter."
                  : `Showing ${matchedPartners} partner${matchedPartners === 1 ? "" : "s"}${tier ? ` in “${ev.groups.find(g => g.id === tier)?.title ?? tier}”` : ""}.`}
              </p>
              {visibleGroups.length ? (
                <div className="ifc-table-wrap" role="region" aria-label={`Interaction partners of ${ev.gene}`} tabIndex={0}>
                  <table className="ifc-table ifc-table--partners" data-testid="partner-grid" id="ifc-partner-grid">
                    <thead>
                      <tr>
                        <th scope="col">Partner</th>
                        <th scope="col">Evidence</th>
                        {ev.columns.solved && <th scope="col" className="ifc-num">Solved</th>}
                        <th scope="col">STRING physical</th>
                        <th scope="col">STRING functional</th>
                        {ev.columns.site && <th scope="col" className="ifc-site">Mapped site</th>}
                      </tr>
                    </thead>
                    {visibleGroups.map(g => (
                      <tbody key={g.id} data-group={g.id}>
                        <tr className="ifc-group">
                          <th colSpan={colCount} scope="rowgroup">
                            <span className="ifc-group__inner">
                              <span className="ifc-group__title">{g.title}</span>
                              <span className="ifc-group__meta">{g.meta}</span>
                            </span>
                          </th>
                        </tr>
                        {g.rows.map(p => <PartnerRowView key={p.key} p={p} ev={ev} />)}
                        <FoldedRows g={g} ev={ev} colCount={colCount} open={openFolds.has(g.id)} onToggle={() => toggleFold(g.id)} />
                      </tbody>
                    ))}
                  </table>
                </div>
              ) : (
                <Statement title="No partner matches">
                  {`No partner of ${ev.gene}${tier ? ` in “${ev.groups.find(g => g.id === tier)?.title ?? tier}”` : ""} has a gene or accession containing “${query.trim()}”.`}
                </Statement>
              )}
            </>
          ) : (
            <Statement
              title={ev.status.lookups === "loading" ? "Reading partners" : lookupsFailed ? "Partners not retrieved" : "No partners listed"}
              action={lookupsFailed ? <ActionButton onClick={data.retryLookups} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton> : undefined}
            >
              {ev.status.lookups === "loading"
                ? `Asking UniProt, IntAct and STRING about ${ev.gene}.`
                : [ev.sections.uniprot.reason, ev.sections.stringPhysical.reason].filter(Boolean).join(" ")}
            </Statement>
          )}
          <div className="ifc-foot">
            <span>
              STRING scores are association, not binding strength. Physical: evidence the two bind or share a complex; functional: any
              association (co-expression, text mining, pathways). Ticks at {STRING_CONFIDENCE_CUTS.map(c => c.min.toFixed(2)).reverse().join(", ")} are STRING&apos;s bands
              {ev.string.version ? `; STRING ${ev.string.version}` : ""}. Proteins from another species have no score in the human network.
              {ev.sections.intact.state === "failed" ? ` ${ev.sections.intact.reason}` : ""}
            </span>
            {ev.stringUrl && (
              <a className="ifc-link" href={ev.stringUrl} target="_blank" rel="noopener noreferrer">
                Open in STRING
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── 5. Binding energy change ─────────────────────────────────────────── */}
      </>}
      </EvidencePanel>
      <section className="ifc-section" aria-labelledby="ifc-bind-title">
        <h2 className="eyebrow" id="ifc-bind-title" data-reading-key="binding-change">
          <Zap className="w-3.5 h-3.5" />
          <InspectReadingButton tab="interfaces" readingKey="binding-change">Binding energy change</InspectReadingButton>
        </h2>
        <div className="ifc-card" data-testid="binding-card">
          <div className="ifc-bind__head">
            <ResearchGuideButton topic="ddmut_ppi" label="How to read binding change" />
            <span className="ifc-hero__figure-label">
              ΔΔG_bind · DDMut-PPI on a wild-type complex
              {b.wildType ? ` · ${b.wildType.source === "experimental" ? b.wildType.provenance : `${b.wildType.provenance}${b.wildType.ipTm != null ? `, ipTM ${b.wildType.ipTm.toFixed(2)}` : ""}`}` : ""}
            </span>
            {b.stateLabel && (
              <span className="ev-tier" data-tone={b.state === "failed" ? "warning" : b.state === "pending" || b.state === "running" ? "neutral" : "muted"}>{b.stateLabel}</span>
            )}
          </div>
          {b.state === "ok" && b.value !== null ? (
            <div className="ifc-bind__body">
              <div className="ifc-bind__figure">
                <span className="ifc-bind__value">{b.valueText}</span>
                <span className="ifc-hero__figure-label">{b.directionText}{b.withinError ? ", inside the method's error" : ""}</span>
              </div>
              <BindingRuler value={b.value} />
              <p className="ifc-bind__caption">
                {b.wildType?.source === "experimental"
                  ? `Scored on the solved complex ${b.wildType.pdbId?.toUpperCase()} (chain ${b.wildType.chain}, residue ${b.wildType.authorResidue} in the entry's numbering).`
                  : "Scored on a Boltz-2 model of the wild-type complex: no solved complex of this protein exists."}{" "}
                Negative is weaker binding, in DDMut-PPI&apos;s convention; the shaded band is ± its RMSE. {DDMUT_PPI_PERFORMANCE}
              </p>
            </div>
          ) : (
            <Statement
              title={b.state === "pending" || b.state === "running" ? ENGINE_STATE_LABELS.running : b.state === "failed" ? "No value returned" : b.state === "ready" ? "Not measured yet" : "Not measured"}
              action={
                b.canRequest && b.state !== "running" ? (
                  <ActionButton onClick={data.requestShift} busy={b.state === "pending"} icon={<Zap className="w-3.5 h-3.5" aria-hidden="true" />}>
                    {b.state === "failed" ? "Try again" : "Estimate binding change"}
                  </ActionButton>
                ) : undefined
              }
            >
              {b.reason}
            </Statement>
          )}
        </div>
      </section>
      {workspace.enabled && <details className="mx-guide"><summary>How to read this workspace</summary><p>The sequence map uses UniProt residue numbering. Interface support is counted within each partner and structural context; it is not an effect size or a count of independent experiments. Select a lane or partner to pin its exact evidence.</p><p>Assembly composition is a schematic, not molecular geometry. Fibril and outside-assembly contacts remain separate from native interfaces. Predictions and STRING associations do not establish a measured binding effect.</p></details>}
    </div>
  );
}

export default InterfacesTab;

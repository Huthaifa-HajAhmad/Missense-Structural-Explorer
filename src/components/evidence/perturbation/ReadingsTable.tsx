import React from "react";
import type { TabComponentProps } from "../types";
import { ListChecks } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import { LM_CAVEAT_TEXT, signed, type AvailabilityState, type LmReading, type ModelAction, type PerturbationEvidence, type PhysicalReading } from "../../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../../shared/perturbationModels";
import { directionLabel } from "../../../shared/perturbationSummary";
import { PHYSICAL_EXPLANATIONS } from "../../../shared/researchGuides";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { InspectReadingButton } from "../EvidenceWorkspace";
import { oddsLine, rankLine } from "./format";
import { AvailabilityCell, StatusChip } from "./ModelAvailability";
import { Esm3Rows } from "./Esm3Rows";
import { MarkRuler, RankRuler } from "./Rulers";

/** The FoldX leg's state as the canonical engine label. */
const FOLDX_STATE_LABELS: Record<AvailabilityState, string> = {
  pending: ENGINE_STATE_LABELS.running,
  failed: ENGINE_STATE_LABELS.failed,
  absent: ENGINE_STATE_LABELS["no-result"],
  computed: ENGINE_STATE_LABELS.computed
};

function LmRow({
  lm,
  wt,
  mut,
  selected,
  onAction
}: {
  lm: LmReading;
  wt: string;
  mut: string;
  selected: boolean;
  onAction: (action: ModelAction) => void;
}) {
  const ok = lm.availability.state === "computed";
  const call = ok ? directionLabel(lm, wt, mut) : null;
  const odds = ok ? oddsLine(lm, wt, mut) : null;
  const ranks = ok ? rankLine(lm, wt, mut) : null;
  return (
    <tr data-testid={`ptb-lm-${lm.id}`} data-selected={selected || undefined}>
      <th scope="row" className="ptb-subject">
        <span className="ptb-subject__line">
          <span className="ptb-subject__name">{lm.name}</span>
          <ResearchGuideButton topic={/vesm/i.test(lm.servedBy ?? '') ? 'vesm' : lm.id} label={`About ${lm.name}`} iconOnly />
        </span>
        <span className="ptb-subject__note">{lm.name !== lm.family ? `Standing in for ${lm.family}. ` : ""}{lm.description}</span>
        {lm.caveats.length > 0 && (
          <span className="ptb-caveats ev-caveats">
            {lm.caveats.map(c => (
              <span key={c} className="ev-tier" data-tone="warning" title={LM_CAVEAT_TEXT[c].detail}>{LM_CAVEAT_TEXT[c].label}</span>
            ))}
          </span>
        )}
        {lm.servedBy && <span className="ptb-subject__note ptb-subject__fact">Served by {lm.servedBy}</span>}
        {lm.diagnostics.length > 0 && (
          <details className="ptb-diag">
            <summary>Engine notes</summary>
            <ul>
              {lm.diagnostics.map(d => <li key={d.tier}><strong>{d.tier}:</strong> {d.text}</li>)}
            </ul>
          </details>
        )}
      </th>
      {ok ? (
        <>
          <td className="ptb-num">
            {lm.llr !== null ? signed(lm.llr, 2) : "—"}
            <span className="ptb-unit">ΔLLR, nats</span>
          </td>
          <td className="ptb-scale">
            {lm.rank !== null ? (
              <>
                <RankRuler rank={lm.rank} band={lm.band} nativeRank={lm.nativeRank} flat={lm.direction === "flat"} label={`${lm.name} rank`} />
                <span className="ptb-scale__source">{ranks}{lm.direction === "flat" ? " · not read: flat distribution" : ""}</span>
              </>
            ) : (
              <span className="ptb-dim">No residue rank returned.</span>
            )}
          </td>
          <td className="ptb-status">
            {call ? <span className="ev-tier" data-tone={lm.direction === "flat" ? "muted" : "neutral"}>{call}</span> : <span className="ev-tier" data-tone="muted">{ENGINE_STATE_LABELS["no-result"]}</span>}
            {odds && <span className="ptb-status__sub">{odds}</span>}
            {lm.votes && <span className="ptb-status__sub">Counted in PP3/BP4</span>}
          </td>
        </>
      ) : (
        <>
          <AvailabilityCell a={lm.availability} colSpan={2} onAction={onAction} />
          <td className="ptb-status"><StatusChip a={lm.availability} /></td>
        </>
      )}
    </tr>
  );
}

function PhysicalRow({ r, plottedAbove }: { r: PhysicalReading; plottedAbove: boolean }) {
  const ok = r.availability.state === "computed";
  return (
    <tr data-testid={`ptb-phys-${r.key}`}>
      <th scope="row" className="ptb-subject">
        <span className="ptb-subject__line"><span className="ptb-subject__name">{ok && r.value !== null ? <InspectReadingButton tab="perturbation" readingKey={`phys:${r.key}`}>{r.name}</InspectReadingButton> : r.name}</span><ResearchGuideButton topic={PHYSICAL_EXPLANATIONS[r.key]} label={`Explain ${r.name}`} iconOnly /></span>
        <span className="ptb-subject__note">{r.description}</span>
        {r.note && ok && <span className="ptb-subject__note ptb-subject__fact">{r.note}</span>}
      </th>
      {ok ? (
        <>
          <td className="ptb-num">
            {r.text}
            {r.unit && <span className="ptb-unit">{r.unit}</span>}
          </td>
          <td className="ptb-scale">
            {plottedAbove ? (
              <span className="ptb-dim">Plotted above</span>
            ) : r.scale && r.value !== null ? (
              <>
                <MarkRuler value={r.value} min={r.scale.min} max={r.scale.max} marks={r.marks} label={r.name} format={n => n.toFixed(1)} />
                <span className="ptb-scale__source">{r.marks.map(m => m.label).join(" · ")}</span>
              </>
            ) : null}
          </td>
          <td className="ptb-status">
            {r.call ? <span className="ev-tier" data-tone={r.call.tone}>{r.call.label}</span> : <span className="ptb-dim">—</span>}
          </td>
        </>
      ) : (
        <>
          <td className="ptb-reason" colSpan={2}>{r.availability.state === "pending" ? <span className="ptb-dim">Still being computed for this variant.</span> : r.availability.reason}</td>
          <td className="ptb-status"><StatusChip a={r.availability} /></td>
        </>
      )}
    </tr>
  );
}

/**
 * Tier 2, the readings: one table where every source is a row on its own axis. `all` (the single-page
 * layout) shows every group; each workspace view shows only its own group.
 */
export function ReadingsTable({ evidence, view, selectedId, onAction, onNavigateToView }: {
  evidence: PerturbationEvidence;
  view: "all" | "records" | "embeddings";
  selectedId: PerturbationModelId | null;
  onAction: (action: ModelAction) => void;
  onNavigateToView?: TabComponentProps["onNavigateToView"];
}) {
  const wt = evidence.residues.wtLabel || "native";
  const mut = evidence.residues.mutLabel || "variant";
  const clashes = evidence.physical.clashCounts;
  const contacts = evidence.physical.contactChange;
  return (
    <section className="ptb-section" aria-labelledby="ptb-readings-title">
      <h2 className="eyebrow" id="ptb-readings-title">
        <ListChecks className="w-3.5 h-3.5" />
        {view === 'embeddings' ? 'Sequence embeddings' : view === 'records' ? 'Packing & geometry' : 'Readings'}
      </h2>
      <div className="ptb-card ptb-table-wrap">
        <table className="ptb-table" data-testid="perturbation-readings">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="ptb-num">Value</th>
              <th scope="col" title="The reading on its own axis; every mark on this tab is app-defined">Position on scale</th>
              <th scope="col" className="ptb-status">Reading</th>
            </tr>
          </thead>
          {view === 'all' && <tbody data-group="lm">
            <tr className="ptb-group">
              <th colSpan={4} scope="rowgroup">
                <span className="ptb-group__inner">
                  <span className="ptb-group__title">Protein language models</span>
                  <span className="ptb-group__meta">Each on its own scale — read the direction and the odds, not the size of ΔLLR across rows</span>
                </span>
              </th>
            </tr>
            {evidence.lms.map(l => (
              <LmRow key={l.id} lm={l} wt={wt} mut={mut} selected={selectedId === l.id} onAction={onAction} />
            ))}
          </tbody>}
          {view !== 'embeddings' && <tbody data-group="foldx">
            <tr className="ptb-group">
              <th colSpan={4} scope="rowgroup">
                <span className="ptb-group__inner">
                  <span className="ptb-group__title">FoldX mutant model</span>
                  <span className="ptb-group__meta">
                    {evidence.physical.rigidBackbone ? "Fixed backbone · " : ""}
                    {evidence.physical.runs ? `${evidence.physical.runs} runs · ` : ""}
                    energy components and local geometry, not stability
                  </span>
                </span>
              </th>
            </tr>
            {evidence.physical.state === "computed" ? (
              evidence.physical.readings.map(r => (
                <PhysicalRow key={r.key} r={r} plottedAbove={view === 'records' && (
                  ((r.key === 'vdw' || r.key === 'elec') && r.value !== null) || (r.key === 'clash' && clashes !== null) || (r.key === 'contacts' && contacts !== null)
                )} />
              ))
            ) : (
              <tr data-testid="ptb-foldx-absent">
                <th scope="row" className="ptb-subject">
                  <span className="ptb-subject__name">FoldX</span>
                  <span className="ptb-subject__note">Builds the variant into the structure and scores its packing.</span>
                </th>
                <td className="ptb-reason" colSpan={2}>
                  {evidence.physical.reason}
                  {evidence.physical.state !== "pending" && onNavigateToView && (
                    <span className="ptb-actions">
                      <button type="button" className="ptb-link" onClick={() => onNavigateToView("energetics")}>Open Energetics</button>
                    </span>
                  )}
                </td>
                <td className="ptb-status">
                  <StatusChip a={{ state: evidence.physical.state, label: FOLDX_STATE_LABELS[evidence.physical.state] }} />
                </td>
              </tr>
            )}
          </tbody>}
          {view !== 'records' && evidence.esm3 && (
            <tbody data-group="esm3">
              <tr className="ptb-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ptb-group__inner">
                    <span className="ptb-group__title">Sequence embeddings · exploratory</span>
                    <span className="ptb-group__meta">Hypothesis-generating; not validated against any outcome</span>
                  </span>
                </th>
              </tr>
              <Esm3Rows evidence={evidence} />
            </tbody>
          )}
        </table>
        <div className="ptb-table-foot" aria-label="Legend">
          {view === 'all' && <>
          <span className="ptb-legend__item"><i className="ptb-legend__marker" />Variant ({mut})</span>
          <span className="ptb-legend__item"><i className="ptb-legend__native" />Native ({wt})</span>
          <span className="ptb-legend__item"><span className="ptb-legend__band" aria-hidden="true"><i /><i /><i /><i /></span>Rank bands, 1 → 20</span>
          </>}
          <span className="ptb-legend__item"><i className="ptb-legend__tick" />App-defined reading mark</span>
          {view !== 'embeddings' && evidence.physical.runsIdentical && (
            <span className="ptb-legend__item">
              FoldX runs identical (SD 0.00) — no run-to-run spread, not a precision claim
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

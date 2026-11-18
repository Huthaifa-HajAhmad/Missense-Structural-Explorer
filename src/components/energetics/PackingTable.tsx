import { ListChecks } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import type { AvailabilityState, PackingEvidence, PhysicalReading, ReadingAvailability } from "../../shared/packingEvidence";
import { PHYSICAL_EXPLANATIONS } from "../../shared/researchGuides";
import { ResearchGuideButton } from "../knowledge/ResearchGuideButton";
import { MarkRuler } from "./MarkRuler";

/** The FoldX leg's state as the canonical engine label. */
const FOLDX_STATE_LABELS: Record<AvailabilityState, string> = {
  pending: ENGINE_STATE_LABELS.running,
  failed: ENGINE_STATE_LABELS.failed,
  absent: ENGINE_STATE_LABELS["no-result"],
  computed: ENGINE_STATE_LABELS.computed
};

function StatusChip({ a }: { a: Pick<ReadingAvailability, "state" | "label"> }) {
  return (
    <span className="ev-tier" data-tone={a.state === "pending" ? "neutral" : a.state === "failed" ? "warning" : "muted"}>
      {a.label}
    </span>
  );
}

/** True when the figures card above already draws this reading, so its row says so instead of drawing it twice. */
function plottedAbove(r: PhysicalReading, packing: PackingEvidence): boolean {
  if (r.key === "vdw" || r.key === "elec") return r.value !== null;
  if (r.key === "clash") return packing.clashCounts !== null;
  return r.key === "contacts" && packing.contactChange !== null;
}

function ScaleCell({ r, plotted }: { r: PhysicalReading; plotted: boolean }) {
  if (plotted) return <span className="pkg-dim">Plotted above</span>;
  if (!r.scale || r.value === null) return null;
  return (
    <>
      <MarkRuler value={r.value} min={r.scale.min} max={r.scale.max} marks={r.marks} label={r.name} format={n => n.toFixed(1)} />
      <span className="pkg-scale__source">{r.marks.map(m => m.label).join(" · ")}</span>
    </>
  );
}

function PhysicalRow({ r, plotted }: { r: PhysicalReading; plotted: boolean }) {
  const ok = r.availability.state === "computed";
  return (
    <tr data-testid={`pkg-phys-${r.key}`}>
      <th scope="row" className="pkg-subject">
        <span className="pkg-subject__line"><span className="pkg-subject__name">{r.name}</span><ResearchGuideButton topic={PHYSICAL_EXPLANATIONS[r.key]} label={`Explain ${r.name}`} iconOnly /></span>
        <span className="pkg-subject__note">{r.description}</span>
        {r.note && ok && <span className="pkg-subject__note pkg-subject__fact">{r.note}</span>}
      </th>
      {ok ? (
        <>
          <td className="pkg-num">
            {r.text}
            {r.unit && <span className="pkg-unit">{r.unit}</span>}
          </td>
          <td className="pkg-scale"><ScaleCell r={r} plotted={plotted} /></td>
          <td className="pkg-status">
            {r.call ? <span className="ev-tier" data-tone={r.call.tone}>{r.call.label}</span> : <span className="pkg-dim">—</span>}
          </td>
        </>
      ) : (
        <>
          <td className="pkg-reason" colSpan={2}>{r.availability.state === "pending" ? <span className="pkg-dim">Still being computed for this variant.</span> : r.availability.reason}</td>
          <td className="pkg-status"><StatusChip a={r.availability} /></td>
        </>
      )}
    </tr>
  );
}

/** One row per FoldX physical reading; every reading is on its own axis and none is stability. */
export function PackingTable({ packing }: { packing: PackingEvidence }) {
  return (
    <section className="pkg-section" aria-labelledby="pkg-readings-title">
      <h2 className="eyebrow" id="pkg-readings-title">
        <ListChecks className="w-3.5 h-3.5" />
        Readings
      </h2>
      <div className="pkg-card pkg-table-wrap">
        <table className="pkg-table" data-testid="packing-readings">
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col" className="pkg-num">Value</th>
              <th scope="col" title="The reading on its own axis; every mark here is app-defined">Position on scale</th>
              <th scope="col" className="pkg-status">Reading</th>
            </tr>
          </thead>
          <tbody>
            <tr className="pkg-group">
              <th colSpan={4} scope="rowgroup">
                <span className="pkg-group__inner">
                  <span className="pkg-group__title">FoldX mutant model</span>
                  <span className="pkg-group__meta">
                    {packing.rigidBackbone ? "Fixed backbone · " : ""}
                    {packing.runs ? `${packing.runs} runs · ` : ""}
                    energy components and local geometry, not stability
                  </span>
                </span>
              </th>
            </tr>
            {packing.state === "computed" ? (
              packing.readings.map(r => <PhysicalRow key={r.key} r={r} plotted={plottedAbove(r, packing)} />)
            ) : (
              <tr data-testid="pkg-foldx-absent">
                <th scope="row" className="pkg-subject">
                  <span className="pkg-subject__name">FoldX</span>
                  <span className="pkg-subject__note">Builds the variant into the structure and scores its packing.</span>
                </th>
                <td className="pkg-reason" colSpan={2}>{packing.reason}</td>
                <td className="pkg-status"><StatusChip a={{ state: packing.state, label: FOLDX_STATE_LABELS[packing.state] }} /></td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="pkg-table-foot" aria-label="Legend">
          <span className="pkg-legend__item"><i className="pkg-legend__tick" />App-defined reading mark</span>
          {packing.runsIdentical && (
            <span className="pkg-legend__item">FoldX runs identical (SD 0.00) — no run-to-run spread, not a precision claim</span>
          )}
        </div>
      </div>
    </section>
  );
}

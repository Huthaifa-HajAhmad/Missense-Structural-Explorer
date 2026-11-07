import { Info, ListChecks } from "lucide-react";
import { ENGINE_STATE_LABELS, type EnergyEngineId, type EnergyUnit } from "../../shared/engineStatus";
import {
  DDG_AXIS,
  ENERGETICS_CAVEAT_TEXT,
  ENERGETICS_GROUP_LABEL,
  ENERGETICS_GROUP_NOTE,
  absenceText,
  foldxErrorInPlainWords,
  groupEnergeticsReadings,
  markText,
  signedDdgNumber,
  type EnergeticsEvidence,
  type EnergeticsReading,
} from "../../shared/energeticsEvidence";
import { foldxBandCaveat, foldxMeasuredError } from "../../shared/foldxRepairMode";
import { DdgRuler } from "./DdgRuler";

function CaveatChips({ caveats, inline = false }: { caveats: EnergeticsReading["caveats"]; inline?: boolean }) {
  if (caveats.length === 0) return null;
  return (
    <span className={`nrg-caveats ev-caveats${inline ? " nrg-caveats--inline" : ""}`}>
      {caveats.map(c => (
        <span
          key={c}
          className="ev-tier"
          data-tone={c === "excluded" || c === "protvar-stand-in" ? "muted" : "warning"}
          title={ENERGETICS_CAVEAT_TEXT[c].detail}
        >
          {ENERGETICS_CAVEAT_TEXT[c].label}
        </span>
      ))}
    </span>
  );
}

function ReadingRow({
  reading,
  unit,
  onKnowledge,
  selected,
  onSelect,
}: {
  reading: EnergeticsReading;
  unit: EnergyUnit;
  onKnowledge: (key: string) => void;
  selected: boolean;
  onSelect: (key: EnergyEngineId) => void;
}) {
  const has = reading.ddg !== null;
  const state = reading.outcome.state;
  const running = state === "running" || state === "skipped";
  const ddgText = has ? signedDdgNumber(reading.ddg, unit) : null;
  const isTitleCaveat = (c: EnergeticsReading["caveats"][number]) => c === "unrepaired-template" || (reading.key === "rasp" && c === "rosetta-surrogate");
  const titleCaveats = reading.caveats.filter(isTitleCaveat);
  const detailCaveats = reading.caveats.filter(c => !isTitleCaveat(c));
  return (
    <tr data-testid={`energetics-${reading.key}`} data-state={state} data-selected={selected}>
      <th scope="row">
        <span className="nrg-subject__line">
          <button type="button" className="nrg-method-button" aria-pressed={selected} onClick={() => onSelect(reading.key)}>{reading.name}</button>
          <button
            type="button"
            className="nrg-info"
              data-explanation-topic={reading.knowledgeKey}
            onClick={() => onKnowledge(reading.knowledgeKey)}
            aria-label={`About ${reading.name}`}
            title="Method details and citation"
          >
            <Info className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <CaveatChips caveats={titleCaveats} inline />
        </span>
        <span className="nrg-subject__note">{reading.description}</span>
        <CaveatChips caveats={detailCaveats} />
        {reading.note && <span className="nrg-subject__note nrg-subject__fact">{reading.note}</span>}
        {foldxErrorInPlainWords(reading, unit) && <span className="nrg-subject__note nrg-subject__fact" data-testid="foldx-error-plain">{foldxErrorInPlainWords(reading, unit)}</span>}
      </th>
      <td className="nrg-num">
        {has ? (
          <>
            {ddgText}
            <span className="nrg-unit">{unit}</span>
            {reading.key === "foldx" && (
              // The benchmark's error for the repair this value actually got, beside the number rather
              // than only in the method note: the 0.5 / 1.5 marks are far finer than that error.
              <span
                className="nrg-num__error"
                data-testid="foldx-measured-error"
                title={foldxBandCaveat(reading.caveats.includes("local-repair"))}
              >
                ±{foldxMeasuredError(reading.caveats.includes("local-repair")).rmse.toFixed(1)} vs measured
              </span>
            )}
          </>
        ) : (
          <span className="nrg-dim">—</span>
        )}
      </td>
      {has ? (
        <td className="nrg-scale">
          <DdgRuler reading={reading} unit={unit} />
        </td>
      ) : (
        <td className="nrg-scale nrg-reason">
          {running ? (
            <span className="nrg-dim">{reading.outcome.reason}</span>
          ) : (
            // The server's own error text stays in the inspector's disclosure; the row gives the reason.
            absenceText(reading)
          )}
        </td>
      )}
      <td className="nrg-status">
        {has ? (
          <>
            <span className="ev-tier" data-tone={reading.callTone}>
              {reading.callLabel ?? "—"}
            </span>
            {reading.counted && <span className="nrg-call__sub">local mark {markText(reading.strongMark, unit)}</span>}
          </>
        ) : (
          <span className="ev-tier" data-tone={running ? "neutral" : reading.outcome.tone === "danger" ? "danger" : reading.outcome.tone === "warn" ? "warning" : "muted"}>
            {reading.outcome.label || ENGINE_STATE_LABELS[state]}
          </span>
        )}
      </td>
    </tr>
  );
}

/** Engine records: every engine a row, grouped by method family, with its value on a shared axis. */
export function ReadingsTable({
  evidence,
  unit,
  selected,
  onSelect,
  onKnowledge,
}: {
  evidence: EnergeticsEvidence;
  unit: EnergyUnit;
  selected: EnergyEngineId | null;
  onSelect: (key: EnergyEngineId) => void;
  onKnowledge: (key: string) => void;
}) {
  return (
        <section className="nrg-section" aria-labelledby="nrg-readings-title">
          <h2 className="eyebrow" id="nrg-readings-title">
            <ListChecks className="w-3.5 h-3.5" aria-hidden="true" />
            Engine readings
          </h2>
          <div className="nrg-card nrg-table-wrap">
            <table className="nrg-table" data-testid="energetics-readings">
              <colgroup>
                <col className="nrg-col-engine" />
                <col className="nrg-col-value" />
                <col />
                <col className="nrg-col-call" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Engine</th>
                  <th scope="col" className="nrg-num">ΔΔG</th>
                  <th scope="col" title={`Canonical ΔΔG on a shared ${markText(DDG_AXIS.min, unit)} to ${markText(DDG_AXIS.max, unit)} ${unit} axis, with the engine's own local marks dashed`}>
                    Position on ΔΔG axis
                  </th>
                  <th scope="col" className="nrg-status">Call</th>
                </tr>
              </thead>
              {groupEnergeticsReadings(evidence.readings).map(({ group, rows }) => (
                <tbody key={group} data-group={group}>
                  <tr className="nrg-group">
                    <th colSpan={4} scope="rowgroup">
                      <span className="nrg-group__inner">
                        <span className="nrg-group__title">{ENERGETICS_GROUP_LABEL[group]}</span>
                        <span className="nrg-group__meta">{ENERGETICS_GROUP_NOTE[group]}</span>
                      </span>
                    </th>
                  </tr>
                  {rows.map(r => (
                    <ReadingRow key={r.key} reading={r} unit={unit} onKnowledge={onKnowledge} selected={selected === r.key} onSelect={onSelect} />
                  ))}
                </tbody>
              ))}
            </table>
            <div className="nrg-table-foot" aria-label="Legend">
              <span className="nrg-legend__item">Positive = destabilizing; DynaMut2 and DDMut signs normalized</span>
              <span className="nrg-legend__item"><i className="nrg-legend__tick" />Local destabilizing mark (not published)</span>
              <span className="nrg-legend__item"><i className="nrg-legend__tick" data-side="stabilizing" />Local stabilizing mark</span>
              <span className="nrg-legend__item"><i className="nrg-legend__marker" />This variant</span>
              <span className="nrg-legend__item"><i className="nrg-legend__marker" data-off-scale />Beyond the axis</span>
            </div>
          </div>
        </section>
  );
}

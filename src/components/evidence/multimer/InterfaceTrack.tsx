import React from "react";
import type { MultimerEvidence } from "../../../shared/multimerEvidence";

/**
 * InterfaceTrack — where along the sequence each interface lies, and where the variant falls.
 *
 * One shared axis, residue 1 to the protein's length, with a row per reading:
 *   domains         UniProt's Domain features, named, for orientation;
 *   predicted       residues of the variant's chain that touch another chain in the Boltz-2 model;
 *   one row per     partner in solved PDB structures (PDBe-KB), most-observed first.
 * A single vertical rule marks the variant across every row, so "is it inside an interface" is read
 * by eye in one place instead of across tables.
 *
 * HTML with percentage positions rather than SVG, so labels stay crisp at any column width.
 */

const MAX_PARTNER_ROWS = 5;

function niceTicks(length: number): number[] {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find(s => length / s <= 6) ?? 10000;
  const out: number[] = [];
  for (let v = step; v < length - step * 0.4; v += step) out.push(v);
  return out;
}

/** Collapse consecutive residues into runs so a 40-residue interface is 1 element, not 40. */
function runs(residues: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of residues) {
    const last = out[out.length - 1];
    if (last && r <= last[1] + 1) last[1] = r;
    else out.push([r, r]);
  }
  return out;
}

function Row({
  label,
  sub,
  residues,
  length,
  kind,
  hit,
}: {
  label: string;
  sub?: string;
  residues: number[];
  length: number;
  kind: "predicted" | "solved";
  hit: boolean;
}) {
  const pct = (v: number) => ((v - 1) / Math.max(1, length - 1)) * 100;
  return (
    <div className="mlt-track__row" data-kind={kind}>
      <div className="mlt-track__label">
        <span className="mlt-track__name" title={label}>{label}</span>
        {sub && <span className="mlt-track__sub">{sub}</span>}
      </div>
      <div
        className="mlt-track__lane"
        role="img"
        aria-label={`${label}: ${residues.length} interface residue${residues.length === 1 ? "" : "s"}${hit ? ", including the variant" : ", not including the variant"}`}
      >
        {runs(residues).map(([s, e]) => (
          <span
            key={s}
            className="mlt-track__mark"
            style={{ left: `${pct(s)}%`, width: `max(2px, ${pct(e + 1) - pct(s)}%)` }}
            title={s === e ? `${s}` : `${s}–${e}`}
          />
        ))}
      </div>
    </div>
  );
}

export function InterfaceTrack({ ev }: { ev: MultimerEvidence }) {
  const partnerRows = ev.experimental.partners.slice(0, MAX_PARTNER_ROWS);
  const hidden = ev.experimental.partners.length - partnerRows.length;
  const maxSeen = Math.max(
    ev.position ?? 0,
    ...ev.model.footprint,
    ...ev.experimental.partners.flatMap(p => p.residues.slice(-1)),
    ...ev.domains.map(d => d.end)
  );
  const length = Math.max(ev.sequenceLength ?? 0, maxSeen, 10);
  const pct = (v: number) => ((v - 1) / Math.max(1, length - 1)) * 100;
  const variantPct = ev.position ? pct(ev.position) : null;

  return (
    <div className="mlt-track" data-testid="interface-track">
      <div className="mlt-track__row mlt-track__row--axis" aria-hidden="true">
        <div className="mlt-track__label" />
        <div className="mlt-track__axis">
          <span data-edge="start">1</span>
          {niceTicks(length).map(t => (
            <span key={t} style={{ left: `${pct(t)}%` }}>{t}</span>
          ))}
          <span data-edge="end" style={{ left: "100%" }}>{length}</span>
        </div>
      </div>

      <div className="mlt-track__body">
        {variantPct !== null && (
          <div className="mlt-track__variant" style={{ left: `calc(var(--mlt-track-label) + (100% - var(--mlt-track-label)) * ${variantPct / 100})` }}>
            <span className="mlt-track__variant-label">{ev.residueLabel}</span>
          </div>
        )}

        <div className="mlt-track__row" data-kind="domains">
          <div className="mlt-track__label">
            <span className="mlt-track__name">Domains</span>
            <span className="mlt-track__sub">UniProt</span>
          </div>
          <div className="mlt-track__lane mlt-track__lane--domains">
            {ev.domains.length ? (
              ev.domains.map(d => (
                <span
                  key={`${d.start}-${d.end}`}
                  className="mlt-track__domain"
                  style={{ left: `${pct(d.start)}%`, width: `${pct(d.end + 1) - pct(d.start)}%` }}
                  title={`${d.name} · ${d.start}–${d.end}`}
                >
                  <span className="mlt-track__domain-name">{d.name}</span>
                </span>
              ))
            ) : (
              <span className="mlt-track__none">No domains annotated</span>
            )}
          </div>
        </div>

        {ev.model.state === "built" && (
          <Row
            label="Predicted complex"
            sub={`chain A · ${ev.model.footprint.length} residues`}
            residues={ev.model.footprint}
            length={length}
            kind="predicted"
            hit={ev.model.variantContacts.length > 0}
          />
        )}

        {partnerRows.map(p => (
          <Row
            key={p.accession}
            label={p.label}
            sub={`solved · ${p.pdbEntries.length ? `${p.pdbEntries.length} PDB entr${p.pdbEntries.length === 1 ? "y" : "ies"}` : p.accession}`}
            residues={p.residues}
            length={length}
            kind="solved"
            hit={p.variantAtInterface}
          />
        ))}

        {ev.model.state !== "built" && partnerRows.length === 0 && (
          <div className="mlt-track__row" data-kind="empty">
            <div className="mlt-track__label">
              <span className="mlt-track__name">Interfaces</span>
            </div>
            <div className="mlt-track__lane mlt-track__lane--empty">
              <span className="mlt-track__none">
                {ev.status === "loading" ? "Being read" : "No modelled or solved interface to place on the sequence"}
              </span>
            </div>
          </div>
        )}
      </div>

      {hidden > 0 && <p className="mlt-track__more">{hidden} more partner{hidden === 1 ? "" : "s"} in the readings below.</p>}
    </div>
  );
}

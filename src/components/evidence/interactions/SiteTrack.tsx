import React from "react";
import type { InteractionsEvidence } from "../../../shared/interactionsEvidence";

/**
 * SiteTrack — where along the sequence each partner binds, and where the variant falls.
 *
 * One shared axis, residue 1 to the protein's length, and one row per PARTNER (the Multimer tab's
 * track is one row per reading; this one answers "which partner's site is it near"). Each row
 * carries two marks on the same lane:
 *   outlined box — a site UniProt maps ("Interaction with UBA3"), clay when it contains the variant;
 *   solid bar    — residues at that partner's interface in solved PDB structures (PDBe-KB).
 * A single vertical rule marks the variant across every row.
 */

function niceTicks(length: number): number[] {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find(s => length / s <= 6) ?? 10000;
  const out: number[] = [];
  for (let v = step; v < length - step * 0.4; v += step) out.push(v);
  return out;
}

/** Consecutive residues as runs, so a 40-residue interface is one element, not forty. */
function runs(residues: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const r of [...residues].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && r <= last[1] + 1) last[1] = r;
    else out.push([r, r]);
  }
  return out;
}

export function SiteTrack({ ev }: { ev: InteractionsEvidence }) {
  const maxSeen = Math.max(
    ev.position ?? 0,
    ...ev.track.flatMap(r => [...r.mapped.map(m => m.end), ...r.solved.slice(-1)]),
    10
  );
  const length = Math.max(ev.sequenceLength ?? 0, maxSeen);
  const pct = (v: number) => ((v - 1) / Math.max(1, length - 1)) * 100;
  const variantPct = ev.position ? pct(ev.position) : null;

  const emptyText =
    ev.status === "loading"
      ? "Being read"
      : ev.sections.uniprot.state === "ok" || ev.sections.uniprot.state === "empty" || ev.sections.pdbe.state === "ok" || ev.sections.pdbe.state === "empty"
        ? "No mapped site or solved interface to place on the sequence"
        : "Sites and solved structures were not read";

  return (
    <div className="itx-track" data-testid="site-track">
      <div className="itx-track__row itx-track__row--axis" aria-hidden="true">
        <div className="itx-track__label" />
        <div className="itx-track__axis">
          <span data-edge="start">1</span>
          {niceTicks(length).map(t => (
            <span key={t} style={{ left: `${pct(t)}%` }}>{t}</span>
          ))}
          <span data-edge="end" style={{ left: "100%" }}>{length}</span>
        </div>
      </div>

      <div className="itx-track__body">
        {variantPct !== null && (
          <div className="itx-track__variant" style={{ left: `calc(var(--itx-track-label) + (100% - var(--itx-track-label)) * ${variantPct / 100})` }}>
            <span className="itx-track__variant-label">{ev.residueLabel}</span>
          </div>
        )}

        {ev.track.length ? (
          ev.track.map(row => (
            <div key={row.key} className="itx-track__row">
              <div className="itx-track__label">
                <span className="itx-track__name" title={row.label}>{row.label}</span>
                <span className="itx-track__sub">{row.sub}</span>
              </div>
              <div
                className="itx-track__lane"
                role="img"
                aria-label={`${row.label}: ${[
                  row.mapped.length ? `mapped sites at ${row.mapped.map(m => (m.start === m.end ? m.start : `${m.start} to ${m.end}`)).join(", ")}` : null,
                  row.solved.length ? `${row.solved.length} interface residues in solved structures` : null,
                ].filter(Boolean).join("; ")}; ${row.hit ? "includes" : "does not include"} ${ev.residueLabel}`}
              >
                {runs(row.solved).map(([s, e]) => (
                  <span
                    key={`s${s}`}
                    className="itx-track__solved"
                    style={{ left: `${pct(s)}%`, width: `max(2px, ${pct(e + 1) - pct(s)}%)` }}
                    title={s === e ? `Solved interface ${s}` : `Solved interface ${s}–${e}`}
                  />
                ))}
                {row.mapped.map(m => (
                  <span
                    key={`m${m.start}-${m.end}`}
                    className="itx-track__site"
                    data-hit={m.hit || undefined}
                    style={{ left: `${pct(m.start)}%`, width: `max(4px, ${pct(m.end + 1) - pct(m.start)}%)` }}
                    title={m.title}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="itx-track__row">
            <div className="itx-track__label">
              <span className="itx-track__name">Sites</span>
            </div>
            <div className="itx-track__lane itx-track__lane--empty">
              <span className="itx-track__none">{emptyText}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

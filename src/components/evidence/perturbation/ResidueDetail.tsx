import React from "react";
import type { LmReading, PerturbationEvidence } from "../../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../../shared/perturbationModels";
import { ENTROPY_MARKS } from "../../../shared/modelCalibration";

/**
 * Residue-level detail for ONE language model: its distribution over the 20 residues at the site
 * and its per-residue embedding shift across ±10 residues. These are a different kind of evidence
 * from the table above (a distribution and a trace, not a score on an axis), so they get their own
 * panel, and they are shown for one model at a time because neither is comparable across models.
 *
 * Replaced ResiduePreferenceList + EmbeddingShiftChart. Matching still happens on one-letter codes
 * (the payload's alphabet), which is the defect d9e97e5 fixed; the shift is labelled Euclidean for
 * every model because the sidecar computes an L2 norm for all three (ESMC was called cosine), and
 * the "Max" header — which printed the shift AT the site — now says "at site".
 */

const pctText = (p: number) => (p * 100 < 0.01 ? "<0.01%" : `${(p * 100).toFixed(2)}%`);

function Preferences({ lm, wtCode, mutCode, wtLabel, mutLabel }: { lm: LmReading; wtCode: string; mutCode: string; wtLabel: string; mutLabel: string }) {
  if (lm.preferences.length === 0) {
    return (
      <p className="ptb-empty">
        <strong>No residue distribution</strong>
        This model returned no per-residue probabilities for the site.
      </p>
    );
  }
  const max = lm.preferences[0].prob || 1;
  // DOM stays in rank order; CSS flows it down two columns (1–10, 11–20) and back to one when narrow.
  const ordered = lm.preferences;
  const rows = Math.ceil(ordered.length / 2);
  return (
    <>
      <p className="ptb-detail__label">
        <span>Residue distribution at the site</span>
        <span>
          {wtCode && <span className="ptb-key"><i />Native {wtLabel}</span>}{" "}
          {mutCode && <span className="ptb-key" data-role="variant"><i />Variant {mutLabel}</span>}
        </span>
      </p>
      <ol className="ptb-prefs" style={{ ["--ptb-rows" as string]: rows } as React.CSSProperties} aria-label={`${lm.family} probability for each residue at the site, most to least preferred`}>
        {ordered.map(p => {
          const rank = ordered.indexOf(p) + 1;
          const role = p.aa === wtCode ? "native" : p.aa === mutCode ? "variant" : undefined;
          return (
            <li key={p.aa} className="ptb-pref" data-role={role} value={rank}>
              <span className="ptb-pref__aa">{rank}. {p.aa}</span>
              <span className="ptb-pref__bar" aria-hidden="true">
                <i style={{ width: `${(p.prob / max) * 100}%` }} />
              </span>
              <span className="ptb-pref__p">{pctText(p.prob)}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function ShiftTrace({ lm, position }: { lm: LmReading; position: number | null }) {
  const w = lm.embedding.window;
  if (w.length === 0) {
    return (
      <>
        <p className="ptb-detail__label"><span>Embedding shift, ±10 residues</span></p>
        <p className="ptb-empty">
          <strong>No shift window</strong>
          {lm.embedding.absentReason}
        </p>
      </>
    );
  }
  const W = 300, H = 120, L = 30, R = 6, T = 8, B = 20;
  const maxShift = Math.max(...w.map(d => d.shift)) || 1;
  const x = (i: number) => L + (i / Math.max(1, w.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / (maxShift * 1.1)) * (H - T - B);
  const path = w.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.shift).toFixed(1)}`).join(" ");
  const area = `${path} L${x(w.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const siteIndex = position !== null ? w.findIndex(d => d.position === position) : -1;
  const mean = w.reduce((a, d) => a + d.shift, 0) / w.length;
  return (
    <>
      <p className="ptb-detail__label">
        <span>Embedding shift, ±10 residues</span>
        <span className="ptb-mono">
          at site {lm.embedding.atSite !== null ? lm.embedding.atSite.toFixed(2) : "—"} · mean {mean.toFixed(2)}
        </span>
      </p>
      <svg
        className="ptb-trace"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${lm.family} ${lm.embedding.metric} between wild-type and mutant embeddings for residues ${w[0].position} to ${w[w.length - 1].position}; peak ${maxShift.toFixed(2)}${siteIndex >= 0 ? `, ${w[siteIndex].shift.toFixed(2)} at the site` : ""}`}
      >
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line className="ptb-trace__grid" x1={L} x2={W - R} y1={y(maxShift * f)} y2={y(maxShift * f)} strokeDasharray={f ? "3 3" : undefined} />
            <text className="ptb-trace__label" x={L - 4} y={y(maxShift * f) + 3} textAnchor="end">{(maxShift * f).toFixed(f ? 1 : 0)}</text>
          </g>
        ))}
        <path className="ptb-trace__area" d={area} />
        <path className="ptb-trace__line" d={path} />
        {w.map((d, i) =>
          i === siteIndex ? null : <circle key={d.position} className="ptb-trace__dot" cx={x(i)} cy={y(d.shift)} r={2.2} />
        )}
        {siteIndex >= 0 && <circle className="ptb-trace__site" cx={x(siteIndex)} cy={y(w[siteIndex].shift)} r={4.5} />}
        {w.map((d, i) =>
          i === siteIndex || i === 0 || i === w.length - 1 ? (
            <text key={`l${d.position}`} className="ptb-trace__label" data-site={i === siteIndex || undefined} x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === w.length - 1 ? "end" : "middle"}>
              {d.position}
            </text>
          ) : null
        )}
      </svg>
      <p className="ptb-scale__source">
        {lm.embedding.metric}
        {lm.embedding.dim ? ` in a ${lm.embedding.dim}-dim space` : ""} — its size tracks the model&apos;s latent width, so compare
        it only within this model.
      </p>
    </>
  );
}

export function ResidueDetail({
  evidence,
  selected,
  onSelect
}: {
  evidence: PerturbationEvidence;
  selected: LmReading | null;
  onSelect: (id: PerturbationModelId) => void;
}) {
  const { wtCode, mutCode, wtLabel, mutLabel, position } = evidence.residues;
  return (
    <section className="ptb-section" aria-labelledby="ptb-detail-title">
      <div className="ptb-card">
        <div className="ptb-detail__head">
          <h3 className="ptb-detail__title" id="ptb-detail-title">
            Residue detail{selected ? <span> · {selected.servedBy ?? selected.family}</span> : null}
          </h3>
          <div className="ptb-tabs" role="group" aria-label="Model shown in residue detail">
            {evidence.lms.map(l => (
              <button
                key={l.id}
                type="button"
                aria-pressed={selected?.id === l.id}
                disabled={l.availability.state !== "computed"}
                onClick={() => onSelect(l.id)}
                title={l.availability.state !== "computed" ? `${l.family}: ${l.availability.label}` : undefined}
              >
                {l.family}
              </button>
            ))}
          </div>
        </div>

        {!selected ? (
          <p className="ptb-empty ptb-empty--pad">
            <strong>No model to show</strong>
            None of the language models returned a result for this variant.
          </p>
        ) : (
          <>
            <dl className="ptb-facts">
              <div>
                <dt>P(native {wtLabel || "residue"})</dt>
                <dd>{selected.wtProb !== null ? selected.wtProb.toFixed(4) : "—"}</dd>
              </div>
              <div>
                <dt>P(variant {mutLabel || "residue"})</dt>
                <dd>
                  {selected.mutProb !== null ? selected.mutProb.toFixed(4) : "—"}
                  {selected.retention !== null && (
                    <small>{selected.retention < 0.01 ? "<1" : (selected.retention * 100).toFixed(0)}% of native</small>
                  )}
                </dd>
              </div>
              <div>
                <dt>Rank of {mutLabel || "variant"}</dt>
                <dd>
                  {selected.rank !== null ? `${selected.rank} / 20` : "—"}
                  {selected.bandLabel && <small>{selected.bandLabel}</small>}
                </dd>
              </div>
              <div>
                <dt>Positional entropy</dt>
                <dd>
                  {selected.entropy !== null ? `${selected.entropy.toFixed(2)} bits` : "—"}
                  <small>of {ENTROPY_MARKS.ceiling.toFixed(2)} possible</small>
                </dd>
              </div>
              <div>
                <dt>3Di structure state</dt>
                <dd>
                  {selected.id !== "saprot" ? "—" : selected.structureToken === "#" ? "none" : selected.structureToken ?? "—"}
                  <small>
                    {selected.id !== "saprot"
                      ? "Sequence-only model"
                      : selected.structureToken === "#"
                        ? "Scored without structure"
                        : selected.structureToken
                          ? "Foldseek letter"
                          : "Not reported"}
                  </small>
                </dd>
              </div>
            </dl>
            <div className="ptb-detail__grid">
              <div>
                <Preferences lm={selected} wtCode={wtCode} mutCode={mutCode} wtLabel={wtLabel} mutLabel={mutLabel} />
              </div>
              <div>
                <ShiftTrace lm={selected} position={position} />
              </div>
            </div>
            {selected.rankSentence && <p className="ptb-detail__sentence">{selected.rankSentence}</p>}
          </>
        )}
      </div>
    </section>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Atom, Layers, ListChecks, Sparkles } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { resolveResidueShiftModel } from "../../lib/residueShiftModel";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { THRESHOLDS } from "../../shared/thresholds/constants";
import {
  LM_CAVEAT_TEXT,
  buildPerturbationEvidence,
  perturbationFinding,
  type LmReading,
  type PerturbationEvidence,
  type PhysicalReading,
  type ReadingAvailability
} from "../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../shared/perturbationModels";
import { MarkRuler, RankRuler } from "./perturbation/Rulers";
import { ResidueDetail } from "./perturbation/ResidueDetail";

/**
 * Structural perturbation.
 *
 * ONE QUESTION: how do sequence and structure models read this substitution at its own position,
 * and what does that license? The answer is context: nothing here is an ACMG input. Three tiers,
 * the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — the scale-free cross-model statement (the variant's within-model rank in each
 *      language model), the finding sentence, one strip of the three models, the caveats that change
 *      how to read them, and a fact strip ending in the engine record.
 *   2. READINGS — one table: language models, FoldX energy terms, ESM3 — every source a row on its
 *      own axis, every mark drawn dashed because none is published.
 *   3. RESIDUE DETAIL — one model's residue distribution and embedding-shift trace.
 *
 * INVARIANTS
 *   • Every reading comes from `buildPerturbationEvidence`; this file tests no score.
 *   • No composite. The 0–100 "Local perturbation score" was removed (owner decision, 2026-09-29):
 *     its weights, transform and bands were app-defined, and it averaged three model-native ΔLLRs.
 *   • No red or green: nothing on this tab is an ACMG code.
 *
 * Replaced: model cards + metric bar + "Section A/B/C" card grids, a timed fake progress bar for
 * SaProt (stages guessed from elapsed seconds), and a hooks-after-early-return bug.
 */

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

function shortServed(lm: LmReading): string {
  const p = lm.servedBy;
  if (!p) return lm.served.inferred ? "model not named" : "";
  const outer = p.replace(/\([^)]*\)/g, "").trim();
  const inner = p.match(/\(([^)]+)\)/)?.[1] ?? "";
  // "SaProt (SaProt_35M_AF2 - Remote)" → "SaProt_35M_AF2 · Remote"; "ESMC-6B (Remote)" → "ESMC-6B · Remote".
  const parts = inner.split(/\s+-\s+/).filter(Boolean);
  // Keep the outer name unless the parentheses already name the model (a checkpoint id).
  const innerNamesModel = parts.some(x => /_|esm|saprot|vesm/i.test(x));
  const named = innerNamesModel ? parts : [outer, ...parts];
  return named.filter(Boolean).join(" · ");
}

function AvailabilityCell({
  a,
  colSpan,
  onAction
}: {
  a: ReadingAvailability;
  colSpan: number;
  onAction: (action: NonNullable<ReadingAvailability["action"]>) => void;
}) {
  return (
    <td className="ptb-reason" colSpan={colSpan}>
      {a.state === "pending" ? <span className="ptb-dim">Still being computed for this variant.</span> : a.reason}
      {a.action && a.state !== "pending" && (
        <span className="ptb-actions">
          {a.action === "switch-saprot-35m" && (
            <button type="button" className="ptb-link" onClick={() => onAction("switch-saprot-35m")}>Run SaProt 35M instead</button>
          )}
          {(a.action === "retry" || a.action === "switch-saprot-35m") && (
            <button type="button" className="ptb-link" onClick={() => onAction("retry")}>Re-run</button>
          )}
          {a.action === "settings" && (
            <button type="button" className="ptb-link" onClick={() => onAction("settings")}>Open connection settings</button>
          )}
        </span>
      )}
    </td>
  );
}

function StatusChip({ a }: { a: ReadingAvailability }) {
  return (
    <span className="ev-tier" data-tone={a.state === "pending" ? "neutral" : a.state === "failed" ? "warning" : "muted"}>
      {a.label}
    </span>
  );
}

function ModelStrip({
  evidence,
  selectedId,
  onSelect
}: {
  evidence: PerturbationEvidence;
  selectedId: PerturbationModelId | null;
  onSelect: (id: PerturbationModelId) => void;
}) {
  return (
    <ol className="ptb-models" aria-label="Variant rank in each language model">
      {evidence.lms.map(l => {
        const ok = l.availability.state === "computed";
        return (
          <li key={l.id}>
            <button
              type="button"
              className="ptb-model"
              data-state={l.availability.state}
              aria-pressed={selectedId === l.id}
              disabled={!ok}
              onClick={() => onSelect(l.id)}
              title={ok ? `Show ${l.family} in residue detail` : `${l.family}: ${l.availability.label}`}
            >
              <span className="ptb-model__head">
                <span className="ptb-model__name">{l.family}</span>
                <span className="ptb-model__served">{ok ? shortServed(l) : l.availability.label}</span>
              </span>
              <span className="ptb-model__rank">
                <b>{l.rank !== null ? l.rank : "—"}</b>
                <span>{l.rank !== null ? `/ 20 · ${l.bandLabel?.toLowerCase()}` : ok ? "no rank returned" : ""}</span>
              </span>
              <span className="ptb-model__pips" aria-hidden="true">
                {Array.from({ length: 20 }, (_, i) => <i key={i} data-here={l.rank === i + 1 || undefined} />)}
              </span>
              <span className="ptb-model__foot">
                <span>ΔLLR</span>
                <span className="ptb-mono">{l.llr !== null ? `${signed(l.llr, 2)} nats` : "—"}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function LmRow({
  lm,
  selected,
  onSelect,
  onAction
}: {
  lm: LmReading;
  selected: boolean;
  onSelect: (id: PerturbationModelId) => void;
  onAction: (action: NonNullable<ReadingAvailability["action"]>) => void;
}) {
  const ok = lm.availability.state === "computed";
  return (
    <tr data-testid={`ptb-lm-${lm.id}`} data-selected={selected || undefined}>
      <th scope="row" className="ptb-subject">
        <span className="ptb-subject__line">
          <span className="ptb-subject__name">{lm.family}</span>
          {ok && (
            <button type="button" className="ptb-select" aria-pressed={selected} onClick={() => onSelect(lm.id)}>
              {selected ? "In residue detail" : "Show residue detail"}
            </button>
          )}
        </span>
        <span className="ptb-subject__note">{lm.calibration?.note ?? "Protein language model."}</span>
        {lm.caveats.length > 0 && (
          <span className="ptb-caveats">
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
            <span className="ptb-unit">nats · ΔLLR</span>
          </td>
          <td className="ptb-scale">
            {lm.rank !== null ? (
              <>
                <RankRuler rank={lm.rank} band={lm.band} label={`${lm.family} rank`} />
                <span className="ptb-scale__source">Rank {lm.rank} of 20 · app-defined bands</span>
              </>
            ) : (
              <span className="ptb-dim">No residue rank returned.</span>
            )}
          </td>
          <td className="ptb-status">
            {lm.bandLabel ? <span className="ev-tier" data-tone="neutral">{lm.bandLabel}</span> : <span className="ev-tier" data-tone="muted">{ENGINE_STATE_LABELS["no-result"]}</span>}
            <span className="ptb-status__sub">{lm.votes ? "Counted in PP3/BP4" : "Not counted"}</span>
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

function PhysicalRow({ r }: { r: PhysicalReading }) {
  const ok = r.availability.state === "computed";
  return (
    <tr data-testid={`ptb-phys-${r.key}`}>
      <th scope="row" className="ptb-subject">
        <span className="ptb-subject__line"><span className="ptb-subject__name">{r.name}</span></span>
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
            {r.scale && r.value !== null ? (
              <>
                <MarkRuler value={r.value} min={r.scale.min} max={r.scale.max} marks={r.marks} label={r.name} format={n => n.toFixed(1)} />
                <span className="ptb-scale__source">{r.marks.map(m => m.label).join(" · ")}</span>
              </>
            ) : (
              <span className="ptb-dim">No reading mark</span>
            )}
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

function Esm3Rows({ evidence }: { evidence: PerturbationEvidence }) {
  const e = evidence.esm3!;
  const ok = e.availability.state === "computed";
  if (!ok) {
    return (
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">ESM3 embedding drift</span></span>
        </th>
        <td className="ptb-reason" colSpan={2}>{e.availability.reason}</td>
        <td className="ptb-status"><StatusChip a={e.availability} /></td>
      </tr>
    );
  }
  const d = THRESHOLDS.esm3Drift;
  const bandLabel = e.driftBand ? `${e.driftBand[0].toUpperCase()}${e.driftBand.slice(1)} · local band` : null;
  return (
    <>
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">ESM3 embedding drift</span></span>
          <span className="ptb-subject__note">
            Largest per-residue cosine distance between wild-type and mutant ESM3 sequence embeddings
            {e.driftResidue !== null ? `, at sequence index ${e.driftResidue}` : ""}. A representation change — not a structure prediction.
          </span>
          {e.fallback && (
            <span className="ptb-caveats">
              <span className="ev-tier" data-tone="warning" title="ESM3 was unavailable, so VESM-150M produced these numbers.">Fallback model</span>
            </span>
          )}
          {e.servedBy && <span className="ptb-subject__note ptb-subject__fact">Served by {e.servedBy}</span>}
        </th>
        <td className="ptb-num">{e.drift!.toFixed(3)}<span className="ptb-unit">cosine distance</span></td>
        <td className="ptb-scale">
          <MarkRuler
            value={e.drift!}
            min={0}
            max={Math.max(0.5, Math.ceil(e.drift! * 10) / 10)}
            marks={[
              { value: d.none, label: `${d.none} none/minor` },
              { value: d.minor, label: `${d.minor} minor/moderate` },
              { value: d.moderate, label: `${d.moderate} moderate/major` }
            ]}
            label="ESM3 embedding drift"
            format={n => n.toFixed(2)}
          />
          <span className="ptb-scale__source">Local bands {d.none} · {d.minor} · {d.moderate}, unsourced</span>
        </td>
        <td className="ptb-status">{bandLabel && <span className="ev-tier" data-tone="neutral">{bandLabel}</span>}</td>
      </tr>
      <tr data-testid="ptb-esm3-context">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">Site context</span></span>
          <span className="ptb-subject__note">
            Confidence is the input structure&apos;s per-residue value (pLDDT for an AlphaFold model) — not ESM3&apos;s
            confidence in anything it predicted.
          </span>
        </th>
        <td className="ptb-num">
          {e.templateConfidence !== null ? e.templateConfidence.toFixed(1) : "—"}
          <span className="ptb-unit">input confidence</span>
        </td>
        <td className="ptb-reason" colSpan={2}>
          {e.secondaryStructure ?? "Secondary structure not reported"} · {e.burial ?? "burial not measured"}
        </td>
      </tr>
    </>
  );
}

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  structuralDiff,
  metrics,
  isFolding,
  onOpenSettings,
  onRetryStructural,
  onNavigateToView
}: TabComponentProps) {
  const result = analysisState.result;
  const { settings, updateSetting, openSettingsTab } = useSettings();
  const activeModel = useVariantAnalysisStore(s => s.activePerturbationModel);
  const setActiveModel = useVariantAnalysisStore(s => s.setActivePerturbationModel);
  const [busy, setBusy] = useState(false);

  // Seed the selection from the configured default when a new variant is analysed.
  useEffect(() => {
    setActiveModel(settings.defaultPerturbationModel);
  }, [settings.defaultPerturbationModel, setActiveModel, result?.metadata?.gene, result?.metadata?.variant]);

  const residues = useMemo(() => {
    const m = resolveResidueShiftModel({
      wildType: result?.metadata?.wildType,
      mutant: result?.metadata?.mutant,
      variant: result?.metadata?.variant
    });
    return { wtCode: m.wildTypeCode, mutCode: m.mutantCode, wtLabel: m.wildTypeLabel, mutLabel: m.mutantLabel };
  }, [result?.metadata?.wildType, result?.metadata?.mutant, result?.metadata?.variant]);

  // All hooks run before the null guard: `result` can turn null on an instance that has rendered.
  const evidence = useMemo(
    () =>
      result
        ? buildPerturbationEvidence({
            result,
            residues,
            foldingEnergetics,
            structuralDiff,
            metrics,
            saprotEngine: settings.saprotEngine,
            isFolding: Boolean(isFolding)
          })
        : null,
    [result, residues, foldingEnergetics, structuralDiff, metrics, settings.saprotEngine, isFolding]
  );

  if (!result || !evidence) return null;

  const selected =
    evidence.lms.find(l => l.id === activeModel && l.availability.state === "computed") ?? evidence.scored[0] ?? null;
  const finding = perturbationFinding(evidence);
  const c = evidence.consensus;
  const mut = residues.mutLabel || "the variant";
  const pos = evidence.residues.position;

  const rerun = async (overrides?: { saprotEngine?: string }) => {
    if (!onRetryStructural) return;
    setBusy(true);
    try {
      await onRetryStructural(overrides);
    } finally {
      setBusy(false);
    }
  };
  const onAction = (action: NonNullable<ReadingAvailability["action"]>) => {
    if (busy) return;
    if (action === "switch-saprot-35m") {
      updateSetting("saprotEngine", "saprot-35m");
      void rerun({ saprotEngine: "saprot-35m" });
    } else if (action === "retry") {
      void rerun();
    } else if (onOpenSettings) {
      onOpenSettings();
    } else {
      openSettingsTab("connections");
    }
  };

  const figure = c.nRanked === 0 ? "—" : c.agree && c.band ? `${c.nRanked} of ${c.nRanked}` : `${c.nLeast + c.nLower} of ${c.nRanked}`;
  const figureLabel = c.nRanked === 0
    ? "no model returned a residue rank"
    : c.agree && c.band
      ? `models place ${mut} in the same preference band${pos !== null ? ` at residue ${pos}` : ""}`
      : `models rank ${mut} in the dispreferred half${pos !== null ? ` at residue ${pos}` : ""}`;

  const fallbacks = evidence.scored.filter(l => l.caveats.includes("fallback-model"));
  const seqOnly = evidence.scored.find(l => l.caveats.includes("sequence-only"));
  const floored = evidence.scored.filter(l => l.caveats.includes("probability-floor"));
  const vdw = evidence.physical.readings.find(r => r.key === "vdw");

  return (
    <div className="ptb-screen">
      <header>
        <h1 className="screen-title">Structural perturbation</h1>
        <p className="screen-tab-description">
          How protein language models and FoldX read this substitution at its own position. Context for
          curation — none of these scores is an ACMG input.
        </p>
      </header>

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      <section className="ptb-card ptb-hero" aria-labelledby="ptb-finding-title" data-testid="perturbation-finding">
        <div className="ptb-hero__body">
          <div className="ptb-hero__top">
            <span className="eyebrow" id="ptb-finding-title">
              <Atom className="w-3.5 h-3.5" />
              Sequence &amp; structure models · context, not an ACMG input
            </span>
            <span
              className="ev-tier ptb-verdict"
              data-tone={evidence.engine.informational ? "muted" : "accent"}
              data-testid="perturbation-engine-chip"
              title="Read from the PP3/BP4 rule's own list of informational tools"
            >
              {evidence.engine.informational ? "Informational" : `Counted: ${evidence.engine.counted.join(", ")}`}
            </span>
          </div>

          <div className="ptb-hero__figure">
            <span className="ptb-figure">{figure}</span>
            <span className="ptb-hero__figure-label">{figureLabel}</span>
          </div>

          <p className="ptb-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </p>

          <ModelStrip evidence={evidence} selectedId={selected?.id ?? null} onSelect={setActiveModel} />

          {fallbacks.length > 0 && (
            <p className="ptb-callout" data-tone="warning" data-testid="ptb-fallback-callout">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                {fallbacks.map(l => (
                  <React.Fragment key={l.id}>
                    <strong>{l.family}</strong> was served by {l.servedBy}
                    {l.fallbackReason ? ` (${l.fallbackReason})` : ""}.{" "}
                  </React.Fragment>
                ))}
                Its row describes the model that ran, not the one the row is named for.
              </span>
            </p>
          )}
          {seqOnly && (
            <p className="ptb-callout" data-tone="warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>SaProt had no structure token at this residue</strong> — it was scored from sequence
                alone, so its reading is not structure-aware here.
              </span>
            </p>
          )}
          {floored.length > 0 && (
            <p className="ptb-callout" data-tone="warning">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{floored.map(l => l.family).join(", ")}</strong>: {mut} was not among the tokens the remote
                engine returned, so its probability is the 1e-9 floor and ΔLLR is bounded by it, not measured.
              </span>
            </p>
          )}

          <dl className="ptb-hero__meta">
            <div>
              <dt>Scale</dt>
              <dd>
                {evidence.scored.length === 0
                  ? "No model scored yet"
                  : `${evidence.scored.length} model${evidence.scored.length === 1 ? "" : "s"} · ${evidence.scale.mixed ? "no shared scale" : evidence.scored.length > 1 ? "one family" : "single model"}`}
                <span className="ptb-sub">ΔLLR is never averaged across families</span>
              </dd>
            </div>
            <div>
              <dt>FoldX clash term</dt>
              <dd>
                {vdw?.value != null ? `${vdw.text} kcal/mol` : evidence.physical.reason ?? "—"}
                <span className="ptb-sub">
                  {evidence.physical.available ? (
                    <>
                      Stability (ΔΔG) is on{" "}
                      {onNavigateToView ? (
                        <button type="button" className="ptb-link" onClick={() => onNavigateToView("energetics")}>
                          Energetics <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </button>
                      ) : "Energetics"}
                    </>
                  ) : "No mutant model"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Engine record</dt>
              <dd data-testid="perturbation-engine-record">
                {evidence.engine.informational ? "Not counted in PP3/BP4" : `Counted: ${evidence.engine.counted.join(", ")}`}
                <span className="ptb-sub">The rule lists these models as informational</span>
              </dd>
            </div>
          </dl>
        </div>

        {evidence.pending && (
          <div role="status" className="ptb-callout ptb-callout--banner" data-tone="neutral">
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Some models are still running for this variant; the rows marked below will fill in.</span>
          </div>
        )}
      </section>

      {/* ── 2. Readings ────────────────────────────────────────────────────────────────────── */}
      <section className="ptb-section" aria-labelledby="ptb-readings-title">
        <h2 className="eyebrow" id="ptb-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          Readings
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
            <tbody data-group="lm">
              <tr className="ptb-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ptb-group__inner">
                    <span className="ptb-group__title">Protein language models</span>
                    <span className="ptb-group__meta">ΔLLR is model-native — compare these rows by rank, not by ΔLLR</span>
                  </span>
                </th>
              </tr>
              {evidence.lms.map(l => (
                <LmRow key={l.id} lm={l} selected={selected?.id === l.id} onSelect={setActiveModel} onAction={onAction} />
              ))}
            </tbody>
            <tbody data-group="foldx">
              <tr className="ptb-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ptb-group__inner">
                    <span className="ptb-group__title">FoldX mutant model</span>
                    <span className="ptb-group__meta">
                      {evidence.physical.rigidBackbone ? "Rigid backbone · " : ""}
                      {evidence.physical.runs ? `${evidence.physical.runs} runs · ` : ""}
                      energy components and local geometry, not stability
                    </span>
                  </span>
                </th>
              </tr>
              {evidence.physical.available ? (
                evidence.physical.readings.map(r => <PhysicalRow key={r.key} r={r} />)
              ) : (
                <tr>
                  <th scope="row" className="ptb-subject"><span className="ptb-subject__name">FoldX</span></th>
                  <td className="ptb-reason" colSpan={2}>{evidence.physical.reason}</td>
                  <td className="ptb-status">
                    <span className="ev-tier" data-tone={isFolding ? "neutral" : "muted"}>
                      {isFolding ? ENGINE_STATE_LABELS.running : ENGINE_STATE_LABELS["no-result"]}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
            {evidence.esm3 && (
              <tbody data-group="esm3">
                <tr className="ptb-group">
                  <th colSpan={4} scope="rowgroup">
                    <span className="ptb-group__inner">
                      <span className="ptb-group__title">ESM3 · exploratory</span>
                      <span className="ptb-group__meta">Hypothesis-generating; not validated against any outcome</span>
                    </span>
                  </th>
                </tr>
                <Esm3Rows evidence={evidence} />
              </tbody>
            )}
          </table>
          <div className="ptb-table-foot" aria-label="Legend">
            <span className="ptb-legend__item"><span className="ptb-legend__band" aria-hidden="true"><i /><i /><i /><i /></span>Rank bands, most → least preferred</span>
            <span className="ptb-legend__item"><i className="ptb-legend__tick" />App-defined reading mark</span>
            <span className="ptb-legend__item"><i className="ptb-legend__marker" />This variant</span>
            {evidence.physical.runsIdentical && (
              <span className="ptb-legend__item">
                FoldX runs identical (SD 0.00) — no run-to-run spread, not a precision claim
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. Residue detail ──────────────────────────────────────────────────────────────── */}
      <ResidueDetail evidence={evidence} selected={selected} onSelect={setActiveModel} />

      {busy && (
        <p role="status" className="ptb-callout" data-tone="neutral">
          <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Re-running the structural models…</span>
        </p>
      )}
    </div>
  );
}

export default PerturbationTab;

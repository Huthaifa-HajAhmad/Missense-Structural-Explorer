import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Atom, HelpCircle, Layers, ListChecks, Sparkles } from "lucide-react";
import { TabComponentProps } from "./types";
import { useSettings } from "../../context/SettingsContext";
import { useVariantAnalysisStore } from "../../stores/useVariantAnalysisStore";
import { resolveResidueShiftModel } from "../../lib/residueShiftModel";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import { ENTROPY_MARKS } from "../../shared/modelCalibration";
import {
  LM_CAVEAT_TEXT,
  buildPerturbationEvidence,
  oddsText,
  perturbationFinding,
  type LmReading,
  type PerturbationEvidence,
  type PhysicalReading,
  type ReadingAvailability
} from "../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../shared/perturbationModels";
import { MarkRuler, RankRuler } from "./perturbation/Rulers";
import { ResidueDetail } from "./perturbation/ResidueDetail";
import { EmbeddingProfile } from './perturbation/EmbeddingProfile';
import { Prose } from "../ui/Prose";
import { EvidencePanel, EvidenceViewTabs, InspectReadingButton, useEvidenceWorkspace } from './EvidenceWorkspace';
import { ResearchGuideButton } from '../knowledge/ResearchGuideButton';

import { PHYSICAL_EXPLANATIONS } from '../../shared/researchGuides';
import { evidenceTab } from '../../shared/evidenceTabs';

/**
 * Structural perturbation.
 *
 * ONE QUESTION: how do sequence and structure models read this substitution at its own position,
 * and what does that license? The answer is context: nothing here is an ACMG input. Three tiers,
 * the shape Population Data and Predictors set:
 *
 *   1. THE FINDING — the cross-model statement (which way each language model reads the substitution,
 *      from its own output), the finding sentence with each model's own odds, one strip of the three
 *      models, the caveats that change how to read them, and a fact strip ending in the engine record.
 *   2. READINGS — one table: language models, FoldX energy terms, ESM3 — every source a row on its
 *      own axis, every mark drawn dashed because none is published.
 *   3. RESIDUE DETAIL — one model's residue distribution and embedding-shift trace.
 *
 * INVARIANTS
 *   • Every reading comes from `buildPerturbationEvidence`; this file tests no score.
 *   • No composite. The 0–100 "Local perturbation score" was removed (owner decision, 2026-09-29):
 *     its weights, transform and bands were app-defined, and it averaged three model-native ΔLLRs.
 *   • No red or green: nothing on this tab is an ACMG code.
 *   • A rank is never shown without the native residue's rank beside it, and a flat distribution's
 *     rank is never read (SLC12A4 p.Gln867His: "most preferred" beside a ΔLLR of −6.98).
 *   • Clay is the variant residue everywhere (pips, rulers, bars); a hollow ink ring is the native.
 *
 * Replaced: model cards + metric bar + "Section A/B/C" card grids, a timed fake progress bar for
 * SaProt (stages guessed from elapsed seconds), and a hooks-after-early-return bug.
 */

const signed = (v: number, digits: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/** The direction a model reads, as a short chip label and a tone. Nothing here is red or green. */
function directionChip(lm: LmReading, wt: string, mut: string): { label: string; tone: "neutral" | "muted" } | null {
  switch (lm.direction) {
    case "favours-native": return { label: `Favours ${wt}`, tone: "neutral" };
    case "favours-variant": return { label: `Favours ${mut}`, tone: "neutral" };
    case "even": return { label: "Near even", tone: "neutral" };
    case "flat": return { label: "No preference", tone: "muted" };
    default: return null;
  }
}

/** "Gln 384× as likely as His" / "His 2.1× as likely as Gln" / "within 2× of each other". */
function oddsLine(lm: LmReading, wt: string, mut: string): string | null {
  if (lm.odds === null) return null;
  if (lm.direction === "flat") return lm.entropy !== null ? `Near-flat · ${lm.entropy.toFixed(2)} of ${ENTROPY_MARKS.ceiling.toFixed(2)} bits` : "Near-flat distribution";
  if (lm.direction === "favours-variant") return `${mut} ${oddsText(1 / lm.odds)} as likely as ${wt}`;
  if (lm.direction === "even") return `${wt} and ${mut} within 2× of each other`;
  return `${wt} ${oddsText(lm.odds)} as likely as ${mut}`;
}

/** "His 5th of 20 · Gln 1st" — the rank always beside the native's, never alone. */
function rankLine(lm: LmReading, wt: string, mut: string): string | null {
  if (lm.rank === null) return null;
  return `${mut} ${ordinal(lm.rank)} of 20${lm.nativeRank !== null ? ` · ${wt} ${ordinal(lm.nativeRank)}` : ""}`;
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
  return <td className="ptb-reason" colSpan={colSpan}><AvailabilityMessage a={a} onAction={onAction} /></td>;
}

/** One recovery contract for the model disclosure and the standalone readings table. */
function AvailabilityMessage({ a, onAction }: {
  a: ReadingAvailability;
  onAction: (action: NonNullable<ReadingAvailability['action']>) => void;
}) {
  return (
    <>
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
    </>
  );
}

/** Provenance and recovery are unique content, even when numeric readings are deduplicated. */
function ModelSupport({ evidence, onAction }: {
  evidence: PerturbationEvidence;
  onAction: (action: NonNullable<ReadingAvailability['action']>) => void;
}) {
  return <section aria-label="Model provenance and recovery">
    {evidence.lms.map(lm => <details key={lm.id} className="mol-finding-details">
      <summary>{lm.family} details and availability</summary>
      <p>{lm.description} <ResearchGuideButton topic={/vesm/i.test(lm.servedBy ?? '') ? 'vesm' : lm.id} label={`About ${lm.name}`} iconOnly /></p>
      {lm.servedBy && <p>Served by {lm.servedBy}</p>}
      <p>Scoring: {lm.scoringMethod === 'masked-marginal' ? 'the residue is hidden, then the model scores all 20 amino acids there' : lm.scoringMethod ?? 'not recorded by this engine'}.</p>
      {lm.serviceNote && <p>
        {lm.serviceNote}.{' '}
        {(lm.remoteFailure?.code === 'billing' || lm.remoteFailure?.code === 'auth') && (
          <button type="button" className="ptb-link" onClick={() => onAction('settings')}>
            {lm.remoteFailure.code === 'billing' ? 'Open connection settings to add credits or another token' : 'Open connection settings to replace the token'}
          </button>
        )}
      </p>}
      {lm.diagnostics.length > 0 && <ul aria-label={`${lm.family} engine notes`}>
        {lm.diagnostics.map(d => <li key={d.tier}><strong>{d.tier}:</strong> {d.text}</li>)}
      </ul>}
      {lm.availability.state !== 'computed' && <p className="ptb-reason"><StatusChip a={lm.availability} /> <AvailabilityMessage a={lm.availability} onAction={onAction} /></p>}
    </details>)}
  </section>;
}

function StatusChip({ a }: { a: ReadingAvailability }) {
  return (
    <span className="ev-tier" data-tone={a.state === "pending" ? "neutral" : a.state === "failed" ? "warning" : "muted"}>
      {a.label}
    </span>
  );
}

/** Twenty cells: the variant's rank in clay, the native's as an ink ring. */
function RankPips({ lm }: { lm: LmReading }) {
  return (
    <span className="ptb-model__pips" aria-hidden="true" data-flat={lm.direction === "flat" || undefined}>
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} data-here={lm.rank === i + 1 || undefined} data-native={lm.nativeRank === i + 1 || undefined} />
      ))}
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
  const { wtLabel, mutLabel } = evidence.residues;
  const wt = wtLabel || "native";
  const mut = mutLabel || "variant";
  return (
    <ol className="ptb-models" aria-label="How each language model reads the substitution">
      {evidence.lms.map(l => {
        const ok = l.availability.state === "computed";
        const chip = ok ? directionChip(l, wt, mut) : null;
        return (
          <li key={l.id}>
            <button
              type="button"
              className="ptb-model"
              data-state={l.availability.state}
              data-direction={l.direction ?? undefined}
              aria-pressed={selectedId === l.id}
              disabled={!ok}
              onClick={() => onSelect(l.id)}
              title={ok ? `Show ${l.name} in residue detail` : `${l.family}: ${l.availability.label}`}
            >
              <span className="ptb-model__head">
                <span className="ptb-model__name">{l.name}</span>
                <span className="ptb-model__served">{ok ? `${l.name !== l.family ? `for ${l.family} · ` : ""}${l.servedShort}` : l.availability.label}</span>
              </span>
              <span className="ptb-model__call">{chip ? chip.label : ok ? "No ΔLLR" : "—"}</span>
              <span className="ptb-model__odds">{ok ? (oddsLine(l, wt, mut) ?? "") : ""}</span>
              {ok && l.rank !== null && <RankPips lm={l} />}
              <span className="ptb-model__foot">
                <span>{ok ? (rankLine(l, wt, mut) ?? "no rank returned") : ""}</span>
                <span className="ptb-mono">{l.llr !== null ? `ΔLLR ${signed(l.llr, 2)}` : ""}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One callout per model, naming every caveat that changes how its card reads. SaProt used to get a
 * sequence-only callout while its near-flat distribution — the reason its reading is noise — went
 * unsaid.
 */
function ModelCaveatCallouts({ evidence }: { evidence: PerturbationEvidence }) {
  const mut = evidence.residues.mutLabel || "the variant residue";
  const items = evidence.scored
    .map(l => {
      const parts: React.ReactNode[] = [];
      if (l.caveats.includes("fallback-model")) {
        // The causes come from the engine's codes, never from matching words in its error text.
        const causes = [l.serviceNote, l.fallbackReason ? `${l.family} could not run on this server` : null].filter(Boolean);
        parts.push(
          <>
            was produced by {l.name} instead{causes.length ? `, because ${causes.join(" and ")}` : ""}, so its row describes
            the model that ran
          </>
        );
      }
      if (l.caveats.includes("inferred-model")) parts.push(<>was not named in the payload, so its row is taken from your settings, not from what ran</>);
      if (l.caveats.includes("sequence-only")) parts.push(<>had no structure token at this residue and read it from sequence alone</>);
      if (l.caveats.includes("flat") && l.entropy !== null) {
        parts.push(
          <>
            spreads its probability almost evenly over the 20 residues ({l.entropy.toFixed(2)} of{" "}
            {ENTROPY_MARKS.ceiling.toFixed(2)} bits): it has no preference to read, and its rank is set aside
          </>
        );
      }
      if (l.caveats.includes("probability-floor")) {
        parts.push(<>did not return {mut} among its tokens, so its probability is the 1e-9 floor and ΔLLR is bounded by it, not measured</>);
      }
      return parts.length ? { l, parts } : null;
    })
    .filter((x): x is { l: LmReading; parts: React.ReactNode[] } => x !== null);
  if (items.length === 0) return null;
  return (
    <>
      {items.map(({ l, parts }) => (
        <p key={l.id} className="ptb-callout" data-tone="warning" data-testid={`ptb-caveat-${l.id}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            <strong>{l.family}</strong>{" "}
            {parts.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && "; it "}
                {p}
              </React.Fragment>
            ))}
            .
          </span>
        </p>
      ))}
    </>
  );
}

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
  onAction: (action: NonNullable<ReadingAvailability["action"]>) => void;
}) {
  const ok = lm.availability.state === "computed";
  const chip = ok ? directionChip(lm, wt, mut) : null;
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
            {chip ? <span className="ev-tier" data-tone={chip.tone}>{chip.label}</span> : <span className="ev-tier" data-tone="muted">{ENGINE_STATE_LABELS["no-result"]}</span>}
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

function Esm3Rows({ evidence }: { evidence: PerturbationEvidence }) {
  const e = evidence.esm3!;
  const ok = e.availability.state === "computed";
  const pos = evidence.residues.position;
  if (!ok) {
    return (
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">{e.label}</span><ResearchGuideButton topic={e.knowledgeKey} label={e.fallback ? "About the VESM fallback" : "About this embedding analysis"} iconOnly /></span>
          {e.remoteEngineNote && (
            <details className="ptb-diag">
              <summary>Engine notes</summary>
              <ul>
                {e.serviceNote && <li><strong>Remote service:</strong> {e.serviceNote}.</li>}
                <li><strong>Remote tier:</strong> {e.remoteEngineNote}</li>
              </ul>
            </details>
          )}
        </th>
        <td className="ptb-reason" colSpan={2}>{e.availability.reason}</td>
        <td className="ptb-status"><StatusChip a={e.availability} /></td>
      </tr>
    );
  }
  const peakAway = e.peakDistance !== null && e.peakDistance > 10;
  return (
    <>
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name"><InspectReadingButton tab="perturbation" readingKey="esm3">{e.label}</InspectReadingButton></span><ResearchGuideButton topic={e.knowledgeKey} label={e.fallback ? "About the VESM fallback" : "About this embedding analysis"} iconOnly /></span>
          <span className="ptb-subject__note">
            How much the model&apos;s internal description of each residue changes when the variant is introduced (cosine
            distance between wild-type and mutant sequence embeddings). A representation change — not a structure
            prediction.
          </span>
          {e.driftResidue !== null && (
            <span className="ptb-subject__note ptb-subject__fact" data-testid="ptb-esm3-peak">
              Largest change at residue {e.driftResidue}
              {e.peakDistance === 0
                ? " — the variant itself"
                : e.peakDistance !== null
                  ? `, ${e.peakDistance.toLocaleString("en-GB")} residues from the variant`
                  : ""}
              {e.siteDrift !== null && e.peakDistance !== 0 ? `; ${e.siteDrift.toFixed(3)} at residue ${pos}` : ""}.
            </span>
          )}
          {e.fallback && (
            <span className="ptb-caveats ev-caveats">
              {e.fallback && <span className="ev-tier" data-tone="warning" title="ESM3 was unavailable, so VESM-150M produced these numbers.">Fallback model</span>}
            </span>
          )}
          {e.servedBy && <span className="ptb-subject__note ptb-subject__fact">Served by {e.servedBy}</span>}
          {e.remoteEngineNote && (
            <details className="ptb-diag">
              <summary>Engine notes</summary>
              <ul>
                {e.serviceNote && <li><strong>Remote service:</strong> {e.serviceNote}.</li>}
                <li><strong>Remote tier:</strong> {e.remoteEngineNote}</li>
              </ul>
            </details>
          )}
        </th>
        <td className="ptb-num">{e.drift!.toFixed(3)}<span className="ptb-unit">cosine distance</span></td>
        <td className="ptb-scale">
          {/* No published bands exist for this distance, so none is drawn: the variant residue is the only mark. */}
          <MarkRuler
            value={e.drift!}
            min={0}
            max={Math.max(0.1, Math.ceil(e.drift! * 10) / 10)}
            marks={e.siteDrift !== null && pos !== null ? [{ value: e.siteDrift, label: `residue ${pos}` }] : []}
            label={e.label}
            format={n => n.toFixed(2)}
          />
          <span className="ptb-scale__source">Largest change in the protein{e.siteDrift !== null && pos !== null ? `; tick: residue ${pos}, ${e.siteDrift.toFixed(3)}` : ""}</span>
        </td>
        <td className="ptb-status">
          {e.peakDistance !== null && (
            <span className="ev-tier" data-tone="neutral" title="Within 10 residues of the variant counts as near. The cut-off is app-defined, not published.">
              {e.peakDistance === 0 ? "Peak at the variant" : peakAway ? "Peak away from the variant" : "Peak near the variant"}
            </span>
          )}
        </td>
      </tr>
      <tr data-testid="ptb-esm3-context">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">Site context</span></span>
          <span className="ptb-subject__note">
            How confident the input structure is at this residue (pLDDT for an AlphaFold model) — not the embedding model&apos;s
            confidence in anything it predicted.
          </span>
        </th>
        <td className="ptb-num">
          {e.templateConfidence !== null ? e.templateConfidence.toFixed(1) : "—"}
          <span className="ptb-unit">pLDDT</span>
        </td>
        <td className="ptb-reason">
          {e.secondaryStructure ?? "Secondary structure not reported"} · {e.burial ?? "burial not measured"}
        </td>
        <td className="ptb-status">
          {e.confidenceBand && (
            <span className="ev-tier" data-tone="neutral" title="AlphaFold DB bands: very high > 90, confident 70–90, low 50–70, very low ≤ 50 (Jumper 2021)">
              {e.confidenceBand}
            </span>
          )}
        </td>
      </tr>
    </>
  );
}

/** A short primer for a reader new to protein language models. Collapsed; the tab reads without it. */
function ReadingPrimer({ wt, mut }: { wt: string; mut: string }) {
  return (
    <details className="ptb-primer" data-testid="ptb-primer">
      <summary>
        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        How to read this tab
      </summary>
      <ul>
        <li>
          <strong>Language models</strong> have learned from millions of natural proteins which amino acid tends to sit
          at each position. Hide the residue at this position and each model gives a probability to all 20 amino acids.
        </li>
        <li>
          <strong>The odds</strong> compare two of those probabilities. Odds of 100× for {wt} over {mut} would mean the
          model rates the native residue 100 times as likely as the variant. ΔLLR is the same comparison on a log scale
          (negative = the native is preferred).
        </li>
        <li>
          <strong>Each model has its own scale</strong>, so the tab compares the direction each model reads, never the size
          of their numbers. A <em>flat</em> model spreads its probability almost evenly and has no preference to read.
        </li>
        <li>
          <strong>These probabilities do not tell you whether the variant causes disease.</strong> This app does not use these scores to assign clinical evidence codes. Calibrated predictors are on
          the In-silico predictors tab.
        </li>
      </ul>
    </details>
  );
}

/** Two counts on one shared axis from 0: the reference in ink, the mutant in clay. Each count is printed. */
function CountFigure({ caption, note, rows }: {
  caption: string;
  note: string;
  rows: { label: string; value: number; variant: boolean }[];
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <figure>
      <figcaption>{caption}</figcaption>
      <div className="ptb-counts" role="img" aria-label={[caption, ...rows.map(r => r.label)].join(". ")}>
        {rows.map(r => (
          <div key={r.label} className="ptb-counts__row" data-role={r.variant ? "variant" : undefined}>
            <span className="ptb-counts__label">{r.label}</span>
            <span className="ptb-counts__track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
          </div>
        ))}
      </div>
      <p>{note}</p>
    </figure>
  );
}

export function PerturbationTab({
  analysisState,
  foldingEnergetics,
  foldingStatus,
  foldingError,
  structuralDiff,
  metrics,
  isFolding,
  onOpenSettings,
  onRetryStructural,
  onNavigateToView
}: TabComponentProps) {
  const result = analysisState.result;
  const workspace = useEvidenceWorkspace('perturbation');
  const { settings, updateSetting, openSettingsTab } = useSettings();
  const activeModel = useVariantAnalysisStore(s => s.activePerturbationModel);
  const setActiveModel = useVariantAnalysisStore(s => s.setActivePerturbationModel);
  const selectModel = (id: PerturbationModelId) => { setActiveModel(id); workspace.setOptions({ section: id }); workspace.select(id); };
  const [busy, setBusy] = useState(false);

  // Seed the selection from the configured default when a new variant is analysed.
  useEffect(() => {
    if (!workspace.enabled) setActiveModel(settings.defaultPerturbationModel);
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
            isFolding: Boolean(isFolding),
            foldingStatus,
            foldingError
          })
        : null,
    [result, residues, foldingEnergetics, structuralDiff, metrics, settings.saprotEngine, isFolding, foldingStatus, foldingError]
  );

  // The configured default wins; when it has no result, prefer a model with a reading over a flat one.
  const selected =
    evidence?.lms.find(l => l.id === (workspace.enabled ? workspace.section || settings.defaultPerturbationModel : activeModel) && l.availability.state === "computed") ??
    evidence?.scored.find(l => l.direction !== "flat") ??
    evidence?.scored[0] ??
    null;
  // The legacy rail and 3D consumers follow the model actually displayed, including fallbacks.
  useEffect(() => {
    if (workspace.enabled && selected) setActiveModel(selected.id);
  }, [workspace.enabled, selected?.id, setActiveModel]);
  if (!result || !evidence) return null;
  const finding = perturbationFinding(evidence);
  const dir = evidence.direction;
  const wt = residues.wtLabel || "native";
  const mut = residues.mutLabel || "variant";
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

  // "N of M" states a majority. With no majority (a tie, or most models near even or flat) the figure
  // says "Split" and the label lists every direction, so a minority is never shown as the answer.
  const variantLeads = dir.nFavourVariant > dir.nFavourNative;
  const lead = variantLeads ? dir.nFavourVariant : dir.nFavourNative;
  const majority = lead * 2 > dir.nScored;
  const atResidue = pos !== null ? ` at residue ${pos}` : "";
  const figure = dir.nScored === 0 ? "—" : majority ? `${lead} of ${dir.nScored}` : "Split";
  const figureLabel = dir.nScored === 0
    ? "no language model has scored this substitution yet"
    : majority
      ? `models favour ${variantLeads ? `${mut} over native ${wt}` : `native ${wt} over ${mut}`}${atResidue}`
      : [
          dir.nFavourNative > 0 && `${dir.nFavourNative} favour native ${wt}`,
          dir.nFavourVariant > 0 && `${dir.nFavourVariant} favour ${mut}`,
          dir.nEven > 0 && `${dir.nEven} near even`,
          dir.nFlat > 0 && `${dir.nFlat} with no preference`
        ].filter(Boolean).join(" · ") + atResidue;

  const vdw = evidence.physical.readings.find(r => r.key === "vdw");
  const clashes = evidence.physical.clashCounts;
  const contacts = evidence.physical.contactChange;
  const confidenceBand = evidence.physical.inputConfidence?.band;
  const lowConfidence = confidenceBand === "Low" || confidenceBand === "Very low";
  const energeticsLink = onNavigateToView ? (
    <button type="button" className="ptb-link" onClick={() => onNavigateToView("energetics")}>
      Energetics <ArrowRight className="w-3 h-3" aria-hidden="true" />
    </button>
  ) : "Energetics";

  return (
    <div data-evidence-screen className="ptb-screen" data-comparison={workspace.comparison || undefined}>
      <header className="ptb-header">
        <h1 className="screen-title">{evidenceTab('perturbation').label}</h1>
        <p className="screen-tab-description">
          What protein language models expect at this residue, how FoldX&apos;s mutant model packs, and how far the
          substitution moves a model&apos;s description of the sequence. Context for curation — none of these is an ACMG input.
        </p>
        {(!workspace.enabled || workspace.comparison) && <ReadingPrimer wt={wt} mut={mut} />}
      </header>
      <EvidenceViewTabs tab="perturbation" comparisonLabel="Model comparison" />
      <EvidencePanel tab="perturbation">

      {/* ── 1. The finding ─────────────────────────────────────────────────────────────────── */}
      {(!workspace.enabled || workspace.comparison) && <section className="ptb-card ptb-hero" aria-labelledby="ptb-finding-title" data-testid="perturbation-finding">
        <div className="ptb-hero__body">
          <div className="ptb-hero__top">
            <span className="eyebrow" id="ptb-finding-title">
              <Atom className="w-3.5 h-3.5" />
              Does the model expect the original amino acid or the replacement?
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

          <p>
            Here {wt} is the original amino acid and {mut} replaces it{pos !== null ? ` at residue ${pos}` : ""}. Each model hides that
            residue and estimates how likely each of the 20 amino acids is there, given the rest of the protein&apos;s sequence.
          </p>
          <div className="ptb-hero__figure">
            <span className="ptb-figure">{figure}</span>
            <span className="ptb-hero__figure-label">{figureLabel}</span>
          </div>

          <Prose className="ptb-hero__finding">
            <strong>{finding.headline}</strong>
            {" — "}
            {finding.predicate}.
          </Prose>

          <ModelStrip evidence={evidence} selectedId={selected?.id ?? null} onSelect={selectModel} />

          {workspace.comparison && <ModelSupport evidence={evidence} onAction={onAction} />}

          <ModelCaveatCallouts evidence={evidence} />

          <details className="mol-finding-details" open={workspace.comparison ? undefined : true}>
          <summary>Model coverage, FoldX and engine record</summary>
          <dl className="ptb-hero__meta">
            <div>
              <dt>Models read</dt>
              <dd>
                {dir.nScored === 0
                  ? "No model scored yet"
                  : `${dir.nScored - dir.nFlat} of ${dir.nScored} with a preference${dir.nFlat ? ` · ${dir.nFlat} flat` : ""}`}
                <span className="ptb-sub">Compared by direction; ΔLLR is never averaged across models</span>
              </dd>
            </div>
            <div>
              <dt>FoldX mutant model</dt>
              <dd data-testid="perturbation-foldx-fact">
                {vdw?.value != null ? `Clash term ${vdw.text} kcal/mol` : evidence.physical.reason ?? "—"}
                <span className="ptb-sub">Stability (ΔΔG) and every engine&apos;s status are on {energeticsLink}</span>
              </dd>
            </div>
            <div>
              <dt>Engine record</dt>
              <dd data-testid="perturbation-engine-record">
                {evidence.engine.informational ? "Not counted in PP3/BP4" : `Counted: ${evidence.engine.counted.join(", ")}`}
                <span className="ptb-sub">No language model here has a published cut-point</span>
              </dd>
            </div>
          </dl>
          </details>
        </div>

        {evidence.pending && (
          <div role="status" className="ptb-callout ptb-callout--banner" data-tone="neutral">
            <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Some models are still running for this variant; the rows marked below will fill in.</span>
          </div>
        )}
      </section>}

      {/* ── 2. Readings ────────────────────────────────────────────────────────────────────── */}
      {workspace.enabled && !workspace.comparison && <section className="ptb-card ptb-view-intro">
        <h2>{workspace.view === 'records' ? 'What changed in the modelled protein structure?' : 'Where did the model’s numerical description of the protein change?'}</h2>
        <p>{workspace.view === 'records' ? 'FoldX replaces the amino acid in a structural model and adjusts nearby side chains. These measurements compare that model with its reference; they do not establish what happens in a living cell.' : 'An embedding is a list of numbers a model uses to represent an amino acid and its surroundings. Comparing the original and substituted sequences shows changes in that representation, not measured atomic movement or disease risk.'}</p>
        {workspace.view === 'records' && <>
          {(evidence.physical.method || evidence.physical.inputConfidence) && <p className="ptb-dim">
            {evidence.physical.method}
            {evidence.physical.method && evidence.physical.inputConfidence && " · "}
            {evidence.physical.inputConfidence && <>Input model confidence at {pos !== null ? `residue ${pos}` : "the site"}: pLDDT {evidence.physical.inputConfidence.plddt.toFixed(1)}{evidence.physical.inputConfidence.band && ` · ${evidence.physical.inputConfidence.band}`}</>}
          </p>}
          {lowConfidence && <p className="ptb-callout" data-tone="neutral">Geometry in a low-confidence region describes the model more than the protein.</p>}
        <div className="ptb-energy-plots">{evidence.physical.readings.filter(r => (r.key === 'vdw' || r.key === 'elec') && r.value !== null).map(r => {
          const extent = Math.max(1, Math.ceil(Math.abs(r.value!)));
          return <figure key={r.key}><figcaption>{r.name}: <strong>{r.text} kcal/mol</strong></figcaption><MarkRuler value={r.value!} min={-extent} max={extent} marks={[{ value: 0, label: 'No change' }]} label={`${r.name}, mutant minus reference, kcal/mol`} format={n => n.toFixed(1)} /><p>Left of 0: this term is lower in the mutant model than in the reference; right of 0: higher. One energy component, not total stability.</p></figure>;
        })}
          {clashes && <CountFigure
            caption={`Heavy-atom clashes: ${clashes.wt} → ${clashes.mut}`}
            note="Heavy-atom clashes counted in the reference and in the mutant model. A count does not weigh how severe each clash is."
            rows={[{ label: `Reference ${clashes.wt}`, value: clashes.wt, variant: false }, { label: `Mutant ${clashes.mut}`, value: clashes.mut, variant: true }]}
          />}
          {contacts && <CountFigure
            caption={`Residue contacts within 4 Å: −${contacts.lost} / +${contacts.gained}`}
            note="Residues with a heavy atom within 4 Å of the site (±1 neighbours excluded), lost and gained by the substitution. Counts only, not energies."
            rows={[{ label: `Lost ${contacts.lost}`, value: contacts.lost, variant: false }, { label: `Gained ${contacts.gained}`, value: contacts.gained, variant: true }]}
          />}
        </div>
        </>}
      </section>}
      {workspace.view === 'embeddings' && <EmbeddingProfile evidence={evidence} />}
      {(!workspace.enabled || workspace.view === 'records' || (workspace.view === 'embeddings' && !!evidence.esm3)) && <section className="ptb-section" aria-labelledby="ptb-readings-title">
        <h2 className="eyebrow" id="ptb-readings-title">
          <ListChecks className="w-3.5 h-3.5" />
          {workspace.enabled ? workspace.view === 'embeddings' ? 'Sequence embeddings' : 'Packing & geometry' : 'Readings'}
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
            {!workspace.enabled && <tbody data-group="lm">
              <tr className="ptb-group">
                <th colSpan={4} scope="rowgroup">
                  <span className="ptb-group__inner">
                    <span className="ptb-group__title">Protein language models</span>
                    <span className="ptb-group__meta">Each on its own scale — read the direction and the odds, not the size of ΔLLR across rows</span>
                  </span>
                </th>
              </tr>
              {evidence.lms.map(l => (
                <LmRow key={l.id} lm={l} wt={wt} mut={mut} selected={selected?.id === l.id} onAction={onAction} />
              ))}
            </tbody>}
            {(!workspace.enabled || workspace.view === 'records') && <tbody data-group="foldx">
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
              {evidence.physical.available ? (
                evidence.physical.readings.map(r => (
                  <PhysicalRow key={r.key} r={r} plottedAbove={workspace.view === 'records' && (
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
                    {!isFolding && onNavigateToView && (
                      <span className="ptb-actions">
                        <button type="button" className="ptb-link" onClick={() => onNavigateToView("energetics")}>Open Energetics</button>
                      </span>
                    )}
                  </td>
                  <td className="ptb-status">
                    <span className="ev-tier" data-tone={isFolding ? "neutral" : foldingStatus === "failed" || foldingError ? "warning" : "muted"}>
                      {isFolding
                        ? ENGINE_STATE_LABELS.running
                        : foldingStatus === "failed" || foldingError
                          ? ENGINE_STATE_LABELS.failed
                          : ENGINE_STATE_LABELS["no-result"]}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>}
            {(!workspace.enabled || workspace.view === 'embeddings') && evidence.esm3 && (
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
            {!workspace.enabled && <>
            <span className="ptb-legend__item"><i className="ptb-legend__marker" />Variant ({mut})</span>
            <span className="ptb-legend__item"><i className="ptb-legend__native" />Native ({wt})</span>
            <span className="ptb-legend__item"><span className="ptb-legend__band" aria-hidden="true"><i /><i /><i /><i /></span>Rank bands, 1 → 20</span>
            </>}
            <span className="ptb-legend__item"><i className="ptb-legend__tick" />App-defined reading mark</span>
            {(!workspace.enabled || workspace.view === 'records') && evidence.physical.runsIdentical && (
              <span className="ptb-legend__item">
                FoldX runs identical (SD 0.00) — no run-to-run spread, not a precision claim
              </span>
            )}
          </div>
        </div>
      </section>}

      {/* ── 3. Residue detail ──────────────────────────────────────────────────────────────── */}
      {workspace.view === 'embeddings' && !evidence.esm3 && <p>No sequence embedding measurements were returned for this variant.</p>}
      {(!workspace.enabled || workspace.comparison) && <ResidueDetail evidence={evidence} selected={selected} />}

      {busy && (
        <p role="status" className="ptb-callout" data-tone="neutral">
          <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Re-running the structural models…</span>
        </p>
      )}
      </EvidencePanel>
    </div>
  );
}

export default PerturbationTab;

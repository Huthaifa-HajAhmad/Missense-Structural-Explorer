import React from "react";
import type { TabComponentProps } from "../types";
import { AlertTriangle, ArrowRight, Atom, Sparkles } from "lucide-react";
import { ENTROPY_MARKS } from "../../../shared/modelCalibration";
import { perturbationFinding, signed, type LmReading, type ModelAction, type PerturbationEvidence } from "../../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../../shared/perturbationModels";
import { directionCount, directionLabel } from "../../../shared/perturbationSummary";
import { Prose } from "../../ui/Prose";
import { useEvidenceWorkspace } from "../EvidenceWorkspace";
import { oddsLine, rankLine } from "./format";
import { ModelSupport } from "./ModelAvailability";

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
        const call = ok ? directionLabel(l, wt, mut) : null;
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
              <span className="ptb-model__call">{call ?? (ok ? "No ΔLLR" : "—")}</span>
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

/**
 * Tier 1, the finding: which way each language model reads the substitution, the finding sentence with
 * each model's own odds, one strip of the models, the caveats that change how to read them, and a fact
 * strip ending in the engine record.
 */
export function FindingCard({ evidence, selectedId, onSelect, onAction, onNavigateToView }: {
  evidence: PerturbationEvidence;
  selectedId: PerturbationModelId | null;
  onSelect: (id: PerturbationModelId) => void;
  onAction: (action: ModelAction) => void;
  onNavigateToView?: TabComponentProps["onNavigateToView"];
}) {
  const workspace = useEvidenceWorkspace('perturbation');
  const finding = perturbationFinding(evidence);
  const { figure, label: figureLabel } = directionCount(evidence);
  const dir = evidence.direction;
  const wt = evidence.residues.wtLabel || "native";
  const mut = evidence.residues.mutLabel || "variant";
  const vdw = evidence.physical.readings.find(r => r.key === "vdw");
  const energeticsLink = onNavigateToView ? (
    <button type="button" className="ptb-link" onClick={() => onNavigateToView("energetics")}>
      Energetics <ArrowRight className="w-3 h-3" aria-hidden="true" />
    </button>
  ) : "Energetics";
  return (
    <section className="ptb-card ptb-hero" aria-labelledby="ptb-finding-title" data-testid="perturbation-finding">
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

        <div className="ptb-hero__figure">
          <span className="ptb-figure">{figure}</span>
          <span className="ptb-hero__figure-label">{figureLabel}</span>
        </div>

        <Prose className="ptb-hero__finding">
          <strong>{finding.headline}</strong>
          {" — "}
          {finding.predicate}.
        </Prose>
        <p className="ptb-hero__key">Odds compare the two probabilities: 100× means the model rates {wt} 100 times as likely as {mut}. ΔLLR is the same on a log scale (negative = {wt} preferred). Neither is an ACMG input.</p>

        <ModelStrip evidence={evidence} selectedId={selectedId} onSelect={onSelect} />

        {workspace.comparison && <details className="mol-finding-details" open={evidence.lms.some(l => l.availability.action) || undefined}><summary>Model records and availability</summary><ModelSupport evidence={evidence} onAction={onAction} /></details>}

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
    </section>
  );
}

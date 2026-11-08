import React from "react";
import { Atom, Sparkles } from "lucide-react";
import { type LmReading, type ModelAction, type PerturbationEvidence } from "../../../shared/perturbationEvidence";
import type { PerturbationModelId } from "../../../shared/perturbationModels";
import { directionCount, directionLabel, plainReading } from "../../../shared/perturbationSummary";
import { Prose } from "../../ui/Prose";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { oddsLine, rankLine } from "./format";
import { ModelNotices, StatusChip } from "./ModelAvailability";

/** Twenty cells in the model's own order, most likely first: the variant's rank in clay, the native's as an ink ring. */
function RankPips({ lm }: { lm: LmReading }) {
  return (
    <span className="ptb-model__pips" aria-hidden="true" data-flat={lm.direction === "flat" || undefined}>
      {Array.from({ length: 20 }, (_, i) => (
        <i key={i} data-here={lm.rank === i + 1 || undefined} data-native={lm.nativeRank === i + 1 || undefined} />
      ))}
    </span>
  );
}

/** A model that returned a reading: what it is, which amino acid it expects, by how much, and where the replacement ranks. */
function ModelReading({ lm, wt, mut }: { lm: LmReading; wt: string; mut: string }) {
  const rank = rankLine(lm, wt, mut);
  return (
    <>
      <span className="ptb-model__call">{directionLabel(lm, wt, mut) ?? "No score"}</span>
      <span className="ptb-model__odds">{oddsLine(lm, wt, mut) ?? ""}</span>
      {lm.rank !== null && <RankPips lm={lm} />}
      <span className="ptb-model__foot">{rank ?? "no rank returned"}</span>
    </>
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
  const wt = evidence.residues.wtLabel || "native";
  const mut = evidence.residues.mutLabel || "variant";
  return (
    <ol className="ptb-models" aria-label="How each language model reads the substitution">
      {evidence.lms.map(l => {
        const ok = l.availability.state === "computed";
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
              <span className="ptb-model__name">{l.name}</span>
              <span className="ptb-model__kind">{l.name !== l.family ? `Stands in for ${l.family}. ` : ""}{l.description}</span>
              {ok ? <ModelReading lm={l} wt={wt} mut={mut} /> : <StatusChip a={l.availability} />}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Tier 1, the finding, written for a reader who has not met a language model: how many models expect the
 * original amino acid, one plain sentence on what that means and does not mean, one card per model, and
 * a notice under any model that needs attention. Engine status, FoldX and served-model provenance are in
 * the Evidence Lineage rail, so they are not repeated here.
 */
export function FindingCard({ evidence, selectedId, onSelect, onAction }: {
  evidence: PerturbationEvidence;
  selectedId: PerturbationModelId | null;
  onSelect: (id: PerturbationModelId) => void;
  onAction: (action: ModelAction) => void;
}) {
  const { figure, label: figureLabel } = directionCount(evidence);
  const reading = plainReading(evidence);
  const wt = evidence.residues.wtLabel || "native";
  const mut = evidence.residues.mutLabel || "variant";
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
          <strong>{reading.lead}</strong>
          {reading.meaning && <> {reading.meaning}</>}
        </Prose>

        <ModelStrip evidence={evidence} selectedId={selectedId} onSelect={onSelect} />

        <p className="ptb-hero__key">
          Each bar lists the 20 amino acids from most likely (left) to least likely (right) for that model. The ring is {wt}, the original; the filled
          cell is {mut}, the replacement.
        </p>

        <ModelNotices evidence={evidence} onAction={onAction} />

        <p className="ptb-hero__key" data-testid="perturbation-engine-record">
          {evidence.engine.informational ? "Not counted in PP3/BP4. " : ""}No language model here has a
          published cut-point, so these readings are context for curation.
        </p>
        <div className="ptb-hero__guides">
          {evidence.lms.map(l => <ResearchGuideButton key={l.id} topic={/vesm/i.test(l.servedBy ?? "") ? "vesm" : l.id} label={`About ${l.name}`} />)}
        </div>
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

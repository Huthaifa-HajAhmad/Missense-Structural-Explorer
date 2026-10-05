import React from "react";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import {
  LOSS_OF_FUNCTION_CONSTRAINT_THRESHOLDS,
  mechanismFit,
  type GeneConstraint,
  type MechanismTerm,
} from "../../shared/literatureScreening";

interface MechanismPanelProps {
  terms: readonly MechanismTerm[];
  constraint: GeneConstraint | null;
  unavailableReason?: string;
}

const number = (value: number | null, digits = 2) => value === null ? "Not reported" : value.toFixed(digits);

export function MechanismPanel({ terms, constraint, unavailableReason }: MechanismPanelProps) {
  const fit = mechanismFit(terms, constraint);
  const termsText = terms.map(term => term.term).join(", ");
  const quote = terms[0]?.quote ?? "";
  const constraintText = constraint
    ? `LOEUF ${number(constraint.loeuf)} · pLI ${number(constraint.pli)} · missense Z ${number(constraint.missense_z)} · LOEUF constrained below ${LOSS_OF_FUNCTION_CONSTRAINT_THRESHOLDS.loeufConstrainedBelow}`
    : null;
  const reason = unavailableReason ?? `${ENGINE_STATE_LABELS["no-result"]} — gnomAD did not return gene constraint for this result.`;

  return (
    <section className="lit-mechanism" aria-label="For you to compare">
      <h4>For you to compare</h4>
      {fit.flag && <span className="ev-tier" data-tone="warning">{fit.flag}</span>}
      <dl>
        <div className="lit-mechanism__row">
          <dt>In the paper</dt>
          <dd>{termsText}{quote ? ` — “${quote}”` : ""}</dd>
        </div>
        <div className="lit-mechanism__row">
          <dt>Gene constraint</dt>
          <dd>
            {fit.state === "constraint-silent"
              ? "Constraint cannot speak to this mechanism."
              : fit.state === "unavailable"
                ? reason
                : constraintText}
          </dd>
        </div>
      </dl>
    </section>
  );
}

import React from "react";
import type { NumberingChoice } from "../shared/contracts";

/**
 * Asks which protein a notation's residue numbers belong to.
 *
 * A notation like `p.Asp85Phe` is only a variant GIVEN a protein: for a gene whose MANE protein is
 * numbered differently, the same letters also describe a different canonical residue. Nothing in the
 * input distinguishes the readings, so the analysis refuses rather than modelling one of them — and
 * this is how the reader answers. Every choice is already expressed in canonical numbering (the form
 * the whole pipeline uses), so picking one is a re-submit, not a second translation.
 *
 * No default is preselected and the prompt does not dismiss itself: the point is an explicit
 * decision, and an auto-picked reading would be exactly the silent wrong residue this exists to
 * prevent.
 */
export default function NumberingChoicePrompt({
  notation,
  choices,
  onChoose,
}: {
  notation: string;
  choices: NumberingChoice[];
  onChoose: (choice: NumberingChoice) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Choose the numbering for this notation"
      data-testid="numbering-choice-prompt"
      className="rounded-lg border px-3 py-3 flex flex-col gap-2"
      style={{
        borderColor: "var(--cs-border-strong, var(--cs-border))",
        background: "var(--cs-surface)",
      }}
    >
      <div className="text-[12px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
        Which numbering did you mean?
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
        <code style={{ fontFamily: "var(--cs-font-mono)" }}>{notation}</code> cannot be resolved by
        residue number alone — the same wild-type residue sits at different positions in two
        numberings of this protein. Pick the one your report used; each choice below is already written
        in the canonical numbering this platform models.
      </p>
      <div className="flex flex-col gap-1.5">
        {choices.map((choice) => (
          <button
            key={`${choice.basisId}-${choice.canonicalPosition}`}
            type="button"
            onClick={() => onChoose(choice)}
            data-testid={`numbering-choice-${choice.basisId}`}
            className="text-left rounded-md border px-2.5 py-2 text-[11px] transition-colors"
            style={{
              borderColor: "var(--cs-border)",
              color: "var(--cs-text-primary)",
            }}
          >
            <span className="font-semibold" style={{ fontFamily: "var(--cs-font-mono)" }}>
              {choice.variant}
            </span>
            <span className="ml-2" style={{ color: "var(--cs-text-secondary)" }}>
              {choice.label ?? choice.basisId}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px]" style={{ color: "var(--cs-text-secondary)" }}>
        Not sure? Enter the genomic/cDNA coordinate instead — it resolves the numbering against the
        annotated transcript, so nothing has to be inferred.
      </p>
    </div>
  );
}

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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  /**
   * Takes focus when it appears, and is labelled by its own question.
   *
   * The prompt is inserted ABOVE the fields while the Analyze button is at the bottom, so a keyboard
   * user who pressed Enter would otherwise re-submit the same refused notation; focus lands on the
   * question instead.
   *
   * `role="group"`, NOT `role="alert"`: the refusal itself is announced by the header's live region,
   * and two alerts for one event make a screen reader read the message and the question over each
   * other. The focus move is what makes the question heard.
   */
  React.useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="numbering-choice-prompt"
      // focus-guard-allow: programmatic focus target (tabIndex={-1}); the choice buttons inside carry the ring.
      className="rounded-lg border px-3 py-3 flex flex-col gap-2 focus:outline-none"
      style={{
        borderColor: "var(--cs-border)",
        background: "var(--cs-surface)",
      }}
    >
      <div id={titleId} className="text-[12px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
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
            className="text-left rounded-md border px-2.5 py-2 text-[11px] transition-colors cursor-pointer hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-1"
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

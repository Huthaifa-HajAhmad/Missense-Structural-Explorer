// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import NumberingChoicePrompt from "../NumberingChoicePrompt";
import type { NumberingChoice } from "../../shared/contracts";

/**
 * The prompt is the answer to a refusal: a notation like `p.Asp85Phe` is only a variant GIVEN a
 * protein, and for a gene whose MANE protein is numbered differently the same letters describe a
 * different canonical residue. The analysis refuses rather than picking one, so this control is what
 * converts the refusal into a decision.
 */
const CHOICES: NumberingChoice[] = [
  { variant: "p.Asp85Phe", basisId: "Q9Y305", basisKind: "canonical", canonicalPosition: 85, label: "Canonical numbering (Q9Y305)" },
  { variant: "p.Asp76Phe", basisId: "Q9Y305-4", basisKind: "isoform", canonicalPosition: 76, label: "MANE/isoform numbering (Q9Y305-4)" },
];

describe("NumberingChoicePrompt", () => {
  it("offers every reading with its basis, and quotes the notation as written", () => {
    render(<NumberingChoicePrompt notation="p.Asp85Phe" choices={CHOICES} onChoose={() => {}} />);

    expect(screen.getByText("Which numbering did you mean?")).toBeTruthy();
    expect(screen.getByTestId("numbering-choice-Q9Y305")).toBeTruthy();
    expect(screen.getByTestId("numbering-choice-Q9Y305-4")).toBeTruthy();
    expect(screen.getByText("p.Asp76Phe")).toBeTruthy();
    // The basis is stated, not just the notation: two canonical numbers with no explanation would
    // leave the reader guessing which one their report used.
    expect(screen.getByText(/MANE\/isoform numbering/)).toBeTruthy();
    // …and the unambiguous escape hatch is offered rather than implied.
    expect(screen.getByText(/genomic\/cDNA coordinate instead/i)).toBeTruthy();
  });

  it("chooses exactly what was clicked, and preselects nothing", () => {
    const onChoose = vi.fn();
    render(<NumberingChoicePrompt notation="p.Asp85Phe" choices={CHOICES} onChoose={onChoose} />);

    // Nothing is chosen until the reader chooses: an auto-picked reading would be the silent
    // wrong-residue answer this prompt exists to prevent.
    expect(onChoose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("numbering-choice-Q9Y305-4"));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toMatchObject({ variant: "p.Asp76Phe", basisKind: "isoform" });
  });
});

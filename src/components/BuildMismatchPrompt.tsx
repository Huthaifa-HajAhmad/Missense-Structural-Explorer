import React from "react";
import type { BuildHint } from "../shared/contracts";
import { ASSEMBLY_LABELS } from "../shared/assembly";

/**
 * Asks whether a coordinate whose alleles matched no reference base was read in the other build.
 *
 * WHY THIS EXISTS. A coordinate is only meaningful given a reference: the same locus can have a
 * different reference base in GRCh37 and GRCh38, so an hg19 coordinate read against GRCh38 looks
 * exactly like a typo — and every provider refuses it the same way ("the reference allele does not
 * match"). The refusal is correct and useless on its own: the reader is left to work out that the
 * build, not the position, is what changed. This turns that into one click.
 *
 * WHAT THE SERVER HAS ALREADY CHECKED. The offered notation is not a guess: the route verified that
 * the other build carries the submitted allele at that position before offering it (and withholds the
 * offer when it does not, saying so in the message instead). What is NOT proven is that the coordinate
 * belongs to that build — most positions carry the same base in both — so the copy calls it a
 * possibility to try, never a conclusion, and the retry is verified by the pipeline like any annotation.
 *
 * WHAT IT DOES NOT CLAIM. It never presents an assumed build as established: when the refusal carried
 * `buildDeclared: false`, the sentence says the build was read as the default, because "read as
 * GRCh38" and "stated as GRCh38" are different facts and only one of them was the reader's.
 *
 * Mirrors `NumberingChoicePrompt`: same card, same type scale, takes focus on mount, and does not
 * dismiss on its own — the reader decides, and the surrounding form keeps the refusal message.
 */
export default function BuildMismatchPrompt({
  notation,
  hint,
  onRetry,
  /**
   * Whether the build the coordinate was read against had been STATED (`(GRCh37)`, a RefSeq accession)
   * or was the server's default. `undefined` when the refusal carried no build trail, in which case
   * the copy says nothing about how the build was established.
   */
  buildDeclared,
}: {
  /** The coordinate as submitted, echoed so the reader recognises what is being questioned. */
  notation: string;
  hint: BuildHint;
  onRetry: (hint: BuildHint) => void;
  buildDeclared?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const label = ASSEMBLY_LABELS[hint.assembly];

  React.useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const readAs = hint.triedAssembly
    ? ` on ${hint.triedAssembly}${buildDeclared === false ? " (the default — no build was stated)" : ""}`
    : "";

  return (
    <div
      ref={containerRef}
      /**
       * `role="group"`, NOT `role="alert"`: the analysis error is already announced by the header's
       * live region, and two alerts for one event make a screen reader read the refusal and the
       * question over each other. The programmatic focus below still moves the reading position here.
       */
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="build-mismatch-prompt"
      // The container suppresses its focus outline WITH a stated reason: this is a PROGRAMMATIC focus
      // target (`tabIndex={-1}`), so a ring here would mark a surface the user never tabbed to. The
      // actionable control inside carries the ring instead.
      // (The token is deliberately not written out in prose — the repo-wide focus gate scans the
      // source text for it, so quoting it here would be read as a second, unexplained suppression.)
      //
      // focus-guard-allow: programmatic focus target (tabIndex={-1}); the retry button inside carries the ring.
      className="rounded-lg border px-3 py-3 flex flex-col gap-2 focus:outline-none"
      style={{
        borderColor: "var(--cs-border)",
        background: "var(--cs-surface)",
      }}
    >
      <div id={titleId} className="text-[12px] font-semibold" style={{ color: "var(--cs-text-primary)" }}>
        Is this coordinate in the other genome build?
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--cs-text-secondary)" }}>
        <code style={{ fontFamily: "var(--cs-font-mono)" }}>{notation}</code> has no matching reference
        base{readAs} — a coordinate read against the wrong build looks exactly like this, because the
        same locus can have a different reference base in GRCh37 and GRCh38. {hint.assembly} does carry
        the allele you submitted there, which is what makes the spelling below worth trying; nothing in
        your input changes until you pick it, and the retry is verified before it is annotated.
      </p>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => onRetry(hint)}
          data-testid={`build-mismatch-retry-${hint.assembly}`}
          className="text-left rounded-md border px-2.5 py-2 text-[11px] transition-colors cursor-pointer hover:bg-cs-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent-clay)] focus-visible:ring-offset-1"
          style={{
            borderColor: "var(--cs-border)",
            color: "var(--cs-text-primary)",
          }}
        >
          <span className="font-semibold" style={{ fontFamily: "var(--cs-font-mono)" }}>
            {hint.notation}
          </span>
          <span className="ml-2" style={{ color: "var(--cs-text-secondary)" }}>
            Try this as {label}
          </span>
        </button>
      </div>
      <p className="text-[10px]" style={{ color: "var(--cs-text-secondary)" }}>
        If the alleles themselves are wrong, correct the REF/ALT letters instead — retrying the other
        build will not help.
      </p>
    </div>
  );
}

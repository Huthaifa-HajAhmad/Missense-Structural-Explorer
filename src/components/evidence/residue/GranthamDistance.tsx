import React from "react";
import { ValueTrack } from "./ValueTrack";
import { GRANTHAM_CLASS_LIMITS, GRANTHAM_SCALE_MAX, type GranthamClass } from "../../../shared/residueContextEvidence";

/**
 * The substitution's Grantham distance as its own card: the number large, its class beside it, and the
 * number on the 0 to 215 axis with the class limits marked. It is a count of chemical difference, never
 * a measure of how likely the change is to cause disease, and the card says so. The limits and the top
 * of scale are the classifier's own constants, so the marks can never disagree with the chip.
 */
export function GranthamDistance({ distance, distanceClass }: { distance: number; distanceClass: GranthamClass }) {
  return (
    <section className="rsx-gr" data-testid="residue-grantham" aria-label={`Grantham distance ${distance}, ${distanceClass}`}>
      <header className="rsx-gr__head">
        <h3 className="rsx-label">Grantham distance</h3>
        <span className="ev-tier" data-tone="neutral">{distanceClass.charAt(0).toUpperCase() + distanceClass.slice(1)}</span>
      </header>
      <div className="rsx-gr__body">
        <p className="rsx-gr__value"><span className="rsx-gr__num rsx-mono">{distance}</span><span className="rsx-gr__of">of {GRANTHAM_SCALE_MAX}</span></p>
        <ValueTrack
          value={distance}
          max={GRANTHAM_SCALE_MAX}
          marks={GRANTHAM_CLASS_LIMITS}
          label={`Grantham distance ${distance} on a scale from 0 to ${GRANTHAM_SCALE_MAX}; the class limits are ${GRANTHAM_CLASS_LIMITS.join(", ")}.`}
        />
        <p className="rsx-gr__note">
          How chemically different the two amino acids are, from composition, polarity and size. A larger score is a bigger difference, not a higher chance of disease. Dashed marks are the class limits (Li, Wu and Luo 1984).
        </p>
      </div>
    </section>
  );
}

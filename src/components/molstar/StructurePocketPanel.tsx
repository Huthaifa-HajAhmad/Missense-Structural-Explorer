import React from "react";
import { ArrowRight, Eye, EyeOff, X } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import type { PocketNarrative } from "../../shared/residueShiftEvidence";

/**
 * The 3D view's pocket panel, rendered from the SAME `derivePocketNarrative` model as the Residue
 * shifts and pockets tab, so the two cannot describe one pocket two ways.
 *
 * It replaced an "Active Site Cavity Solver" that printed P2Rank's score as "Affinity Prob. N%" (the
 * score is not always a probability, and a pocket's ligandability is not an affinity), a "Likely
 * Target Co-Factor" the Residue shifts tab had already removed as unfounded, a volume in Å³ when only
 * surface points were measured, and a pointer to the wrong tab.
 */
export function StructurePocketPanel({
  pocket,
  variantPosition,
  showOnStructure,
  onToggleShow,
  onFocusResidue,
  onOpenTab,
  onClose,
}: {
  pocket: PocketNarrative;
  variantPosition: number | null;
  showOnStructure: boolean;
  onToggleShow: () => void;
  onFocusResidue: (index: number) => void;
  onOpenTab?: () => void;
  onClose: () => void;
}) {
  const residues = pocket.lining.byDistance.slice(0, 10);
  return (
    <section className="s3d-pocket" aria-label="Predicted ligand pocket" data-testid="structure-pocket">
      <div className="s3d-pocket__head">
        <h3 className="s3d-label">Predicted pocket · P2Rank</h3>
        <button type="button" className="s3d-legend__toggle" onClick={onClose} aria-label="Close the pocket panel">
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="s3d-pocket__body">
        {pocket.status === "success" ? (
          <>
            <p className="s3d-pocket__statement">
              <strong>{pocket.headline}</strong>
              {pocket.proximity.detail}
            </p>
            <dl className="s3d-kv">
              <div className="s3d-kv__row">
                <dt>Distance</dt>
                <dd>
                  <span className="s3d-mono">{pocket.proximity.distance !== null ? `${pocket.proximity.distance.toFixed(1)} Å` : "Not reported"}</span>
                  <span className="s3d-kv__note">to {pocket.proximity.reference}</span>
                </dd>
              </div>
              <div className="s3d-kv__row">
                <dt>{pocket.ranking.kind === "probability" ? "Ligand-site probability" : "P2Rank score"}</dt>
                <dd>
                  <span className="s3d-mono">{pocket.ranking.display ?? "Not reported"}</span>
                  <span className="s3d-kv__note">
                    {pocket.ranking.kind === "probability" ? "P2Rank's estimate that the cavity binds a ligand" : "not a probability"}
                  </span>
                </dd>
              </div>
              <div className="s3d-kv__row">
                <dt>Cavity size</dt>
                <dd>
                  <span className="s3d-mono">
                    {pocket.volume.isMeasured && pocket.volume.volume !== null
                      ? `${pocket.volume.volume.toLocaleString()} Å³`
                      : pocket.volume.surfacePoints !== null
                        ? `${pocket.volume.surfacePoints} surface points`
                        : "Not reported"}
                  </span>
                  {!pocket.volume.isMeasured && <span className="s3d-kv__note">no volume was measured</span>}
                </dd>
              </div>
            </dl>
            {residues.length > 0 && (
              <>
                <h4 className="s3d-label">Lining residues · nearest to {variantPosition ?? "the site"} first</h4>
                <ul className="s3d-residues">
                  {residues.map(res => (
                    <li key={`${res.chain ?? ""}-${res.index}`}>
                      <button
                        type="button"
                        className="s3d-residue"
                        onClick={() => onFocusResidue(res.index)}
                        aria-label={`Frame ${res.name} ${res.index}, ${res.distance.toFixed(1)} Å from the variant`}
                      >
                        <span>{res.name.charAt(0)}{res.name.slice(1).toLowerCase()}{res.index}</span>
                        <span>{res.distance.toFixed(1)} Å</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button type="button" className="s3d-btn" aria-pressed={showOnStructure} onClick={onToggleShow}>
              {showOnStructure ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {showOnStructure ? "Hide on the structure" : "Show on the structure"}
            </button>
          </>
        ) : (
          <p className="s3d-pocket__statement">
            <strong>{pocket.status === "loading" ? ENGINE_STATE_LABELS.running : pocket.headline}</strong>
            {pocket.plainLanguage}
          </p>
        )}
        {onOpenTab && (
          <button type="button" className="s3d-link" onClick={onOpenTab}>
            Residue shifts and pockets
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="s3d-pocket__foot">P2Rank ran on the pipeline's wild-type structure. No ACMG criterion reads the pocket.</div>
    </section>
  );
}

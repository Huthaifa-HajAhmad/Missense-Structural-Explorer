import React from "react";
import { ArrowLeftRight } from "lucide-react";

export interface StructureStatusProps {
  hasVariant: boolean;
  loading: boolean;
  loadError: string | null;
  customEntryLoaded: boolean;
  onClearEntry?: () => void;
  onRetryLoad?: () => void;
}

/**
 * Every state of the canvas that is not "coordinates drawn", as a sentence on a card.
 *
 * Replaced full-bleed pulsing uppercase banners ("PREDICTING 3D MUTANT STRUCTURE VIA ESMFOLD-2…" while
 * the WILD TYPE was also being folded), a rose error card that offered "Configure API Key" for every
 * failure, and an onboarding card claiming "3D Molecular Workspace Ready".
 */
export function StructureStatusOverlay(p: StructureStatusProps) {
  if (!p.hasVariant) {
    return (
      <div className="s3d-overlay" role="status">
        <div className="s3d-overlay__card s3d-overlay__card--quiet">
          <p className="s3d-overlay__title">No variant loaded</p>
          <p className="s3d-overlay__body">Search a variant to load its structure.</p>
        </div>
      </div>
    );
  }

  if (p.loadError) {
    return (
      <div className="s3d-overlay" role="alert">
        <div className="s3d-overlay__card">
          <p className="s3d-overlay__title">The structure could not be drawn</p>
          <p className="s3d-overlay__body">{p.loadError}</p>
          {p.customEntryLoaded && p.onClearEntry && (
            <div className="s3d-overlay__actions">
              <button type="button" className="s3d-btn" onClick={p.onClearEntry}>
                <ArrowLeftRight aria-hidden="true" />
                Back to the AlphaFold model
              </button>
              {p.onRetryLoad && <button type="button" className="s3d-btn" onClick={p.onRetryLoad}>Retry loading coordinates</button>}
            </div>
          )}
          {!p.customEntryLoaded && p.onRetryLoad && (
            <div className="s3d-overlay__actions"><button type="button" className="s3d-btn" onClick={p.onRetryLoad}>Retry loading coordinates</button></div>
          )}
        </div>
      </div>
    );
  }

  if (p.loading) {
    return (
      <div className="s3d-overlay" role="status" aria-live="polite">
        <div className="s3d-overlay__card s3d-overlay__card--quiet">
          <span className="s3d-spinner" aria-hidden="true" />
          <p className="s3d-overlay__body">Loading coordinates</p>
        </div>
      </div>
    );
  }

  return null;
}

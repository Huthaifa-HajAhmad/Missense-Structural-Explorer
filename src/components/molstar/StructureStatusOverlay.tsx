import React from "react";
import { ArrowLeftRight, Settings } from "lucide-react";
import {
  ESM_ATLAS_PUBLIC_MAX_AA,
  JAPANFOLD_ESMFOLD2_MAX_AA,
  describeDeNovoFoldTimeout,
  formatResidueCount,
  isFoldingLengthLimitError,
  isFoldingTimeoutError,
  parseReportedSequenceLength,
  resolveDeNovoFoldingCapacity,
} from "../../shared/foldingLimits";
import { ENGINE_STATE_LABELS } from "../../shared/engineStatus";
import type { ModelFamily } from "../../shared/structure3dEvidence";

export interface StructureStatusProps {
  family: ModelFamily;
  hasVariant: boolean;
  loading: boolean;
  loadError: string | null;
  deNovoFolding: boolean;
  deNovoError: string | null;
  deNovoLoaded: boolean;
  proteinLength: number | null;
  scanWindowLength: number | null;
  customEntryLoaded: boolean;
  onSwitchToAlphaFold?: () => void;
  onClearEntry?: () => void;
  onOpenSettings?: () => void;
  onRetryStructural?: () => void;
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

  if (p.family === "esmfold") {
    if (p.deNovoFolding) {
      return (
        <div className="s3d-overlay" role="status" aria-live="polite">
          <div className="s3d-overlay__card s3d-overlay__card--quiet">
            <span className="s3d-spinner" aria-hidden="true" />
            <p className="s3d-overlay__title">Folding the wild type and the variant</p>
            <p className="s3d-overlay__body">
              Two single-sequence predictions, one after the other. The server tries ESMFold2-Fast first; the engine that answers is named once the structures arrive.
            </p>
          </div>
        </div>
      );
    }
    if (!p.deNovoLoaded) {
      const reported = parseReportedSequenceLength(p.deNovoError);
      const residues = reported ?? p.proteinLength;
      const isLength = isFoldingLengthLimitError(p.deNovoError);
      const isTimeout = isFoldingTimeoutError(p.deNovoError);
      const beyondTier1 = residues !== null && !resolveDeNovoFoldingCapacity(residues).tier1Available;
      const title = isLength
        ? beyondTier1
          ? `Too long for de novo folding (${formatResidueCount(JAPANFOLD_ESMFOLD2_MAX_AA)} aa ceiling)`
          : `Too long for the public ESM Atlas (${ESM_ATLAS_PUBLIC_MAX_AA} aa ceiling)`
        : isTimeout
          ? "De novo folding timed out"
          : p.deNovoError
            ? "De novo folding did not return coordinates"
            : ENGINE_STATE_LABELS["no-result"];
      const body = isTimeout
        ? describeDeNovoFoldTimeout({ residues, verbosity: "detailed" })
        : p.deNovoError ?? "No de novo structure has been produced for this variant.";
      return (
        <div className="s3d-overlay" role="alert">
          <div className="s3d-overlay__card">
            <p className="s3d-overlay__title">{title}</p>
            <p className="s3d-overlay__body">{body}</p>
            {(residues !== null || p.scanWindowLength !== null) && (
              <div className="s3d-overlay__facts">
                {residues !== null && <span className="ev-tier" data-tone="neutral">Protein {formatResidueCount(residues)} aa</span>}
                {p.scanWindowLength !== null && (
                  <span className="ev-tier" data-tone="muted" title="The residue landscape covers a window around the variant, not the whole protein.">
                    Scan window {formatResidueCount(p.scanWindowLength)} aa
                  </span>
                )}
              </div>
            )}
            <div className="s3d-overlay__actions">
              {p.onSwitchToAlphaFold && (
                <button type="button" className="s3d-btn" onClick={p.onSwitchToAlphaFold}>
                  <ArrowLeftRight aria-hidden="true" />
                  Open the AlphaFold2 view
                </button>
              )}
              {!isLength && p.onRetryStructural && (
                <button type="button" className="s3d-btn" onClick={p.onRetryStructural}>Retry folding</button>
              )}
              {isLength && p.onOpenSettings && (
                <button type="button" className="s3d-btn" onClick={p.onOpenSettings}>
                  <Settings aria-hidden="true" />
                  Add a Biohub token
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
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
              {p.onRetryStructural && <button type="button" className="s3d-btn" onClick={p.onRetryStructural}>Retry structural analysis</button>}
            </div>
          )}
          {!p.customEntryLoaded && p.onRetryStructural && (
            <div className="s3d-overlay__actions"><button type="button" className="s3d-btn" onClick={p.onRetryStructural}>Retry structural analysis</button></div>
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

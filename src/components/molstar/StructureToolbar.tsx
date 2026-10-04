import React, { useRef } from "react";
import { Camera, ChevronDown, ClipboardCopy, Crosshair, Download, HelpCircle, Maximize2, Minimize2, ScanSearch, Undo2 } from "lucide-react";
import type { AlignmentScope, RepresentationId, Structure3dEvidence, ViewMode } from "../../shared/structure3dEvidence";
import type { PlddtFilter } from "./useMolstarStructure";
import { LOCAL_ALIGNMENT_FIT_WINDOW } from "../../shared/thresholds";

/**
 * The 3D view's toolbar — every control reads the evidence model.
 *
 * Replaces a toolbar that named the canvas from the store's last-written provenance ("RCSB PDB: 1YOV"
 * over the AlphaFold model), offered an "ESMFold-2 / ESM3 Allosteric Heatmap" in the FoldX view, showed
 * a pLDDT filter for crystal temperature factors, called a ±15 sequence window a "Local Pocket", and
 * labelled a panel toggle "Run binding pocket analysis". The model switch lived only in the inspector,
 * so collapsing the inspector left the canvas without it.
 */
export interface StructureToolbarProps {
  model: Structure3dEvidence;
  variantPosition: number | null;
  selectedResidue: number | null;
  onModeChange: (mode: ViewMode) => void;
  onRepresentationChange: (rep: RepresentationId) => void;
  plddtFilter: PlddtFilter;
  onPlddtFilterChange: (value: PlddtFilter) => void;
  onAlignmentScopeChange?: (scope: AlignmentScope) => void;
  onFocusSite: () => void;
  onBackToSite: () => void;
  pocketOpen: boolean;
  onTogglePocket: () => void;
  captureOpen: boolean;
  setCaptureOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  captureMenuRef: React.RefObject<HTMLDivElement | null>;
  onDownload: () => void;
  onCopy: () => void;
  copyState: "idle" | "copied" | "failed";
  onOpenGuide: () => void;
  onSwitchToAlphaFold?: () => void;
  onSwitchToEsmFold?: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function StructureToolbar(props: StructureToolbarProps) {
  const { model } = props;
  const segRef = useRef<HTMLDivElement>(null);
  const primary = model.canvas.primary;
  const site = model.site;

  const onSegKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const available = model.modes.filter(m => m.available);
    const i = available.findIndex(m => m.id === model.viewMode);
    const step = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
    const next = available[(i + step + available.length) % available.length];
    if (next && next.id !== model.viewMode) {
      props.onModeChange(next.id);
      segRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${next.id}"]`)?.focus();
    }
  };

  return (
    <div className="s3d-bar" role="toolbar" aria-label="3D structure controls">
      <div className="s3d-bar__row">
        <span className="s3d-ident" data-tone={model.canvas.chip.tone} title={model.canvas.chip.title} data-testid="structure-source">
          <span className="s3d-ident__dot" aria-hidden="true" />
          <span className="s3d-ident__name">{model.canvas.chip.label}</span>
          {primary && <span className="s3d-ident__kind">{primary.kind}</span>}
        </span>
        {site.substitution && (
          <button type="button" className="s3d-site" onClick={props.onFocusSite} title="Frame the variant site" data-testid="structure-site">
            <Crosshair aria-hidden="true" />
            {site.substitution}
          </button>
        )}
        {props.onSwitchToAlphaFold && props.onSwitchToEsmFold && (
          <div className="s3d-family" role="group" aria-label="Structure family">
            <button type="button" className="s3d-family__btn" aria-pressed={model.family === "alphafold"} onClick={props.onSwitchToAlphaFold}>AlphaFold</button>
            <button type="button" className="s3d-family__btn" aria-pressed={model.family === "esmfold"} onClick={props.onSwitchToEsmFold}>ESMFold</button>
          </div>
        )}
        {props.selectedResidue !== null && props.selectedResidue !== props.variantPosition && (
          <button type="button" className="s3d-site" data-kind="selected" onClick={props.onBackToSite} title="Clear the selection and return to the variant site">
            Selected {props.selectedResidue}
            <Undo2 aria-hidden="true" />
          </button>
        )}
        <span className="s3d-bar__spacer" />
        <button type="button" className="s3d-btn" onClick={props.onOpenGuide} title="How to read this view" aria-label="Guide: how to read this view">
          <HelpCircle aria-hidden="true" />
          <span className="s3d-btn__text">Guide</span>
        </button>
        <button
          type="button"
          className="s3d-btn s3d-btn--icon"
          onClick={props.onToggleFullscreen}
          aria-label={props.isFullscreen ? "Exit full screen" : "Full screen"}
          title={props.isFullscreen ? "Exit full screen" : "Full screen"}
        >
          {props.isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
      </div>

      <div className="s3d-bar__row">
        <div className="s3d-bar__group">
          <div className="s3d-seg" role="radiogroup" aria-label="Coordinates shown" ref={segRef} onKeyDown={onSegKey} data-testid="structure-modes">
            {model.modes.map(mode => {
              const checked = model.viewMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  data-mode={mode.id}
                  className="s3d-seg__btn"
                  aria-checked={checked}
                  aria-disabled={!mode.available}
                  tabIndex={checked ? 0 : -1}
                  title={mode.reason ?? undefined}
                  onClick={() => mode.available && props.onModeChange(mode.id)}
                >
                  {mode.busy && !mode.available && <span className="s3d-seg__busy" aria-hidden="true" />}
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="s3d-bar__group">
          <label className="s3d-field">
            <span className="s3d-label">Colour</span>
            <select
              className="s3d-select"
              value={model.representation}
              onChange={e => props.onRepresentationChange(e.target.value as RepresentationId)}
              data-testid="structure-colour"
            >
              {model.representations.map(r => (
                <option key={r.id} value={r.id} disabled={!r.available} title={r.reason ?? undefined}>
                  {r.label}{r.available ? "" : " — not available"}
                </option>
              ))}
            </select>
          </label>
          {model.plddtFilter.available && (
            <label className="s3d-field">
              <span className="s3d-label">Show</span>
              <select className="s3d-select" value={props.plddtFilter} onChange={e => props.onPlddtFilterChange(e.target.value as PlddtFilter)}>
                <option value="none">All residues</option>
                <option value="50">pLDDT ≥ 50</option>
                <option value="70">pLDDT ≥ 70</option>
              </select>
            </label>
          )}
          {model.alignment.scopeToggle && props.onAlignmentScopeChange && (
            <label className="s3d-field">
              <span className="s3d-label">Fit</span>
              <select
                className="s3d-select"
                value={model.alignment.scope}
                onChange={e => props.onAlignmentScopeChange!(e.target.value as AlignmentScope)}
                title="Which Cα atoms the Kabsch superposition fits"
              >
                <option value="global">Whole chain</option>
                <option value="local">±{LOCAL_ALIGNMENT_FIT_WINDOW} residues around the site</option>
              </select>
            </label>
          )}
        </div>

        <div className="s3d-bar__group">
          <button
            type="button"
            className="s3d-btn"
            aria-pressed={props.pocketOpen}
            onClick={props.onTogglePocket}
            title="Show the predicted ligand pocket nearest the variant"
            aria-label="Pocket"
          >
            <ScanSearch aria-hidden="true" />
            <span className="s3d-btn__text">Pocket</span>
          </button>
          <div className="s3d-menu-wrap" ref={props.captureMenuRef}>
            <button
              type="button"
              className="s3d-btn"
              aria-haspopup="menu"
              aria-expanded={props.captureOpen}
              aria-label="Save or copy an image of the view"
              onClick={() => props.setCaptureOpen(p => !p)}
            >
              <Camera aria-hidden="true" />
              <span className="s3d-btn__text">{props.copyState === "copied" ? "Copied" : props.copyState === "failed" ? "Copy failed" : "Image"}</span>
              <ChevronDown aria-hidden="true" />
            </button>
            {props.captureOpen && (
              <div className="s3d-menu" role="menu">
                <button type="button" role="menuitem" className="s3d-menu__item" onClick={props.onDownload}>
                  <Download aria-hidden="true" />
                  Download PNG
                </button>
                <button type="button" role="menuitem" className="s3d-menu__item" onClick={props.onCopy}>
                  <ClipboardCopy aria-hidden="true" />
                  Copy to clipboard
                </button>
                <p className="s3d-menu__note">The file name records the structure and the colouring.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

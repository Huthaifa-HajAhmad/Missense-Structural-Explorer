import React, { useEffect, useId, useRef, useState } from "react";
import {
  Camera, ChevronDown, ClipboardCopy, Crosshair, Download, HelpCircle,
  Maximize2, Minimize2, ScanSearch, SlidersHorizontal,
} from "lucide-react";
import type { AlignmentScope, RepresentationId, Structure3dEvidence, ViewMode } from "../../shared/structure3dEvidence";
import type { PlddtFilter } from "./useMolstarStructure";
import { LOCAL_ALIGNMENT_FIT_WINDOW } from "../../shared/thresholds";

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
  onFocusSelection?: () => void;
  pocketOpen: boolean;
  pocketTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  onTogglePocket: () => void;
  captureOpen: boolean;
  setCaptureOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  captureMenuRef: React.RefObject<HTMLDivElement | null>;
  onDownload: () => void;
  onCopy: () => void;
  copyState: "idle" | "copied" | "failed";
  onOpenGuide: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

/** Source and coordinate mode stay visible; less frequent display controls live in one disclosure. */
export function StructureToolbar(props: StructureToolbarProps) {
  const { model } = props;
  const [displayOpen, setDisplayOpen] = useState(false);
  const displayId = useId();
  const displayRef = useRef<HTMLDivElement>(null);
  const displayTriggerRef = useRef<HTMLButtonElement>(null);
  const captureTriggerRef = useRef<HTMLButtonElement>(null);
  const segRef = useRef<HTMLDivElement>(null);
  const primary = model.canvas.primary;
  const site = model.site;
  const representation = model.representations.find(r => r.id === model.representation);

  useEffect(() => {
    if (!displayOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!displayRef.current?.contains(event.target as Node)) setDisplayOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDisplayOpen(false);
        displayTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [displayOpen]);

  const onSegKey = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const available = model.modes.filter(mode => mode.available);
    const current = available.findIndex(mode => mode.id === model.viewMode);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = available[event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : (current + step + available.length) % available.length];
    if (next && next.id !== model.viewMode) {
      props.onModeChange(next.id);
      segRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${next.id}"]`)?.focus();
    }
  };

  return (
    <div className="s3d-bar" role="toolbar" aria-label="3D structure controls">
      <div className="s3d-bar__top">
        <div className="s3d-bar__identity">
          <span className="s3d-ident" data-tone={model.canvas.chip.tone} title={model.canvas.chip.title} data-testid="structure-source">
            <span className="s3d-ident__dot" aria-hidden="true" />
            <span className="s3d-ident__name">{model.canvas.chip.label}</span>
          </span>
          {primary && <span className="s3d-ident__kind">{primary.kind}</span>}
        </div>
        <div className="s3d-bar__top-actions">
          {site.substitution && (
            site.canAddressVariantSite ? (
              <button type="button" className="s3d-site" onClick={props.onFocusSite} title="Frame the variant site" data-testid="structure-site">
                <Crosshair aria-hidden="true" />{site.substitution}
              </button>
            ) : (
              <span className="s3d-site" data-kind="unmapped" title={site.check.text} data-testid="structure-site">
                {site.substitution} · site unmapped
              </span>
            )
          )}
          {props.selectedResidue !== null && props.selectedResidue !== props.variantPosition && site.canAddressVariantSite && (
            <button type="button" className="s3d-site" data-kind="selected" onClick={props.onFocusSelection} disabled={!props.onFocusSelection} aria-label={`Selected ${props.selectedResidue}, frame on structure`} title="Frame the selected residue">
              Selected {props.selectedResidue}<Crosshair aria-hidden="true" />
            </button>
          )}
          <button type="button" className="s3d-btn s3d-btn--quiet" onClick={props.onOpenGuide} title="How to read this view" aria-label="Guide: how to read this view">
            <HelpCircle aria-hidden="true" /><span className="s3d-btn__text">Guide</span>
          </button>
          <button
            type="button" className="s3d-btn s3d-btn--icon s3d-btn--quiet"
            onClick={props.onToggleFullscreen}
            aria-label={props.isFullscreen ? "Exit full screen" : "Full screen"}
            title={props.isFullscreen ? "Exit full screen" : "Full screen"}
          >
            {props.isFullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </div>
      </div>

      <div className="s3d-bar__bottom">
        <div className="s3d-seg" role="radiogroup" aria-label="Coordinates shown" ref={segRef} onKeyDown={onSegKey} data-testid="structure-modes">
          {model.modes.map(mode => (
            <button
              key={mode.id} type="button" role="radio" data-mode={mode.id}
              className="s3d-seg__btn" aria-checked={model.viewMode === mode.id}
              aria-disabled={!mode.available} tabIndex={model.viewMode === mode.id ? 0 : -1}
              title={mode.reason ?? undefined}
              onClick={() => mode.available && props.onModeChange(mode.id)}
            >
              {mode.busy && !mode.available && <span className="s3d-seg__busy" aria-hidden="true" />}
              {mode.label}
            </button>
          ))}
        </div>
        <span className="s3d-bar__divider" aria-hidden="true" />
        <div className="s3d-display-wrap" ref={displayRef}>
          <button
            ref={displayTriggerRef} type="button" className="s3d-btn s3d-btn--display"
            aria-expanded={displayOpen} aria-controls={displayId}
            onClick={() => setDisplayOpen(open => !open)}
          >
            <SlidersHorizontal aria-hidden="true" />
            <span>Display</span>
            <span className="s3d-btn__value">{representation?.label ?? "Options"}</span>
            <ChevronDown aria-hidden="true" />
          </button>
          {displayOpen && (
            <div className="s3d-display" id={displayId} role="region" aria-label="Structure display options">
              <label className="s3d-display__field">
                <span className="s3d-display__label">Colour by</span>
                <select
                  className="s3d-select" value={model.representation}
                  onChange={event => props.onRepresentationChange(event.target.value as RepresentationId)}
                  data-testid="structure-colour"
                >
                  {model.representations.map(item => (
                    <option key={item.id} value={item.id} disabled={!item.available}>
                      {item.label}{item.available ? "" : " — unavailable"}
                    </option>
                  ))}
                </select>
              </label>
              {model.representation === "esm3" && (
                <p className="s3d-display__note">Sequence difference projected onto wild-type coordinates; this is not structural motion.</p>
              )}
              {model.plddtFilter.available && (
                <label className="s3d-display__field">
                  <span className="s3d-display__label">Show residues</span>
                  <select className="s3d-select" value={props.plddtFilter} onChange={event => props.onPlddtFilterChange(event.target.value as PlddtFilter)}>
                    <option value="none">All residues</option>
                    <option value="50">pLDDT ≥ 50</option>
                    <option value="70">pLDDT ≥ 70</option>
                  </select>
                </label>
              )}
              {model.alignment.scopeToggle && props.onAlignmentScopeChange && (
                <label className="s3d-display__field">
                  <span className="s3d-display__label">Fit Cα atoms</span>
                  <select className="s3d-select" value={model.alignment.scope} onChange={event => props.onAlignmentScopeChange!(event.target.value as AlignmentScope)}>
                    <option value="global">Whole chain</option>
                    <option value="local">±{LOCAL_ALIGNMENT_FIT_WINDOW} residues around the site</option>
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
        <div className="s3d-bar__tools">
          <button
            ref={props.pocketTriggerRef} type="button" className="s3d-btn" aria-pressed={props.pocketOpen}
            onClick={props.onTogglePocket} title="Inspect the predicted pocket from the pipeline structure"
          >
            <ScanSearch aria-hidden="true" /><span>Pocket</span>
          </button>
          <div className="s3d-menu-wrap" ref={props.captureMenuRef}>
            <button
              ref={captureTriggerRef} type="button" className="s3d-btn"
              aria-expanded={props.captureOpen} aria-label="Save or copy an image of the view"
              onClick={() => props.setCaptureOpen(open => !open)}
            >
              <Camera aria-hidden="true" />
              <span>{props.copyState === "copied" ? "Copied" : props.copyState === "failed" ? "Copy failed" : "Image"}</span>
              <ChevronDown aria-hidden="true" />
            </button>
            {props.captureOpen && (
              <div
                className="s3d-menu" role="group" aria-label="Image actions"
                onKeyDown={event => {
                  if (event.key === "Escape") {
                    props.setCaptureOpen(false);
                    captureTriggerRef.current?.focus();
                  }
                }}
              >
                <button type="button" className="s3d-menu__item" onClick={props.onDownload}>
                  <Download aria-hidden="true" />Download PNG
                </button>
                <button type="button" className="s3d-menu__item" onClick={props.onCopy}>
                  <ClipboardCopy aria-hidden="true" />Copy to clipboard
                </button>
                <p className="s3d-menu__note">The filename records the structure and colouring.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

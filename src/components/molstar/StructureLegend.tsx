import React, { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Legend } from "../../shared/structure3dEvidence";

/** 0xRRGGBB → "#rrggbb". The swatch must match the WebGL colour exactly, so it is data, not a theme token. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * The on-canvas key for the current colouring, collapsed to its title until the reader opens it.
 *
 * Open, it is one coloured scale: a segment per band, and under it the band's range (or its name when
 * the band has no range). The full band name sits in the tooltip. The source of the bands is one
 * short line; a key drawn with a dashed border is app-defined, not published.
 */
export function StructureLegend({ legend }: { legend: Legend | null }) {
  const [open, setOpen] = useState(false);
  if (!legend) return null;
  const byRange = legend.entries.every(entry => entry.range);
  return (
    <section
      className="s3d-legend"
      data-provenance={legend.provenance}
      data-collapsed={!open ? "true" : undefined}
      aria-label={`Colour key: ${legend.title}`}
      data-testid="structure-legend"
    >
      <div className="s3d-legend__head">
        <div className="s3d-legend__head-lead">
          <h3 className="s3d-legend__title">{legend.title}</h3>
          {!open && (
            <span className="s3d-legend__mini-bar" aria-hidden="true">
              {legend.entries.map(entry => (
                <span
                  key={`${entry.label}-${entry.color}`}
                  className="s3d-legend__mini-seg"
                  style={{ "--s3d-swatch": hex(entry.color) } as React.CSSProperties}
                />
              ))}
            </span>
          )}
        </div>
        <button
          type="button"
          className="s3d-legend__toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="s3d-legend-body"
          aria-label={open ? "Hide colour key" : "Show colour key"}
        >
          {open ? <Minus className="w-3.5 h-3.5" aria-hidden="true" /> : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <div id="s3d-legend-body" role="region" aria-label={`Colour key bands: ${legend.title}`}>
          <ul className="s3d-legend__list" data-by={byRange ? "range" : "label"} style={{ "--s3d-bands": legend.entries.length } as React.CSSProperties}>
            {legend.entries.map(entry => (
              <li key={`${entry.label}-${entry.color}`} className="s3d-legend__item" title={entry.range ? `${entry.label} ${entry.range}` : entry.label}>
                <span className="s3d-legend__swatch" style={{ "--s3d-swatch": hex(entry.color) } as React.CSSProperties} aria-hidden="true" />
                <span className="s3d-legend__label">{byRange ? entry.range : entry.label}</span>
                {byRange && <span className="sr-only">{entry.label}</span>}
              </li>
            ))}
          </ul>
          <p className="s3d-legend__source" title={legend.provenanceNote}>{legend.provenanceNote}</p>
        </div>
      )}
    </section>
  );
}

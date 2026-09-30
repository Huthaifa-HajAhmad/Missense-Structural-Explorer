import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Legend } from "../../shared/structure3dEvidence";

/** 0xRRGGBB → "#rrggbb". The swatch must match the WebGL colour exactly, so it is data, not a theme token. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * The on-canvas key for the current colouring.
 *
 * The viewer had none: the pLDDT, B-factor, displacement and "allosteric" colourings were drawn with
 * no key on screen, and the only legend component in the codebase was a modal no control opened.
 * Each key states where its bands come from — published, relative to this entry, or this app's own
 * marks (drawn with a dashed border, the house sign for "app-defined").
 */
export function StructureLegend({ legend }: { legend: Legend | null }) {
  const [open, setOpen] = useState(true);
  if (!legend) return null;
  return (
    <section className="s3d-legend" data-provenance={legend.provenance} aria-label={`Colour key: ${legend.title}`} data-testid="structure-legend">
      <div className="s3d-legend__head">
        <h3 className="s3d-legend__title">{legend.title}</h3>
        <button
          type="button"
          className="s3d-legend__toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={open ? "Hide colour key" : "Show colour key"}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <>
          <ul className="s3d-legend__list">
            {legend.entries.map(entry => (
              <li key={`${entry.label}-${entry.color}`} className="s3d-legend__item">
                <span className="s3d-legend__swatch" style={{ "--s3d-swatch": hex(entry.color) } as React.CSSProperties} aria-hidden="true" />
                <span>{entry.label}</span>
                {entry.range && <span className="s3d-legend__range">{entry.range}</span>}
              </li>
            ))}
          </ul>
          <p className="s3d-legend__source">{legend.provenanceNote}</p>
        </>
      )}
    </section>
  );
}

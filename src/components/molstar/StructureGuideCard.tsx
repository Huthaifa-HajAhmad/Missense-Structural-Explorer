import React, { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";

/** 0xRRGGBB → "#rrggbb": a swatch must be the drawn WebGL colour, so it is data, not a theme token. */
const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

export interface CanvasGuideItem {
  key: string;
  /** The drawn colour, when the item has one. */
  color: number | null;
  /** "sticks", "surface", "dashes": how the item is drawn, so the swatch can be matched on screen. */
  shape: "sticks" | "surface" | "dashes";
  text: string;
  /** A second line: provenance or a frame of reference. */
  sub?: string;
}

/**
 * "On this canvas": what each highlighted thing on the structure is, with its drawn colour and where it
 * came from, plus the reader's own label choice and the guide to reading a structure.
 *
 * The viewer drew a variant site, companion residues, a selection and a pocket with no key on screen
 * beyond the colour legend, and a 67-residue Hotspots set as unlabelled blue sticks. Every line here is
 * read from what the hook was asked to draw; nothing is chosen for the reader.
 */
export function StructureGuideCard({ items, labels, onToggleLabels, labelAll, onToggleLabelAll, onOpenGuide }: {
  items: CanvasGuideItem[];
  labels: boolean;
  onToggleLabels: () => void;
  /** Present when a highlighted set is larger than the default labelled size. `labelled` is the number the
   *  canvas will actually label, which is capped; it defaults to `count`. */
  labelAll: { count: number; labelled?: number; on: boolean } | null;
  onToggleLabelAll: () => void;
  onOpenGuide: () => void;
}) {
  // Open by default where there is room for it; on a short stage the list would cover the variant site,
  // so it starts collapsed and the reader opens it.
  const [open, setOpen] = useState(() => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(min-height: 640px)").matches);
  if (!items.length) return null;
  return (
    <section className="s3d-guide" aria-label="On this canvas" data-testid="structure-guide-card" tabIndex={0}>
      <div className="s3d-legend__head">
        <h3 className="s3d-legend__title">On this canvas</h3>
        <button type="button" className="s3d-legend__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Hide canvas guide" : "Show canvas guide"}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <>
          <ul className="s3d-guide__list">
            {items.map((i) => (
              <li key={i.key} className="s3d-guide__item" data-guide-item={i.key}>
                <span className="s3d-guide__swatch" data-shape={i.shape} style={i.color === null ? undefined : { ["--swatch" as string]: hex(i.color) }} aria-hidden="true" />
                <span>
                  {i.text}
                  {i.sub && <small>{i.sub}</small>}
                </span>
              </li>
            ))}
          </ul>
          <div className="s3d-guide__actions">
            <label className="s3d-guide__check">
              <input type="checkbox" checked={labels} onChange={onToggleLabels} /> Residue labels
            </label>
            {labelAll && labels && (
              <label className="s3d-guide__check">
                <input type="checkbox" checked={labelAll.on} onChange={onToggleLabelAll} /> {(labelAll.labelled ?? labelAll.count) < labelAll.count ? `Label ${labelAll.labelled} of ${labelAll.count} highlighted` : `Label all ${labelAll.count} highlighted`}
              </label>
            )}
            <button type="button" className="s3d-guide__read" onClick={onOpenGuide}>
              <BookOpen aria-hidden="true" /> How to read a structure
            </button>
          </div>
        </>
      )}
    </section>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Crosshair, Minus, Plus, X } from "lucide-react";

/** 0xRRGGBB → "#rrggbb": a swatch must be the drawn WebGL colour, so it is data, not a theme token. */
function hex(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

export interface CanvasGuideItem {
  key: string;
  /** The drawn colour, when the item has one. */
  color: number | null;
  /** Optional secondary 24-bit RGB colour (e.g. template + variant pair in superposition). */
  secondaryColor?: number | null;
  /** "sticks", "surface", "dashes", "pair": how the item is drawn, so the swatch can be matched on screen. */
  shape: "sticks" | "surface" | "dashes" | "pair";
  text: string;
  /** A second line: provenance or a frame of reference. */
  sub?: string;
  /** Optional compact tabular metric or status badge shown on the right of the title row. */
  badge?: string;
  /** Optional click handler to frame/focus this callout item on the 3D canvas. */
  onClick?: () => void;
  /** Accessible label for the focus action. */
  actionLabel?: string;
  /** Optional dismiss/clear handler (e.g. unpin selected residue, clear companion set, exit close-up). */
  onClear?: () => void;
  /** Accessible label for the clear action. */
  clearLabel?: string;
}

function swatchVars(i: Pick<CanvasGuideItem, "color" | "secondaryColor">): React.CSSProperties | undefined {
  if (i.color === null && i.secondaryColor == null) return undefined;
  return {
    ...(i.color !== null ? { "--swatch": hex(i.color) } : {}),
    ...(i.secondaryColor != null ? { "--swatch-2": hex(i.secondaryColor) } : {}),
  } as React.CSSProperties;
}

const WIDE_ENOUGH_FOR_OPEN_GUIDE = "(min-width: 640px) and (min-height: 640px)";

export function StructureGuideCard({
  items,
  labels,
  onToggleLabels,
  labelAll,
  onToggleLabelAll,
  onOpenGuide,
}: {
  items: readonly CanvasGuideItem[];
  labels: boolean;
  onToggleLabels: () => void;
  /** Present when a highlighted set is larger than the default labelled size. `labelled` is the number the
   *  canvas will actually label, which is capped; it defaults to `count`. */
  labelAll?: { count: number; labelled?: number; on: boolean } | null;
  onToggleLabelAll?: () => void;
  onOpenGuide: () => void;
}) {
  const [open, setOpen] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia(WIDE_ENOUGH_FOR_OPEN_GUIDE).matches,
  );
  const userCollapsedDesktopRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(WIDE_ENOUGH_FOR_OPEN_GUIDE);
    const onChange = () => {
      if (!media.matches) setOpen(false);
      else if (!userCollapsedDesktopRef.current) setOpen(true);
    };
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  if (items.length === 0) return null;
  const labelAllText = labelAll
    ? labelAll.labelled != null && labelAll.labelled < labelAll.count
      ? `Label ${labelAll.labelled} of ${labelAll.count} highlighted`
      : `Label all ${labelAll.count} highlighted`
    : null;
  return (
    <section
      className="s3d-guide"
      aria-label="On this canvas"
      data-testid="structure-guide-card"
      data-collapsed={!open ? "true" : undefined}
    >
      <div className="s3d-guide__head">
        <div className="s3d-guide__head-lead">
          {!open && (
            <span className="s3d-guide__mini-dots" aria-hidden="true">
              {items.map(i => (
                <span
                  key={i.key}
                  className="s3d-guide__mini-dot"
                  data-shape={i.shape}
                  data-colour={i.color === null && i.secondaryColor == null ? "none" : undefined}
                  style={swatchVars(i)}
                />
              ))}
            </span>
          )}
          <h3 className="s3d-guide__title">On this canvas</h3>
          <span className="s3d-guide__count" aria-hidden="true">{items.length}</span>
        </div>
        <button
          type="button"
          className="s3d-guide__toggle"
          onClick={() =>
            setOpen(o => {
              const next = !o;
              if (
                typeof window === "undefined" ||
                typeof window.matchMedia !== "function" ||
                window.matchMedia(WIDE_ENOUGH_FOR_OPEN_GUIDE).matches
              ) {
                userCollapsedDesktopRef.current = !next;
              }
              return next;
            })
          }
          aria-expanded={open}
          aria-controls="s3d-guide-body"
          aria-label={open ? "Hide canvas guide" : "Show canvas guide"}
        >
          {open ? <Minus className="w-3.5 h-3.5" aria-hidden="true" /> : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <div id="s3d-guide-body" role="region" aria-label="Canvas guide items">
          <ul className="s3d-guide__list">
            {items.map(i => {
              const swatchStyle = swatchVars(i);
              const noColour = i.color === null && i.secondaryColor == null ? "none" : undefined;
              const rowContent = (
                <>
                  <div className="s3d-guide__row-head">
                    <span className="s3d-guide__text">{i.text}</span>
                    {i.badge && <span className="s3d-guide__badge">{i.badge}</span>}
                    {i.onClick && <Crosshair className="s3d-guide__row-cue w-3 h-3" aria-hidden="true" />}
                  </div>
                  {i.sub && <small className="s3d-guide__sub">{i.sub}</small>}
                </>
              );
              return (
                <li
                  key={i.key}
                  className="s3d-guide__item"
                  data-guide-item={i.key}
                  data-clickable={i.onClick ? "true" : undefined}
                >
                  <span
                    className="s3d-guide__swatch"
                    data-shape={i.shape}
                    data-colour={noColour}
                    style={swatchStyle}
                    aria-hidden="true"
                  />
                  {i.onClick ? (
                    <button
                      type="button"
                      className="s3d-guide__body s3d-guide__row-btn"
                      onClick={i.onClick}
                      title={i.actionLabel ?? `Frame ${i.text}`}
                      aria-label={i.actionLabel ?? `Frame ${i.text}`}
                    >
                      {rowContent}
                    </button>
                  ) : (
                    <div className="s3d-guide__body">{rowContent}</div>
                  )}
                  {i.onClear && (
                    <div className="s3d-guide__item-actions">
                      <button
                        type="button"
                        className="s3d-guide__icon-btn s3d-guide__icon-btn--clear"
                        onClick={i.onClear}
                        title={i.clearLabel ?? `Dismiss ${i.text}`}
                        aria-label={i.clearLabel ?? `Dismiss ${i.text}`}
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="s3d-guide__actions">
            <div className="s3d-guide__toggles">
              <label className="s3d-guide__check">
                <input type="checkbox" checked={labels} onChange={onToggleLabels} />
                <span>Residue labels</span>
              </label>
              {labels && labelAll && labelAllText && (
                <label className="s3d-guide__check">
                  <input
                    type="checkbox"
                    checked={labelAll.on}
                    disabled={!onToggleLabelAll}
                    onChange={() => onToggleLabelAll?.()}
                  />
                  <span>{labelAllText}</span>
                </label>
              )}
            </div>
            <button type="button" className="s3d-guide__read" onClick={onOpenGuide}>
              <BookOpen className="w-3 h-3" aria-hidden="true" />
              <span>How to read a structure</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}


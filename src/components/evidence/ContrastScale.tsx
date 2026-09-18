import React from "react";
import { ArrowDown, ArrowUp, Equal, Info, PanelRightOpen } from "lucide-react";
import type { BiochemicalContrast, BiochemicalContrastRow, ShiftMagnitude } from "../../shared/residueShiftEvidence";
import { INSPECTOR_SECTIONS, requestInspectorFocus } from "../../lib/inspectorFocus";

/**
 * Polished renderer for the four amino-acid property contrasts.
 *
 * Why this replaced the previous two-segment bar
 * ----------------------------------------------
 * The old track drew a fixed clay segment from 0 to `min(wt, mut)` and a second
 * segment from there to `max(wt, mut)`, coloured green for a decrease and red for
 * an increase. Three things made it hard to read:
 *
 *   1. The clay lead-in had no meaning — it was not the wild-type position, so
 *      the eye could not tell which end of the bar was which residue.
 *   2. Direction was encoded as red/green, which readers correctly interpret as
 *      bad/good. A property axis is neither, so the colour asserted a
 *      pathogenicity claim the data does not support.
 *   3. When the two residues had the same value the bar still rendered full
 *      width, so "no change" looked like the largest possible change.
 *
 * The track below instead keeps the whole 0–100 axis visible, marks both residues
 * with labelled ticks, joins them with a neutral span whose width *is* the delta,
 * and states direction and magnitude as text. Colour is reserved for the two
 * residues, never for the change itself.
 */

const MAGNITUDE_LABEL: Record<ShiftMagnitude, string> = {
  unchanged: "no change",
  slight: "slight",
  moderate: "moderate",
  marked: "marked"
};

/** Fill strength of the magnitude pip: ordinals, not alarm levels. */
const MAGNITUDE_PIP_CLASS: Record<ShiftMagnitude, string> = {
  unchanged: "bg-cs-text-muted/30",
  slight: "bg-cs-accent-clay/30",
  moderate: "bg-cs-accent-clay/60",
  marked: "bg-cs-accent-clay"
};

/** Marker width in px, mirrored in markerLeft so the two stay in step. */
const MARKER_WIDTH_PX = 3;

/**
 * Marker identity: position *and* shape, not hue alone.
 *
 * Colour was the only thing mapping a tick on the track back to one of the two
 * residues, and the two colours used were the semantic `success`/`danger` tokens —
 * the same "mutant equals bad" claim the header above rejects, relocated from the
 * delta to the residue. They also did not match the wild-type/mutant cards, which
 * use the emerald/rose palette rather than those tokens.
 *
 * So the wild type occupies the **upper half** of the track and the variant the
 * **lower half**, in the same emerald/rose hues as the cards. A reader who cannot
 * separate the two hues by luminance — or who prints the page in greyscale — can
 * still tell which tick is which, and can see at a glance when the two residues
 * coincide.
 */
const WILD_TYPE_MARKER_CLASS = "top-0 h-1/2 rounded-full bg-emerald-500";
const MUTANT_MARKER_CLASS = "bottom-0 h-1/2 rounded-[1px] bg-rose-500";
const SHARED_POSITION_MARKER_CLASS = "top-0 h-1/2 rounded-full bg-cs-text-muted";
const SHARED_POSITION_LOWER_CLASS = "bottom-0 h-1/2 rounded-[1px] bg-cs-text-muted";

/**
 * Left offset for a marker centred on `position` (0–100).
 *
 * The track clips its overflow, so the naive `left: X%; translateX(-50%)` loses
 * half the marker at either extreme — and a value of exactly 0 (the wild-type
 * charge of Glu, for instance) is a common case, not a corner case. Clamping
 * keeps the whole marker inside the track at both ends.
 */
function markerLeft(position: number): string {
  return `clamp(0px, calc(${position}% - ${MARKER_WIDTH_PX / 2}px), calc(100% - ${MARKER_WIDTH_PX}px))`;
}

/**
 * A residue's position on the axis.
 *
 * Only `left` is dynamic; width, height, position within the track and fill are
 * static, so they live in classes rather than an inline style object.
 */
function Marker({ position, className }: { position: number; className: string }) {
  return (
    <span
      className={`absolute w-[3px] shadow-[0_0_0_1.5px_var(--cs-bg-subtle)] ${className}`}
      style={{ left: markerLeft(position) }}
      aria-hidden="true"
    />
  );
}

/** Legend key: the same half-height shape the track uses, in a small swatch. */
function MarkerSwatch({ className }: { className: string }) {
  return (
    <span className="relative w-2 h-3.5 rounded-sm overflow-hidden bg-cs-bg-subtle" aria-hidden="true">
      <span className={`absolute left-0 right-0 ${className}`} />
    </span>
  );
}

function DeltaChip({ row }: { row: BiochemicalContrastRow }) {
  if (row.direction === "unchanged") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-mono whitespace-nowrap border-cs-border bg-cs-surface-2 text-cs-text-muted"
        title={`Wild type and variant sit at the same point on this axis (${row.wildTypeValue} of 100).`}
      >
        <Equal className="w-2.5 h-2.5" />
        unchanged
      </span>
    );
  }

  const DirectionIcon = row.direction === "increase" ? ArrowUp : ArrowDown;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono whitespace-nowrap bg-cs-accent-clay/10 border-cs-accent-clay/25 text-cs-accent-clay"
      title={`${row.magnitudeLabel} ${row.direction} on this scale (${row.wildTypeValue} \u2192 ${row.mutantValue}).`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${MAGNITUDE_PIP_CLASS[row.magnitude]}`} aria-hidden="true" />
      <DirectionIcon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      <span className={row.magnitude === "marked" ? "font-bold" : "font-semibold"}>{row.deltaLabel}</span>
      <span className="opacity-80">{MAGNITUDE_LABEL[row.magnitude]} {row.direction}</span>
    </span>
  );
}

/**
 * One property row: axis label, both values, a 0–100 track with both markers, and
 * the anchor words that say what the ends of the axis mean.
 */
function ContrastScaleRow({ row }: { row: BiochemicalContrastRow }) {
  const isUnchanged = row.direction === "unchanged";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-[12px] font-sans truncate text-cs-text-secondary"
          title={`${row.rationale} Source: ${row.source}.`}
        >
          {row.label}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11.5px] font-mono font-bold tabular-nums text-cs-text-primary">
            {row.wildTypeValue}
            <span className="mx-1 opacity-50">&rarr;</span>
            {row.mutantValue}
          </span>
          <DeltaChip row={row} />
        </div>
      </div>

      {/*
        ── 0–100 track ──

        Purely graphical, and hidden from assistive technology. It previously
        carried `role="img"` with a sentence-length `aria-label` that restated the
        axis label, both values and the delta chip already rendered as plain text
        immediately above and below it, so each of the four rows was announced
        roughly twice. The text is the accessible content; this only draws it.
      */}
      <div
        className="relative h-3 rounded-full border overflow-hidden bg-cs-bg-subtle border-cs-border-subtle"
        aria-hidden="true"
      >
        {/* Quarter gridlines give the axis a readable scale without a chart library.
            Only the offset and the emphasis are dynamic, so they stay inline. */}
        {[25, 50, 75].map(percent => (
          <span
            key={percent}
            className="absolute top-0 bottom-0 w-px bg-cs-border"
            style={{
              left: `${percent}%`,
              opacity: row.key === "charge" && percent === 50 ? 0.9 : 0.5
            }}
            aria-hidden="true"
          />
        ))}

        {/* The span between the residues. Its width is the delta, nothing else. */}
        {!isUnchanged && row.spanWidth > 0 && (
          <span
            className="absolute top-0 bottom-0 bg-cs-accent-clay/35"
            style={{ left: `${row.spanStart}%`, width: `${row.spanWidth}%` }}
            aria-hidden="true"
          />
        )}

        {isUnchanged ? (
          <>
            <Marker position={row.wildTypePosition} className={SHARED_POSITION_MARKER_CLASS} />
            <Marker position={row.wildTypePosition} className={SHARED_POSITION_LOWER_CLASS} />
          </>
        ) : (
          <>
            <Marker position={row.wildTypePosition} className={WILD_TYPE_MARKER_CLASS} />
            <Marker position={row.mutantPosition} className={MUTANT_MARKER_CLASS} />
          </>
        )}
      </div>

      {/* ── Axis anchors: what 0 and 100 mean on this descriptor ── */}
      <div className="flex items-center justify-between text-[9.5px] font-mono uppercase tracking-wide text-cs-text-muted">
        <span>{row.lowAnchor}</span>
        {row.midpointLabel && <span className="opacity-80">{row.midpointLabel}</span>}
        <span>{row.highAnchor}</span>
      </div>
    </div>
  );
}

export interface BiochemicalContrastScalesProps {
  contrast: BiochemicalContrast | null;
  isLoading?: boolean;
}

export function BiochemicalContrastScales({ contrast, isLoading = false }: BiochemicalContrastScalesProps) {
  if (!contrast) {
    return (
      <div className="p-4 rounded-lg border bg-cs-surface border-cs-border">
        <span className="block text-[10px] uppercase font-bold tracking-wider text-cs-text-secondary">
          Biochemical Property Contrast
        </span>
        <p className="text-[12px] mt-2 font-sans leading-relaxed text-cs-text-muted">
          {isLoading
            ? "Waiting for residue property scales from the biophysics pipeline\u2026"
            : "Property scales are unavailable for this substitution \u2014 the wild-type or variant residue could not be resolved."}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg border space-y-4 bg-cs-surface border-cs-border">
      {/* ── Header + marker legend ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-[10px] uppercase font-bold tracking-wider text-cs-text-secondary">
            Biochemical Property Contrast
          </span>
          <p className="text-[10.5px] mt-1 font-sans leading-snug text-cs-text-muted">
            Every track spans the full 0&ndash;100 range of its descriptor. The markers are the two side chains; the bar between
            them is the size of the change.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[10px] font-mono flex-wrap justify-end text-cs-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <MarkerSwatch className={WILD_TYPE_MARKER_CLASS} />
            {contrast.wildTypeLabel} <span className="text-cs-text-muted">upper</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MarkerSwatch className={MUTANT_MARKER_CLASS} />
            {contrast.mutantLabel} <span className="text-cs-text-muted">lower</span>
          </span>
          {/* Only shown when it can occur, so the legend never explains an absent case. */}
          {contrast.rows.some(row => row.direction === "unchanged") && (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative w-2 h-3.5 rounded-sm overflow-hidden bg-cs-bg-subtle" aria-hidden="true">
                <span className={`absolute left-0 right-0 ${SHARED_POSITION_MARKER_CLASS}`} />
                <span className={`absolute left-0 right-0 ${SHARED_POSITION_LOWER_CLASS}`} />
              </span>
              same position
            </span>
          )}
        </div>
      </div>

      {/* ── One row per property axis ── */}
      <div className="space-y-4 pt-1">
        {contrast.rows.map(row => (
          <ContrastScaleRow key={row.key} row={row} />
        ))}
      </div>

      {/* ── Deterministic summary. Never asserts pathogenicity. ── */}
      <div className="pt-3 border-t flex items-start gap-2 text-[11.5px] font-sans leading-relaxed border-cs-border-subtle text-cs-text-secondary">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-cs-accent-clay" aria-hidden="true" />
        <div className="space-y-1.5 min-w-0">
          <p>{contrast.summary}</p>
          <p className="text-[10.5px] text-cs-text-muted">
            Scale positions are fixed descriptors of the residue pair, not predictions.
          </p>
          {/* The interpretation lives in the inspector; this is the way to it. A
              label that only says "look over there" leaves the reader to hunt. */}
          <button
            type="button"
            onClick={() => requestInspectorFocus(INSPECTOR_SECTIONS.residueShiftNarrative)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-cs-accent-clay/30 bg-cs-accent-clay/10 text-cs-accent-clay text-[10.5px] font-mono font-semibold hover:bg-cs-accent-clay/20 transition-colors cursor-pointer"
          >
            <PanelRightOpen className="w-3 h-3" aria-hidden="true" />
            Open the worked interpretation
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(BiochemicalContrastScales);

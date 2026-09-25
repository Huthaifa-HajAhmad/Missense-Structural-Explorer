import React from "react";
import { ArrowDown, ArrowUp, Equal, Info, PanelRightOpen } from "lucide-react";
import {
  rankContrastRowsByMagnitude,
  type BiochemicalContrast,
  type BiochemicalContrastRow,
  type ShiftMagnitude
} from "../../shared/residueShiftEvidence";
import { INSPECTOR_SECTIONS, requestInspectorFocus } from "../../lib/inspectorFocus";

/**
 * Dumbbell renderer for the four amino-acid property contrasts.
 *
 * Design history — three iterations, each fixing a real readability failure:
 *
 *  1. The original two-segment bar drew a meaningless lead-in from 0 to the
 *     smaller value, coloured the delta green/red (asserting a verdict the data
 *     does not support), and rendered "no change" as a full-width fill.
 *  2. The marker-and-span version kept the full 0–100 axis, ranked the rows by
 *     magnitude and added a direction chevron — but marked the two residues with
 *     3px half-height ticks. At that size the upper/lower split that carried
 *     identity was too small to see at all, which is the complaint this
 *     iteration answers.
 *  3. The current design marks the residues the way dumbbell charts do: a HOLLOW
 *     RING at the wild-type position and a SOLID DOT at the variant position,
 *     both 10px. Identity is carried by fill — present or absent — which
 *     survives greyscale, colour-vision deficiency and small sizes; the
 *     emerald/rose hues only reinforce it. The span keeps carrying magnitude
 *     (its width is the delta) and the chevron keeps carrying direction, now
 *     seated beside the larger variant dot rather than at the span's edge.
 *
 * Reading the four changes against each other
 * -------------------------------------------
 * Every track is drawn on the same normalised 0–100 range, so the span widths *are*
 * comparable — but only once the rows are in an order worth comparing. They are therefore
 * ranked by magnitude, largest first (`rankContrastRowsByMagnitude`, the same ranking the
 * prose summary names its headline axis from). No value is stated twice: the graphic stays
 * decoration and the numbers stay text.
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

/** Dot diameter in px, mirrored in markerLeft so the two stay in step. */
const DOT_SIZE_PX = 10;

/**
 * Minimum move (as a % of the track) for which the direction chevron is drawn.
 * Below this the two dots nearly touch and a chevron seated between them would be
 * mostly hidden under a dot; the chip and the printed value pair still state the
 * direction, so nothing is lost.
 */
const MIN_CHEVRON_SPAN_PERCENT = 5;

/**
 * Marker identity: fill first, hue as reinforcement only.
 *
 * The previous version distinguished the residues by hue alone, then — in an
 * accessibility fix — by half-height position on a 3px tick. Both failed the same
 * test: at 3px the split was invisible, and hue is not separable for every reader.
 * A hollow ring versus a solid dot needs no learned convention and no colour
 * discrimination: "was here" is an outline, "is here" is filled. The hues match
 * the wild-type/mutant cards above and are never the semantic success/danger
 * tokens, which would assert a verdict about the residue.
 */
const WILD_TYPE_MARKER_CLASS = "border-2 border-emerald-500 bg-cs-bg-subtle";
const MUTANT_MARKER_CLASS = "bg-rose-500";
const SHARED_POSITION_MARKER_CLASS = "bg-cs-text-muted";

type ScaleMarkerKind = "wild-type" | "variant" | "shared";

const MARKER_CLASS: Record<ScaleMarkerKind, string> = {
  "wild-type": WILD_TYPE_MARKER_CLASS,
  variant: MUTANT_MARKER_CLASS,
  shared: SHARED_POSITION_MARKER_CLASS
};

/**
 * Left offset for a dot centred on `position` (0–100).
 *
 * The track clips its overflow, so the naive `left: X%; translateX(-50%)` loses
 * half the dot at either extreme — and a value of exactly 0 or 100 is reachable
 * with the shipped scale table (Lys→Glu charge starts at 0, Ala→Ile hydrophobicity
 * ends at 100), not a corner case. Clamping keeps the whole dot inside the track.
 */
function markerLeft(position: number): string {
  return `clamp(0px, calc(${position}% - ${DOT_SIZE_PX / 2}px), calc(100% - ${DOT_SIZE_PX}px))`;
}

/**
 * A residue's position on the axis.
 *
 * Only `left` is dynamic; the size, fill and separation ring are static, so they
 * live in classes and constants rather than an inline style object. The
 * `data-scale-marker` kind makes the identity testable without matching on
 * presentation classes.
 */
function Marker({ position, kind }: { position: number; kind: ScaleMarkerKind }) {
  return (
    <span
      data-scale-marker={kind}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full shadow-[0_0_0_1.5px_var(--cs-bg-subtle)] ${MARKER_CLASS[kind]}`}
      style={{ left: markerLeft(position), width: DOT_SIZE_PX, height: DOT_SIZE_PX }}
      aria-hidden="true"
    />
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
  const hasChevron = !isUnchanged && row.spanWidth >= MIN_CHEVRON_SPAN_PERCENT;

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

        h-5 rather than the earlier h-3/h-4: the 10px dots carry a 1.5px
        separation ring, and the markers must not be the faintest elements in the
        card when they are what tells the two residues apart.
      */}
      <div
        className="relative h-5 rounded-full border overflow-hidden bg-cs-bg-subtle border-cs-border-subtle"
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
            className="absolute top-0 bottom-0 bg-cs-accent-clay/50"
            style={{ left: `${row.spanStart}%`, width: `${row.spanWidth}%` }}
            aria-hidden="true"
          />
        )}

        {/*
          Direction chevron, seated beside the variant dot and pointing at it.

          A left border makes a triangle that points right, so an increase (variant
          to the right of wild type) seats the chevron 11px left of the variant
          position and a decrease seats it 6px right of it — both clear the 10px dot
          with a gap, and both are clamped so the chevron can never leave the track.
          The clamp matters: a change ending at 0% or 100% is reachable with the
          shipped scale table (Ala→Ile hydrophobicity ends at 100%, Lys→Glu charge
          starts at 0%), and an unclamped chevron there is clipped to a sliver.
          Suppressed entirely when the move is too small to seat one between the dots.
        */}
        {hasChevron && (
          <span
            data-move-arrow={row.direction}
            className="absolute top-1/2 -translate-y-1/2 w-0 h-0"
            style={{
              left:
                row.direction === "increase"
                  ? `clamp(0px, calc(${row.mutantPosition}% - 11px), calc(100% - 5px))`
                  : `clamp(0px, calc(${row.mutantPosition}% + 6px), calc(100% - 5px))`,
              borderTop: "4px solid transparent",
              borderBottom: "4px solid transparent",
              ...(row.direction === "increase"
                ? { borderLeft: "5px solid var(--cs-accent-clay)" }
                : { borderRight: "5px solid var(--cs-accent-clay)" })
            }}
            aria-hidden="true"
          />
        )}

        {isUnchanged ? (
          <Marker position={row.wildTypePosition} kind="shared" />
        ) : (
          <>
            <Marker position={row.wildTypePosition} kind="wild-type" />
            <Marker position={row.mutantPosition} kind="variant" />
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
            Ordered by the size of the change, largest first, so the largest move is the first row
            and the flat axes are last. Every track spans its descriptor&rsquo;s own 0&ndash;100 range, so
            the span widths are comparable row to row: the hollow ring is the wild-type side chain,
            the solid dot is the variant, and the chevron points the way the value moved.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[10px] font-mono flex-wrap justify-end text-cs-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${WILD_TYPE_MARKER_CLASS}`} aria-hidden="true" />
            <span>{contrast.wildTypeLabel}</span>
            <span className="text-cs-text-muted">wild type</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${MUTANT_MARKER_CLASS}`} aria-hidden="true" />
            <span>{contrast.mutantLabel}</span>
            <span className="text-cs-text-muted">variant</span>
          </span>
          {/* Only shown when it can occur, so the legend never explains an absent case. */}
          {contrast.rows.some(row => row.direction === "unchanged") && (
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${SHARED_POSITION_MARKER_CLASS}`} aria-hidden="true" />
              <span>same position</span>
            </span>
          )}
        </div>
      </div>

      {/* ── One row per property axis, ranked by the size of the change ── */}
      <div className="space-y-4 pt-1">
        {rankContrastRowsByMagnitude(contrast.rows).map(row => (
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

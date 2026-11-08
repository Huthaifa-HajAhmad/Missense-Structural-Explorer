import type React from "react";
import {
  SECONDARY_COLOURS,
  SECONDARY_LABELS,
  describeSecondarySource,
  isHelix,
  summariseSecondary,
  type ModelSecondary,
} from "../../shared/structureSecondary";
import { REGION_KIND_LABEL, type RegionKind } from "../../shared/residueRegions";
import { hexColour } from "../../shared/colorHex";


const pct = (f: number) => `${Math.round(f * 100)}%`;

interface Props {
  secondary: ModelSecondary | null;
  /** Why the top row is not there, when `secondary` is null. Never "appears once drawn" for a read that failed. */
  secondaryNote?: string | null;
  regions: Array<{ kind: RegionKind; label: string; start: number; end: number }>;
  length: number;
  structureName: string | null;
  variantPosition: number | null;
  selectedPosition: number | null;
  onSelectResidue?: (position: number) => void;
}

/** The SVG is pinned to this height in CSS; the viewBox stretches horizontally only. */
const ROW = { ss: 4, region: 26, height: 44 };

/**
 * The fold along the sequence: the drawn model's secondary structure on the top row, UniProt's
 * domains, linkers and disordered regions below, and two marks for the variant and the selection.
 * Helices and strands are blocks; turns, bends and coil are a thin line, so the elements read first.
 * A click or an arrow key selects the residue under the pointer, the same selection a click on the
 * structure makes. The top row is only plotted when the drawn model is UniProt-numbered, because the
 * bottom row always is: two numbering systems must never share one axis.
 */
export function StructureFoldTrack({ secondary, secondaryNote, regions, length, structureName, variantPosition, selectedPosition, onSelectResidue }: Props) {
  if (length < 1) return null;
  const summary = secondary ? summariseSecondary(secondary) : null;
  const select = (position: number) => onSelectResidue?.(Math.min(length, Math.max(1, Math.round(position))));
  const pick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!onSelectResidue) return;
    const box = event.currentTarget.getBoundingClientRect();
    select(((event.clientX - box.left) / box.width) * length + 0.5);
  };
  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!onSelectResidue) return;
    const current = selectedPosition ?? variantPosition ?? 1;
    const step = event.shiftKey ? 10 : 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = current + step;
    else if (event.key === "ArrowLeft") next = current - step;
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = length;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };
  const mark = (position: number | null, tone: string) =>
    position !== null && position >= 1 && position <= length ? (
      <line x1={position - 0.5} x2={position - 0.5} y1={0} y2={ROW.height} className="s3d-track__mark" data-tone={tone} vectorEffect="non-scaling-stroke" />
    ) : null;
  const positions = [
    variantPosition !== null ? `site ${variantPosition}` : null,
    selectedPosition !== null && selectedPosition !== variantPosition ? `selected ${selectedPosition}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="s3d-track" data-testid="structure-fold-track">
      <svg
        viewBox={`0 0 ${length} ${ROW.height}`}
        preserveAspectRatio="none"
        className="s3d-track__svg"
        role={onSelectResidue ? "slider" : "img"}
        tabIndex={onSelectResidue ? 0 : undefined}
        aria-valuemin={onSelectResidue ? 1 : undefined}
        aria-valuemax={onSelectResidue ? length : undefined}
        aria-valuenow={onSelectResidue && selectedPosition !== null ? selectedPosition : undefined}
        aria-valuetext={onSelectResidue ? (selectedPosition !== null ? `Residue ${selectedPosition} of ${length}` : "No residue selected") : undefined}
        aria-label={`Secondary structure and UniProt regions along residues 1 to ${length}${onSelectResidue ? ". Arrow keys move the selection; Home and End jump to the ends." : ""}`}
        onClick={pick}
        onKeyDown={onKeyDown}
      >
        <line x1={0} x2={length} y1={ROW.ss + 7} y2={ROW.ss + 7} className="s3d-track__axis" vectorEffect="non-scaling-stroke" />
        {secondary?.segments.filter(s => isHelix(s.cls) || s.cls === "strand" || s.cls === "beta-bridge").map(s => (
          <rect key={`${s.cls}-${s.start}`} x={s.start - 1} width={s.end - s.start + 1} y={ROW.ss} height={14} fill={hexColour(SECONDARY_COLOURS[s.cls])}>
            <title>{`${SECONDARY_LABELS[s.cls]} ${s.start}–${s.end}`}</title>
          </rect>
        ))}
        {regions.map(r => (
          <rect key={`${r.kind}-${r.start}-${r.label}`} x={r.start - 1} width={r.end - r.start + 1} y={ROW.region} height={12} className="s3d-track__region" data-kind={r.kind}>
            <title>{`${REGION_KIND_LABEL[r.kind]}: ${r.label} ${r.start}–${r.end}`}</title>
          </rect>
        ))}
        {mark(variantPosition, "site")}
        {mark(selectedPosition !== variantPosition ? selectedPosition : null, "selected")}
      </svg>
      <div className="s3d-track__axis-labels s3d-mono" aria-hidden="true"><span>1</span><span>{length}</span></div>
      {positions && <p className="s3d-track__positions s3d-mono">{positions}</p>}
      <ul className="s3d-track__key">
        <li><span className="s3d-track__chip" style={{ background: hexColour(SECONDARY_COLOURS["alpha-helix"]) }} />Helix segments{summary ? ` · ${summary.helices} (${pct(summary.helixFraction)})` : ""}</li>
        <li><span className="s3d-track__chip" style={{ background: hexColour(SECONDARY_COLOURS.strand) }} />Strands{summary ? ` · ${summary.strands} (${pct(summary.strandFraction)})` : ""}</li>
        <li><span className="s3d-track__chip" data-kind="coil" />Turn, bend, coil{summary ? ` (${pct(summary.coilFraction)})` : ""}</li>
        <li><span className="s3d-track__chip" data-kind="domain" />Domain</li>
        <li><span className="s3d-track__chip" data-kind="zinc-finger" />Zinc finger / DNA binding</li>
        <li><span className="s3d-track__chip" data-kind="linker" />Linker / disordered</li>
        {variantPosition !== null && <li><span className="s3d-track__tick" data-tone="site" aria-hidden="true" />Variant site</li>}
        {selectedPosition !== null && selectedPosition !== variantPosition && <li><span className="s3d-track__tick" data-tone="selected" aria-hidden="true" />Selected</li>}
      </ul>
      <p className="s3d-kv__note">
        {secondary
          ? `Top row: ${describeSecondarySource(secondary.source, structureName)} Shares are of the ${secondary.residueCount} residues drawn. Bottom row: UniProt Domain features and its Linker and Disordered regions.`
          : secondaryNote ?? "Top row appears once the model is drawn. Bottom row: UniProt Domain features and its Linker and Disordered regions."}
      </p>
    </div>
  );
}

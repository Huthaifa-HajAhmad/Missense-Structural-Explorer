import { FEATURE_KINDS, type FeatureGeometry } from "../../shared/featurePalette";

/**
 * The inspector's "Feature Types & Palette" legend.
 *
 * Every swatch is read from `src/shared/featurePalette.ts`, which is also what the track paints
 * with — the legend used to be a second, hand-written list and four of its five swatches advertised
 * colours no shape in the track had (indigo domains, amber binding sites, emerald PTMs, cyan
 * disulfides), while transmembrane regions and the remaining curated sites had no entry at all.
 *
 * It is its own component so it can be rendered and *measured* against the track:
 * `tools/function-track-geometry` mounts it and asserts every swatch colour equals the colour the
 * track painted for that category, and that the two shape rows cover the two geometries
 * `featureGeometryFor` can return for a site. A legend that is only checked by reading it is how the
 * wrong swatches survived in the first place.
 */
const GEOMETRY_ROWS: Array<{ key: Exclude<FeatureGeometry, "band">; label: string; hint: string }> = [
  {
    key: "point",
    label: "Point site",
    hint: "annotated at a single residue — drawn as a lollipop pin",
  },
  {
    key: "span",
    label: "Span",
    hint: "annotated over a run of residues — drawn as a bar on the span lane, in its category colour",
  },
];

export function FeaturePaletteLegend() {
  return (
    <div
      data-legend-root
      className="p-3 rounded-lg border border-cs-border bg-cs-surface-2 space-y-2"
    >
      <span className="text-[10px] font-mono font-bold uppercase text-cs-text-muted block">
        Feature Types &amp; Palette
      </span>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {FEATURE_KINDS.map((kind) => (
          <div
            key={kind.key}
            className="flex items-center gap-1.5"
            title={`${kind.singular} — ${kind.noun}`}
          >
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              data-legend-kind={kind.key}
              style={{ background: kind.color }}
            />
            <span className="text-cs-text-secondary truncate">{kind.singular}</span>
          </div>
        ))}
      </div>
      {/*
        Shapes, not colours: a span bar is painted in the colour of the category it belongs to, so a
        coloured swatch here would claim a fifth palette entry that nothing is painted with.
      */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-2 border-t border-cs-border">
        {GEOMETRY_ROWS.map((row) => (
          <div key={row.key} className="flex items-center gap-1.5" title={row.hint}>
            <span
              className="w-2.5 h-2.5 shrink-0 flex items-center justify-center"
              data-legend-shape={row.key}
            >
              {row.key === "point" ? (
                <span className="w-2 h-2 rounded-full bg-cs-text-muted" />
              ) : (
                <span className="w-2.5 h-[3px] rounded-full bg-cs-text-muted" />
              )}
            </span>
            <span className="text-cs-text-secondary truncate">{row.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-cs-text-muted leading-snug">
        Pins and span bars are painted in their category&rsquo;s colour; the shape says whether the
        annotation covers one residue or a run of them.
      </p>
    </div>
  );
}

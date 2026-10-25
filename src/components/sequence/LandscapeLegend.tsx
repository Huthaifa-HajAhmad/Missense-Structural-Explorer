import React from "react";
import { BAND_ORDER, CONSERVATION_BREAKS, calibrationSourceShort, legendSteps, type BandKey, type LandscapeTool } from "../../shared/landscapeEvidence";
import { PP3_BP4_CALIBRATION } from "../../shared/thresholds/calibration";

const TOOLS = [
  { key: "revel" as const, name: "REVEL" },
  { key: "alphaMissense" as const, name: "AlphaMissense" }
];

const SHORT: Record<BandKey, string> = {
  "bp4-strong": "BP4 Strong",
  "bp4-moderate": "BP4 Mod",
  "bp4-supporting": "BP4 Sup",
  indeterminate: "Indet.",
  "pp3-supporting": "PP3 Sup",
  "pp3-moderate": "PP3 Mod",
  "pp3-strong": "PP3 Strong"
};

interface Props {
  /** Only show keys for marks present in the whole-protein chart. */
  overview?: boolean;
  /** The scale the grid is coloured by; only its bands are drawn in the always-visible key. */
  colorBy: LandscapeTool;
  /** Whether the nucleotide lane has any cells, so its key is only offered when it is on screen. */
}

/**
 * The key sits under the grid so the grid keeps the width, and it shows only what the screen uses:
 * the bands of the tool the grid is coloured by, and the cell glyphs. The other tool's bands, the
 * nucleotide-lane ramp, the conservation steps and their caveats are one disclosure away. Every number
 * comes from `calibration.ts` or `CONSERVATION_BREAKS`; nothing is typed here.
 */
export function LandscapeLegend({ colorBy, overview = false }: Props) {
  const ranges = TOOLS.map((t) => {
    const byKey = new Map(legendSteps(t.key).map((s) => [s.key, s.range]));
    return { ...t, byKey };
  });
  const active = ranges.find((t) => t.key === colorBy) ?? ranges[0];
  const phylopPp3 = PP3_BP4_CALIBRATION.phylop.pp3.Supporting;
  const phylopBp4 = PP3_BP4_CALIBRATION.phylop.bp4.Supporting;

  return (
    <div className="rounded-xl border border-cs-border-subtle bg-cs-surface px-4 py-3 flex flex-col gap-2.5 text-[11px] text-cs-text-secondary" aria-label="Colour key">
      <div className="flex flex-wrap items-end gap-x-1 gap-y-2">
        <span className="font-semibold text-cs-text-primary mr-3 self-center">
          {active.name} bands <span className="font-normal text-cs-text-muted">· ClinGen, {calibrationSourceShort(active.key)}</span>
        </span>
        {BAND_ORDER.map((k) => (
          <span key={k} className="flex flex-col items-start gap-0.5 font-mono text-[10px] min-w-[74px]">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span className="ls-swatch ls-band" data-band={k} />
              {SHORT[k]}
            </span>
            <span className="text-cs-text-muted pl-[18px] whitespace-nowrap">{active.byKey.get(k) ?? "—"}</span>
          </span>
        ))}
      </div>

      {!overview && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="unscored" />SNV-reachable, no score</span>
        <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="unreachable" />needs ≥ 2 nucleotide changes</span>
        <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="norecord" />no dbNSFP record at this residue</span>
        <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="reference">·</span>reference residue</span>
        <span className="flex items-center gap-1.5"><span className="ls-swatch" style={{ outline: "2px solid var(--cs-accent-clay)", outlineOffset: -1 }} />queried variant</span>
        <span className="text-cs-text-muted">phyloP bar: taller and darker = more conserved</span>
      </div>}

      <details className="group">
        <summary className="cursor-pointer text-[11px] font-semibold text-cs-text-primary select-none w-fit rounded focus-visible:outline-2 focus-visible:outline-cs-accent-clay">
          How to read the colours
        </summary>
        <div className="flex flex-col gap-3 pt-3">
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-x-1 border-spacing-y-0.5 font-mono text-[10px]">
              <thead>
                <tr>
                  <th />
                  {BAND_ORDER.map((k) => (
                    <th key={k} className="font-normal text-left px-1">
                      <span className="flex items-center gap-1 whitespace-nowrap">
                        <span className="ls-swatch ls-band" data-band={k} />
                        {SHORT[k]}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranges.map((t) => (
                  <tr key={t.key}>
                    <th className="text-right pr-2 font-semibold text-cs-text-primary">{t.name}</th>
                    {BAND_ORDER.map((k) => (
                      <td key={k} className="px-1 whitespace-nowrap text-cs-text-secondary">
                        {t.byKey.get(k) ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-snug text-cs-text-muted">
            REVEL bands: {calibrationSourceShort("revel")}. AlphaMissense bands: {calibrationSourceShort("alphaMissense")}. Heatmap cells are
            single substitutions, so their band applies to that substitution. The bands were calibrated for single variants: in the summary
            row and the overview, which show residue summaries (mean or max over scored missense substitutions), the colour is for
            orientation and does not count as PP3/BP4.
          </p>

          {!overview && <div className="flex flex-col gap-1.5 border-t border-cs-border-subtle pt-3">
            <span className="font-semibold text-cs-text-primary">Conservation shade — codon mean, stronger shade = more conserved</span>
            <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px]">
              {(["gerp", "phylop"] as const).map((tool) => {
                const [a, b, c] = CONSERVATION_BREAKS[tool];
                return (
                  <span key={tool} className="flex items-center gap-1.5">
                    <span className="font-semibold text-cs-text-primary mr-1">{tool === "gerp" ? "GERP++" : "phyloP"}</span>
                    <span className="ls-swatch ls-cons" data-level="0" /> &lt;{a}
                    <span className="ls-swatch ls-cons ml-1" data-level="1" /> {a}–{b}
                    <span className="ls-swatch ls-cons ml-1" data-level="2" /> {b}–{c}
                    <span className="ls-swatch ls-cons ml-1" data-level="3" /> ≥{c}
                  </span>
                );
              })}
            </div>
            <p className="text-[11px] leading-snug text-cs-text-muted">
              Conservation is not pathogenicity. The breaks are this app's display steps; the only published evidence bands are ClinGen's
              for phyloP (PP3 ≥ {phylopPp3}, the darkest step; BP4 ≤ {phylopBp4}, Pejaver 2022). GERP++ has no PP3 band.
            </p>
          </div>}
        </div>
      </details>
    </div>
  );
}

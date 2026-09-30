import React from "react";
import { BAND_ORDER, CONSERVATION_BREAKS, calibrationSourceShort, legendSteps, type BandKey } from "../../shared/landscapeEvidence";
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

/**
 * One legend for both colour scales, laid out under the grid so the grid keeps the width. Every
 * number comes from `calibration.ts` or `CONSERVATION_BREAKS`; nothing is typed here.
 */
export function LandscapeLegend() {
  const ranges = TOOLS.map((t) => {
    const byKey = new Map(legendSteps(t.key).map((s) => [s.key, s.range]));
    return { ...t, byKey };
  });
  const phylopPp3 = PP3_BP4_CALIBRATION.phylop.pp3.Supporting;
  const phylopBp4 = PP3_BP4_CALIBRATION.phylop.bp4.Supporting;

  return (
    <div className="rounded-xl border border-cs-border-subtle bg-cs-surface-2 p-4 flex flex-col gap-4 text-[11px] text-cs-text-secondary">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <span className="font-semibold text-cs-text-primary">Predictor colour — ClinGen calibrated bands</span>
          <span className="text-[10px] text-cs-text-muted">
            REVEL: {calibrationSourceShort("revel")} · AlphaMissense: {calibrationSourceShort("alphaMissense")}
          </span>
        </div>
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
          <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="unscored" />SNV-reachable, no score</span>
          <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="unreachable" />needs ≥ 2 nucleotide changes (not in dbNSFP)</span>
          <span className="flex items-center gap-1.5"><span className="ls-swatch ls-sub" data-band="reference">·</span>reference residue</span>
          <span className="flex items-center gap-1.5"><span className="ls-swatch" style={{ outline: "2px solid var(--cs-accent-clay)", outlineOffset: -1 }} />queried variant</span>
        </div>
        <p className="text-[11px] leading-snug text-cs-text-muted">
          Heatmap cells are single substitutions, so their band applies to that substitution. The bands were
          calibrated for single variants: in the summary row and the overview, which show residue summaries (mean or
          max over SNV-reachable missense substitutions), the colour is for orientation and does not count as PP3/BP4.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-cs-border-subtle pt-3">
        <span className="font-semibold text-cs-text-primary">Nucleotide lane — AlphaGenome AVI genome-wide rank</span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px]">
          {["below top 10%", "top 10%", "top 1%", "top 0.1%", "top 0.01%"].map((label, level) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="ls-swatch ls-nt" data-rank={String(level)} />
              {label}
            </span>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-cs-text-muted">
          A rank among all possible SNVs, not a probability and not an ACMG band. AlphaMissense is one of the AVI's
          inputs, so this lane is not independent of the heatmap.
        </p>
      </div>

      <div className="flex flex-col gap-2 border-t border-cs-border-subtle pt-3">
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
          Conservation is not pathogenicity. The breaks are this app's display steps; the only published evidence bands
          are ClinGen's for phyloP (PP3 ≥ {phylopPp3}, the darkest step; BP4 ≤ {phylopBp4}, Pejaver 2022). GERP++ has
          no PP3 band.
        </p>
      </div>
    </div>
  );
}

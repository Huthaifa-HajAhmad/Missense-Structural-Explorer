import React from "react";
import { PARTNER_BANDS, PARTNER_BAND_LABEL, type PartnerGroup, type PartnerGroupView } from "../../../shared/interfacesEvidence";

/**
 * PartnerTiers — the partner list as one bar per evidence tier, strongest first, and the filter for the grid.
 *
 * Why a chart: SOD1 has 3 assembly partners, 15 reported binders, 66 partners from one two-hybrid screen
 * and about 700 STRING associations. As rows that was 120 lines in which the few attested binders sat
 * above a wall of one repeated sentence. As bars the shape is the finding: few well-attested partners,
 * many weak associations. Lengths are linear in count, so a tier of 3 beside one of 500 looks as
 * small as it is; the number is printed on every bar.
 *
 * Two bands, with a heading and a running total each: "Binding evidence" (a curated, structural or
 * screened claim that the two proteins bind) above "Association only" (STRING), because an association
 * score is not evidence of binding. Binding bars carry the stronger ink, association bars the muted
 * ink; each band is its own surface, so a reader instantly sees which is which. Neutral either way: no
 * tier is benign or pathogenic. Each bar is a toggle (aria-pressed) that narrows the grid to its tier;
 * the legend IS the filter.
 */

const BAND_ORDER = ["binding", "association"] as const;

export function PartnerTiers({
  groups,
  active,
  onToggle,
}: {
  groups: PartnerGroupView[];
  active: PartnerGroup | null;
  onToggle: (id: PartnerGroup) => void;
}) {
  const max = Math.max(1, ...groups.map(g => g.total));
  const bands = BAND_ORDER
    .map(band => ({ band, items: groups.filter(g => PARTNER_BANDS[g.id] === band) }))
    .filter(b => b.items.length);

  return (
    <div className="ifc-tiers" data-testid="partner-tiers">
      {bands.map(b => {
        const total = b.items.reduce((n, g) => n + g.total, 0);
        const capped = b.items.some(g => g.capped);
        const label = PARTNER_BAND_LABEL[b.band];
        return (
          <div key={b.band} className="ifc-tiers__band" data-band={b.band} role="group" aria-label={label.title}>
            <p className="ifc-tiers__band-head">
              <span className="ifc-tiers__band-title">{label.title}</span>
              <span className="ifc-tiers__band-count">{total}{capped ? "+" : ""} entries</span>
              <span className="ifc-tiers__band-meta">{label.meta}</span>
            </p>            {b.items.map(g => {
              const count = `${g.total}${g.capped ? "+" : ""}`;
              return (
                <button
                  key={g.id}
                  type="button"
                  className="ifc-tier"
                  aria-pressed={active === g.id}
                  data-dim={(active && active !== g.id) || undefined}
                  onClick={() => onToggle(g.id)}
                  title={`${g.title}: ${count} partner${g.total === 1 ? "" : "s"}. ${active === g.id ? "Show every tier." : "Show this tier only."}`}
                >
                  <span className="ifc-tier__label">{g.title}</span>
                  <span className="ifc-tier__bar" aria-hidden="true">
                    <span className="ifc-tier__fill" style={{ width: `max(2px, ${(g.total / max) * 100}%)` }} />
                  </span>
                  <span className="ifc-tier__count">{count}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

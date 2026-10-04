import React from "react";
import type { PartnerGroup, PartnerGroupView } from "../../../shared/interfacesEvidence";

/**
 * PartnerTiers — the partner list as one bar per evidence tier, strongest first, and the filter for the grid.
 *
 * Why a chart: SOD1 has 3 assembly partners, 15 reported binders, 66 partners from one two-hybrid screen
 * and about 700 STRING associations. As rows that was 120 lines in which the few attested binders sat
 * above a wall of one repeated sentence. As bars the shape is the finding: few well-attested partners,
 * many weak associations. Lengths are linear in count, so a tier of 3 beside one of 500 looks as
 * small as it is; the number is printed on every bar.
 *
 * Two bands: "binding evidence" (curated, solved, screened) above "association only" (STRING), because
 * an association score is not evidence of binding. Neutral ink only: no tier is benign or pathogenic.
 * Each bar is a toggle (aria-pressed) that narrows the grid to its tier; the legend IS the filter.
 */

const BINDING: PartnerGroup[] = ["assembly", "structural", "curated", "screen"];

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
  const bands: Array<{ title: string; items: PartnerGroupView[] }> = [
    { title: "Binding evidence", items: groups.filter(g => BINDING.includes(g.id)) },
    { title: "Association only", items: groups.filter(g => !BINDING.includes(g.id)) },
  ].filter(b => b.items.length);

  return (
    <div className="ifc-tiers" data-testid="partner-tiers">
      {bands.map(b => (
        <div key={b.title} className="ifc-tiers__band" role="group" aria-label={b.title}>
          <span className="ifc-tiers__band-title">{b.title}</span>
          {b.items.map(g => {
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
      ))}
    </div>
  );
}

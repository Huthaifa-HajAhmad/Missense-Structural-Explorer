import { PARTNER_BANDS, PARTNER_BAND_LABEL, type InterfacesEvidence, type PartnerGroup, type PartnerGroupView } from "../../../shared/interfacesEvidence";

/**
 * PartnerTiers — the partner tiers as filter chips with their counts, in two bands, under one sentence
 * that states the shape.
 *
 * It replaced a bar chart. Bars on a linear scale drew ABCG1's 3 assembly and 5 reported-binding rows as
 * dots beside 487 functional associations, so the chart showed only that STRING is large, and its
 * column of empty space sat under the search box (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, U4). The shape
 * is said in words instead ("6 partner proteins with binding evidence; 500+ with association only"), from
 * the same partner count the facts and the rail use, and each chip narrows the grid (aria-pressed).
 */
const BAND_ORDER = ["binding", "association"] as const;

export function partnerShape(s: InterfacesEvidence["partnerSummary"]): string {
  const binding = `${s.binding} partner protein${s.binding === 1 ? "" : "s"} with binding evidence`;
  const other = s.otherSpecies ? ` (and ${s.otherSpecies} from other species)` : "";
  const association = s.association ? `; ${s.association}${s.capped ? "+" : ""} with STRING association only` : "";
  return `${binding}${other}${association}.`;
}

/** The chips count rows, since each narrows the grid. Where rows and partner proteins differ, say how, in view. */
export function bandNote(rows: number, s: InterfacesEvidence["partnerSummary"]): string | null {
  const rest = rows - s.binding - s.otherSpecies;
  if (rest <= 0) return null;
  const species = s.otherSpecies ? ` and ${s.otherSpecies} from other species` : "";
  return `${rows} rows: ${s.binding} partner protein${s.binding === 1 ? "" : "s"}${species}, and ${rest} that ${rest === 1 ? "is" : "are"} this protein's other chain or a family named without genes.`;
}

export function PartnerTiers({ groups, summary, active, onToggle }: { groups: PartnerGroupView[]; summary: InterfacesEvidence["partnerSummary"]; active: PartnerGroup | null; onToggle: (id: PartnerGroup) => void }) {
  const bands = BAND_ORDER.map(band => ({ band, items: groups.filter(g => PARTNER_BANDS[g.id] === band) })).filter(b => b.items.length);
  return (
    <div className="ifc-tiers" data-testid="partner-tiers">
      {bands.map(b => {
        const note = b.band === "binding" ? bandNote(b.items.reduce((n, g) => n + g.total, 0), summary) : null;
        return (
        <div key={b.band} className="ifc-tiers__band" data-band={b.band} role="group" aria-label={PARTNER_BAND_LABEL[b.band].title}>
          <span className="ifc-tiers__band-title" title={PARTNER_BAND_LABEL[b.band].meta}>{PARTNER_BAND_LABEL[b.band].title}</span>
          {b.items.map(g => {
            const count = `${g.total}${g.capped ? "+" : ""}`;
            return (
              <button
                key={g.id}
                type="button"
                className="ifc-tier"
                aria-pressed={active === g.id}
                onClick={() => onToggle(g.id)}
                title={`${g.title}: ${count} row${g.total === 1 ? "" : "s"}. ${active === g.id ? "Show every tier." : "Show this tier only."}`}
              >
                {g.title}
                <span className="ifc-tier__count">{count}</span>
              </button>
            );
          })}
          {note && <span className="ifc-tiers__note">{note}</span>}
        </div>
        );
      })}
    </div>
  );
}

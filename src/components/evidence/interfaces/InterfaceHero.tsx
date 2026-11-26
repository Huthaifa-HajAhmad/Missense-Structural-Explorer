import { AlertTriangle, RefreshCw, Waypoints } from "lucide-react";
import type { InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { interfaceMapView } from "../../../shared/mechanismWorkspace";
import { Prose } from "../../ui/Prose";
import { InterfaceTrack } from "./InterfaceTrack";
import { ActionButton } from "./ui";

/**
 * The finding: one figure, one sentence, its context, and the map around the residue.
 *
 * The card used to set the text beside a tall assembly schematic and centre it vertically, which left
 * empty bands above and below the text, and the verdict chip floated at the far end of the eyebrow row,
 * 500px from the number it qualified (doc/INTERFACES_PPI_AUDIT_2026-11-26.md, U1, U2, U12). The text now
 * runs the card's width; the chip sits beside a count and is dropped when the figure is already words;
 * the schematic lives with the assembly records; and the card's figure is the evidence around the residue:
 * which stretches the structures model, and how often each neighbour is at the interface.
 */
interface HeroProps {
  ev: InterfacesEvidence;
  workspace: boolean;
  failures: { assembly: string | null; lookups: string | null };
  onRetryAssembly: () => void;
  onRetryLookups: () => void;
  lit: string | null;
}

export function InterfaceHero({ ev, workspace, failures, onRetryAssembly, onRetryLookups, lit }: HeroProps) {
  const { finding, interface: iface } = ev;
  const callout = [iface.disagreement, iface.fibril?.sentence ?? null, iface.crystal?.sentence ?? null, iface.setAside].filter(Boolean).join(" ");
  const near = interfaceMapView(ev, true, ["sites"]);
  const zoom = ev.position !== null && near.evidence.track.some(l => l.kind === "solved" || l.kind === "predicted");
  return (
    <section className="ifc-card ifc-hero" aria-labelledby="ifc-finding-title" data-testid="interfaces-finding">
      <div className="ifc-hero__text">
        <span className="eyebrow" id="ifc-finding-title">
          <Waypoints className="w-3.5 h-3.5" aria-hidden="true" />
          Interface context · not an ACMG input
        </span>
        <div className="ifc-hero__figure">
          <span className="ifc-figure" data-words={!finding.figure.isCount || undefined}>{finding.figure.value}</span>
          {finding.figure.isCount && <span className="ev-tier ifc-verdict" data-tone={finding.chipTone} data-testid="interface-verdict">{finding.chip}</span>}
          <span className="ifc-hero__figure-label">{finding.figure.caption}</span>
        </div>
        <Prose className="ifc-hero__finding" data-testid="interfaces-finding-sentence">
          <strong>{finding.headline}</strong> {finding.predicate}.
        </Prose>
        {finding.context && <Prose className="ifc-hero__context">{finding.context}</Prose>}
        {!finding.figure.isCount && <span className="sr-only" data-testid="interface-verdict">{finding.chip}</span>}
      </div>

      {zoom && (
        <figure className="ifc-hero__zoom" aria-label={`Evidence around ${ev.residueLabel}`}>
          <figcaption className="ifc-hero__zoom-head">
            <span className="mx-kicker">Around {ev.residueLabel}</span>
            <span>residues {near.bounds.start}–{near.bounds.end} · bar height = share of structures with the residue at the interface · hatched = no coordinates in any structure</span>
          </figcaption>
          <InterfaceTrack ev={near.evidence} bounds={near.bounds} lit={lit} summary />
        </figure>
      )}

      {callout && (
        <div className="ifc-callout" data-tone="neutral" data-testid="interfaces-callout">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{callout}</span>
        </div>
      )}
      {(failures.assembly || failures.lookups) && (
        <div role="status" className="ifc-callout" data-tone="warning">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{[failures.assembly, failures.lookups].filter(Boolean).join(" ")}</span>
          <span className="ifc-callout__action">
            <ActionButton onClick={failures.assembly ? onRetryAssembly : onRetryLookups} icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}>Try again</ActionButton>
          </span>
        </div>
      )}

      <details className="mx-finding-details" open={!workspace || undefined}>
        <summary>Source summary and engine record</summary>
        <dl className="ifc-facts">
          {ev.facts.map(f => (
            <div key={f.label} className="ifc-fact">
              <dt>{f.label}</dt>
              <dd className={f.mono ? "ifc-mono" : undefined}>{f.value}</dd>
              <dd className="ifc-fact__sub">{f.sub}</dd>
            </div>
          ))}
        </dl>
        <div className="ifc-foot">
          <span>Engine record: none. No ACMG criterion reads this tab.</span>
        </div>
      </details>
    </section>
  );
}

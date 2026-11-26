import { Boxes, MapPin } from "lucide-react";
import type { InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { InterfaceMapWorkspace } from "./InterfaceMapWorkspace";
import { ActionButton } from "./ui";

/**
 * Where on the sequence: the interface map, a sentence when nothing on it is a chart, and a legend that
 * lists only the marks drawn.
 */
interface MapProps {
  ev: InterfacesEvidence;
  numbering: string;
  lit: string | null;
  onLit: (key: string | null) => void;
  onOpen: (key: string) => void;
  onRequestModel: () => void;
}

export function InterfaceMapSection({ ev, numbering, lit, onLit, onOpen, onRequestModel }: MapProps) {
  const has = (kind: string) => ev.track.some(l => l.kind === kind);
  // RGS9 is the case: no solved, fibril or predicted lane, so the track is range chips above silence,
  // and silence reads as a broken graph. Say why, and offer the one chart that can exist.
  const noChart = ev.position !== null && !has("solved") && !has("predicted") && (ev.observed.availability.state === "empty" || ev.observed.availability.state === "ok");
  const gaps = ev.track.some(l => l.gaps.length > 0);
  const legend = ev.track.some(l => l.kind !== "domains") || ev.observed.fibrils.length > 0;
  return (
    <section className="ifc-section" aria-labelledby="ifc-track-title">
      <h2 className="eyebrow" id="ifc-track-title">
        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
        Where on the sequence
      </h2>
      <div className="ifc-card">
        <InterfaceMapWorkspace ev={ev} lit={lit} onLit={onLit} onOpen={onOpen} numbering={numbering} />
        {noChart && (
          <p className="ifc-track__note" data-testid="interface-track-note">
            <span>
              {ev.observed.availability.reason}
              {ev.model.canRequest && " Model the complex with Boltz-2 to predict one; its contacts would be charted here as a lane."}
            </span>
            {ev.model.canRequest && <ActionButton onClick={onRequestModel} icon={<Boxes className="w-3.5 h-3.5" aria-hidden="true" />}>Model the complex</ActionButton>}
          </p>
        )}
        {legend && (
          <div className="ifc-foot" aria-label="Legend">
            {has("domains") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="domain" />Domain (filled) or region (outlined); the block that holds the variant is tinted</span>}
            {has("solved") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="support" />Solved interface; bar height = share of the pair&apos;s structures with the residue at it</span>}
            {gaps && <span className="ifc-legend__item"><i className="ifc-key" data-kind="gap" />No coordinates in any of the pair&apos;s structures</span>}
            {ev.observed.fibrils.length > 0 && <span className="ifc-legend__item"><i className="ifc-key" data-kind="fibril" />Amyloid fibril stacking, read apart</span>}
            {has("predicted") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="predicted" />Predicted interface</span>}
            {has("sites") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="site" />Mapped site, UniProt</span>}
            {has("topology") && <span className="ifc-legend__item"><i className="ifc-key" data-kind="membrane" />Membrane segment; cytoplasmic side below the line, outside above</span>}
            {ev.position !== null && <span className="ifc-legend__item"><i className="ifc-key" data-kind="variant" />{ev.residueLabel}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

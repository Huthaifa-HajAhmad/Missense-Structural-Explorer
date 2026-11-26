import { Zap } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import { DDMUT_PPI_PERFORMANCE, type InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { InspectReadingButton } from "../EvidenceWorkspace";
import { BindingRuler } from "./Rulers";
import { ActionButton, Statement } from "./ui";

/** DDMut-PPI ΔΔG_bind: the value on its ruler with the method's error, or why there is none. */
export function BindingCard({ ev, onRequest }: { ev: InterfacesEvidence; onRequest: () => void }) {
  const b = ev.binding;
  const wt = b.wildType;
  const source = wt ? ` · ${wt.source === "experimental" ? wt.provenance : `${wt.provenance}${wt.ipTm != null ? `, ipTM ${wt.ipTm.toFixed(2)}` : ""}`}` : "";
  const title = b.state === "pending" || b.state === "running" ? ENGINE_STATE_LABELS.running : b.state === "failed" ? "No value returned" : b.state === "ready" ? "Not measured yet" : "Not measured";
  return (
    <section className="ifc-section" aria-labelledby="ifc-bind-title">
      <h2 className="eyebrow" id="ifc-bind-title" data-reading-key="binding-change">
        <Zap className="w-3.5 h-3.5" aria-hidden="true" />
        <InspectReadingButton tab="interfaces" readingKey="binding-change">Binding energy change</InspectReadingButton>
      </h2>
      <div className="ifc-card" data-testid="binding-card">
        <div className="ifc-bind__head">
          <ResearchGuideButton topic="ddmut_ppi" label="How to read binding change" />
          <span className="ifc-hero__figure-label">ΔΔG_bind · DDMut-PPI on a wild-type complex{source}</span>
          {b.stateLabel && (
            <span className="ev-tier" data-tone={b.state === "failed" ? "warning" : b.state === "pending" || b.state === "running" ? "neutral" : "muted"}>{b.stateLabel}</span>
          )}
        </div>
        {b.state === "ok" && b.value !== null ? (
          <div className="ifc-bind__body">
            <div className="ifc-bind__figure">
              <span className="ifc-bind__value">{b.valueText}</span>
              <span className="ifc-hero__figure-label">{b.directionText}{b.withinError ? ", inside the method's error" : ""}</span>
            </div>
            <BindingRuler value={b.value} />
            <p className="ifc-bind__caption">
              {wt?.source === "experimental"
                ? `Scored on the solved complex ${wt.pdbId?.toUpperCase()} (chain ${wt.chain}, residue ${wt.authorResidue} in the entry's numbering).`
                : "Scored on a Boltz-2 model of the wild-type complex: no solved complex of this protein exists."}{" "}
              Negative is weaker binding, in DDMut-PPI&apos;s convention; the shaded band is ± its RMSE. {DDMUT_PPI_PERFORMANCE}
            </p>
          </div>
        ) : (
          <Statement
            title={title}
            action={b.canRequest && b.state !== "running" ? (
              <ActionButton onClick={onRequest} busy={b.state === "pending"} icon={<Zap className="w-3.5 h-3.5" aria-hidden="true" />}>
                {b.state === "failed" ? "Try again" : "Estimate binding change"}
              </ActionButton>
            ) : undefined}
          >
            {b.reason}
          </Statement>
        )}
      </div>
    </section>
  );
}

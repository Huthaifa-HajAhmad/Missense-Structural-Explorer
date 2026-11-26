import { Boxes } from "lucide-react";
import { ENGINE_STATE_LABELS } from "../../../shared/engineStatus";
import { IPTM_BAND_LABEL, type InterfacesEvidence } from "../../../shared/interfacesEvidence";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { InspectReadingButton } from "../EvidenceWorkspace";
import { IptmRuler } from "./Rulers";
import { ActionButton, StateCells } from "./ui";

/** The predicted-complex group of the assembly table: ipTM and the residue's contacts, or why there is no model. */
export function ComplexModelRows({ ev, onRequest }: { ev: InterfacesEvidence; onRequest: () => void }) {
  const { model } = ev;
  const partnerChain = ev.chains.length === 2 ? `${ev.chains[1].id} ${ev.chains[1].label}` : "another chain";
  const planned = ev.chains.length > 1 && model.state !== "not-applicable" && model.state !== "not-modelled";
  const meta = model.state === "built" && model.provenance
    ? model.provenance
    : model.canRequest || model.state === "running" ? (model.browserFoldable ? "Boltz-2 via JapanFold, or in your browser with LocalFold" : "Boltz-2 via JapanFold") : "Boltz-2";
  const action = model.canRequest ? (
    <ActionButton onClick={onRequest} icon={<Boxes className="w-3.5 h-3.5" aria-hidden="true" />}>{model.state === "failed" ? "Try again" : "Model the complex"}</ActionButton>
  ) : null;
  return (
    <tbody data-group="model">
      <tr className="ifc-group">
        <th colSpan={4} scope="rowgroup">
          <span className="ifc-group__inner">
            <span className="ifc-group__title">Predicted complex</span>
            <ResearchGuideButton topic="boltz2" label="About this complex prediction" iconOnly />
            <span className="ifc-group__meta">
              {meta}
              {planned ? ` · chains ${ev.chains.map(c => `${c.id} ${c.label}`).join(", ")} · variant on A${model.residues ? ` · ${model.residues.toLocaleString("en-GB")} residues` : ""}` : ""}
            </span>
          </span>
        </th>
      </tr>
      {model.state === "built" ? (
        <>
          <tr>
            <th scope="row" className="ifc-subject">
              <span className="ifc-subject__name" data-reading-key="complex-model"><InspectReadingButton tab="interfaces" readingKey="complex-model">Interface confidence</InspectReadingButton></span>
              <span className="ifc-subject__note">ipTM, all interfaces together</span>
              <ResearchGuideButton topic="iptm" label="Explain interface confidence" iconOnly />
            </th>
            <td className="ifc-scale">{model.iptm !== null && <IptmRuler value={model.iptm} band={model.band} />}</td>
            <td className="ifc-num">{model.iptm !== null ? model.iptm.toFixed(2) : "—"}</td>
            <td className="ifc-status">
              <span className="ev-tier" data-tone={model.band ? "neutral" : "muted"}>{model.band ? IPTM_BAND_LABEL[model.band] : model.iptm === null ? "Not reported" : ENGINE_STATE_LABELS["no-result"]}</span>
            </td>
          </tr>
          <tr>
            <th scope="row" className="ifc-subject">
              <span className="ifc-subject__name">Contacts from {ev.residueLabel}</span>
              <span className="ifc-subject__note">pTM {model.ptm !== null ? model.ptm.toFixed(2) : "not reported"}</span>
            </th>
            <td className="ifc-reason">
              {model.variantContacts.length
                ? `Nearest ${model.variantContacts[0].distance.toFixed(1)} Å (${model.variantContacts.map(c => (c.resA === ev.position ? `${partnerChain} ${c.resB}` : `${partnerChain} ${ev.residueLabel}, wild type`)).slice(0, 3).join("; ")})`
                : model.nearestInterfaceGap !== null ? `None; nearest interface residue ${model.nearestInterfaceGap} away in sequence` : "None"}
            </td>
            <td className="ifc-num">{model.variantContacts.length}<span className="ifc-unit">of {model.contactsTotal}</span></td>
            <td className="ifc-status">
              <span className="ev-tier" data-tone={model.variantContacts.length ? "neutral" : "muted"}>{model.variantContacts.length ? "At interface" : "No contact"}</span>
            </td>
          </tr>
        </>
      ) : (
        <tr>
          <th scope="row" className="ifc-subject">
            <span className="ifc-subject__name" data-reading-key="complex-model"><InspectReadingButton tab="interfaces" readingKey="complex-model">Complex model</InspectReadingButton></span>
            <span className="ifc-subject__note">ipTM, pTM and contacts</span>
          </th>
          <StateCells label={model.stateLabel} reason={model.reason} action={action} />
        </tr>
      )}
    </tbody>
  );
}

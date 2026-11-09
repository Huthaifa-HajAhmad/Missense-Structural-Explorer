import React from "react";
import type { PerturbationEvidence } from "../../../shared/perturbationEvidence";
import { ResearchGuideButton } from "../../knowledge/ResearchGuideButton";
import { InspectReadingButton } from "../EvidenceWorkspace";
import { StatusChip } from "./ModelAvailability";
import { MarkRuler } from "./Rulers";

/** The sequence-embedding rows of the readings table: ESM3's distances, each on its own axis. */
export function Esm3Rows({ evidence }: { evidence: PerturbationEvidence }) {
  const e = evidence.esm3!;
  const ok = e.availability.state === "computed";
  const pos = evidence.residues.position;
  if (!ok) {
    return (
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">{e.label}</span><ResearchGuideButton topic={e.knowledgeKey} label={e.fallback ? "About the VESM fallback" : "About this embedding analysis"} iconOnly /></span>
          {e.remoteEngineNote && (
            <details className="ptb-diag">
              <summary>Engine notes</summary>
              <ul>
                {e.serviceNote && <li><strong>Remote service:</strong> {e.serviceNote}.</li>}
                <li><strong>Remote tier:</strong> {e.remoteEngineNote}</li>
              </ul>
            </details>
          )}
        </th>
        <td className="ptb-reason" colSpan={2}>{e.availability.reason}</td>
        <td className="ptb-status"><StatusChip a={e.availability} /></td>
      </tr>
    );
  }
  const peakAway = e.peakDistance !== null && e.peakDistance > 10;
  return (
    <>
      <tr data-testid="ptb-esm3">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name"><InspectReadingButton tab="perturbation" readingKey="esm3">{e.label}</InspectReadingButton></span><ResearchGuideButton topic={e.knowledgeKey} label={e.fallback ? "About the VESM fallback" : "About this embedding analysis"} iconOnly /></span>
          <span className="ptb-subject__note">
            How much the model&apos;s internal description of each residue changes when the variant is introduced (cosine
            distance between wild-type and mutant sequence embeddings). A representation change — not a structure
            prediction.
          </span>
          {e.driftResidue !== null && (
            <span className="ptb-subject__note ptb-subject__fact" data-testid="ptb-esm3-peak">
              Largest change at residue {e.driftResidue}
              {e.peakDistance === 0
                ? " — the variant itself"
                : e.peakDistance !== null
                  ? `, ${e.peakDistance.toLocaleString("en-GB")} residues from the variant`
                  : ""}
              {e.siteDrift !== null && e.peakDistance !== 0 ? `; ${e.siteDrift.toFixed(3)} at residue ${pos}` : ""}.
            </span>
          )}
          {e.fallback && (
            <span className="ptb-caveats ev-caveats">
              {e.fallback && <span className="ev-tier" data-tone="warning" title="ESM3 was unavailable, so VESM-150M produced these numbers.">Fallback model</span>}
            </span>
          )}
          {e.servedBy && <span className="ptb-subject__note ptb-subject__fact">Served by {e.servedBy}</span>}
          {e.remoteEngineNote && (
            <details className="ptb-diag">
              <summary>Engine notes</summary>
              <ul>
                {e.serviceNote && <li><strong>Remote service:</strong> {e.serviceNote}.</li>}
                <li><strong>Remote tier:</strong> {e.remoteEngineNote}</li>
              </ul>
            </details>
          )}
        </th>
        <td className="ptb-num">{e.drift!.toFixed(3)}<span className="ptb-unit">cosine distance</span></td>
        <td className="ptb-scale">
          {/* No published bands exist for this distance, so none is drawn: the variant residue is the only mark. */}
          <MarkRuler
            value={e.drift!}
            min={0}
            max={Math.max(0.1, Math.ceil(e.drift! * 10) / 10)}
            marks={e.siteDrift !== null && pos !== null ? [{ value: e.siteDrift, label: `residue ${pos}` }] : []}
            label={e.label}
            format={n => n.toFixed(2)}
          />
          <span className="ptb-scale__source">Largest change in the protein{e.siteDrift !== null && pos !== null ? `; tick: residue ${pos}, ${e.siteDrift.toFixed(3)}` : ""}</span>
        </td>
        <td className="ptb-status">
          {e.peakDistance !== null && (
            <span className="ev-tier" data-tone="neutral" title="Within 10 residues of the variant counts as near. The cut-off is app-defined, not published.">
              {e.peakDistance === 0 ? "Peak at the variant" : peakAway ? "Peak away from the variant" : "Peak near the variant"}
            </span>
          )}
        </td>
      </tr>
      <tr data-testid="ptb-esm3-context">
        <th scope="row" className="ptb-subject">
          <span className="ptb-subject__line"><span className="ptb-subject__name">Site context</span></span>
          <span className="ptb-subject__note">
            How confident the input structure is at this residue (pLDDT for an AlphaFold model) — not the embedding model&apos;s
            confidence in anything it predicted.
          </span>
        </th>
        <td className="ptb-num">
          {e.templateConfidence !== null ? e.templateConfidence.toFixed(1) : "—"}
          <span className="ptb-unit">pLDDT</span>
        </td>
        <td className="ptb-reason">
          {e.secondaryStructure ?? "Secondary structure not reported"} · {e.burial ?? "burial not measured"}
        </td>
        <td className="ptb-status">
          {e.confidenceBand && (
            <span className="ev-tier" data-tone="neutral" title="AlphaFold DB bands: very high > 90, confident 70–90, low 50–70, very low ≤ 50 (Jumper 2021)">
              {e.confidenceBand}
            </span>
          )}
        </td>
      </tr>
    </>
  );
}
